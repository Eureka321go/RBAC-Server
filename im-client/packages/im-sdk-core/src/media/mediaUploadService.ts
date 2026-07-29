import type { ApiResult } from '../auth/authService';
import type { ChatService } from '../chat/chatService';
import type { Emitter } from '../events/emitter';
import type { SdkEvents } from '../engine/syncEngine';
import type {
  Http,
  Ids,
  MediaBinaryPort,
  MediaOpenPort,
  MediaPicker,
  PickedMedia,
} from '../ports/index';
import type { MediaUploadTask, MediaMessageType } from './mediaTypes';
import { MediaUploadStore } from './mediaUploadStore';

interface PresignResult {
  objectKey: string;
  uploadUrl: string;
  expiresIn: number;
}

interface MultipartInitResult {
  taskId: string;
  objectKey: string;
  partSize: number;
  partCount: number;
  expiresAt: number;
}

interface UploadedPartResult {
  partNumber: number;
  eTag: string;
  size: number;
}

interface MultipartStatusResult {
  taskId: string;
  objectKey: string;
  status: 'UPLOADING' | 'COMPLETED' | 'ABORTED' | 'EXPIRED';
  partSize: number;
  partCount: number;
  uploadedParts: UploadedPartResult[];
}

interface UploadPartPresignResult {
  partNumber: number;
  uploadUrl: string;
  expiresIn: number;
}

interface DownloadPresignResult {
  objectKey: string;
  url: string;
  expiresIn: number;
}

const MULTIPART_THRESHOLD = 5 * 1024 * 1024;
const IMAGE_MAX_SIZE = 10 * 1024 * 1024;
const FILE_MAX_SIZE = 100 * 1024 * 1024;

function dataOf<T>(result: ApiResult<T>, fallback: string): T {
  if (result.code !== 200 || result.data == null) {
    throw new Error(result.message || fallback);
  }
  return result.data;
}

function mediaBody(task: MediaUploadTask): Record<string, unknown> {
  if (task.objectKey == null) throw new Error('UPLOAD_OBJECT_MISSING');
  return {
    objectKey: task.objectKey,
    filename: task.filename,
    mime: task.mime,
    size: task.size,
    ...(task.type === 'IMAGE' ? { width: task.width, height: task.height } : {}),
  };
}

/** 可持久恢复的富媒体上传编排；同一 SDK 实例内所有分片严格串行。 */
export class MediaUploadService {
  private queue: Promise<void> = Promise.resolve();
  private readonly running = new Set<string>();
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly http: Http,
    private readonly binary: MediaBinaryPort,
    private readonly opener: MediaOpenPort,
    private readonly picker: MediaPicker,
    private readonly store: MediaUploadStore,
    private readonly chat: ChatService,
    private readonly ids: Ids,
    private readonly emitter: Emitter<SdkEvents>,
    private readonly getAccountId: () => number | null,
  ) {}

  pickCameraImage(): Promise<PickedMedia | null> {
    return this.picker.pickCameraImage();
  }

  pickLibraryImage(): Promise<PickedMedia | null> {
    return this.picker.pickLibraryImage();
  }

  pickFile(): Promise<PickedMedia | null> {
    return this.picker.pickFile();
  }

  async enqueue(cid: string, type: MediaMessageType, source: PickedMedia): Promise<string> {
    const accountId = this.getAccountId();
    if (accountId == null) throw new Error('NOT_AUTHENTICATED');
    this.validateSource(type, source);
    const taskId = this.ids.uuid();
    const persisted = await this.binary.persist(source, taskId);
    try {
      this.validateSource(type, persisted);
    } catch (cause) {
      await this.binary.remove(persisted.uri).catch(() => {});
      throw cause;
    }
    const now = this.ids.now();
    const task: MediaUploadTask = {
      taskId,
      clientMsgId: this.ids.uuid(),
      accountId,
      cid,
      type,
      localUri: persisted.uri,
      filename: persisted.filename,
      mime: persisted.mime,
      size: persisted.size,
      width: persisted.width ?? null,
      height: persisted.height ?? null,
      mode: persisted.size < MULTIPART_THRESHOLD ? 'single' : 'multipart',
      serverTaskId: null,
      objectKey: null,
      partSize: null,
      status: 'queued',
      progress: 0,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insert(task);
    this.notify(cid);
    this.schedule(taskId);
    return taskId;
  }

  async retry(taskId: string): Promise<void> {
    const task = await this.store.get(taskId);
    if (task == null || task.accountId !== this.getAccountId()) return;
    this.cancelled.delete(taskId);
    await this.store.update(taskId, {
      status: 'queued',
      error: null,
      ...(task.error === 'UPLOAD_SESSION_EXPIRED'
        ? { serverTaskId: null, objectKey: null, partSize: null }
        : {}),
    });
    this.notify(task.cid);
    this.schedule(taskId);
  }

  async cancel(taskId: string): Promise<void> {
    const task = await this.store.get(taskId);
    if (task == null || task.accountId !== this.getAccountId()) return;
    this.cancelled.add(taskId);
    if (task.serverTaskId != null) {
      try {
        await this.http.delete<ApiResult<null>>(
          `/im/upload/multipart/${encodeURIComponent(task.serverTaskId)}`,
        );
      } catch {
        // 本地取消优先；服务端过期清理任务会回收暂时无法 abort 的分片。
      }
    }
    await this.store.update(taskId, { status: 'cancelled', error: null });
    await this.binary.remove(task.localUri).catch(() => {});
    await this.store.delete(taskId);
    this.notify(task.cid);
  }

  async resumeAll(): Promise<void> {
    const accountId = this.getAccountId();
    if (accountId == null) return;
    const tasks = await this.store.listResumable(accountId);
    tasks.forEach((task) => this.schedule(task.taskId));
  }

  listByCid(cid: string): Promise<MediaUploadTask[]> {
    return this.store.listByCid(cid, this.getAccountId());
  }

  async refreshDownloadUrl(cid: string, objectKey: string): Promise<string> {
    const result = await this.http.post<ApiResult<DownloadPresignResult>>(
      '/im/upload/download/presign',
      { cid, objectKey },
    );
    return dataOf(result, 'DOWNLOAD_URL_FAILED').url;
  }

  async downloadAndOpen(
    cid: string,
    objectKey: string,
    filename: string,
    mime: string,
    onProgress: (done: number, total: number) => void,
  ): Promise<void> {
    const localUri = await this.downloadToCache(cid, objectKey, filename, onProgress);
    await this.opener.open(localUri, mime);
  }

  async downloadToCache(
    cid: string,
    objectKey: string,
    filename: string,
    onProgress: (done: number, total: number) => void = () => {},
  ): Promise<string> {
    const url = await this.refreshDownloadUrl(cid, objectKey);
    return this.binary.download(url, filename, onProgress);
  }

  /** 自己的最终 PUSH 已落库：此时才安全删除上传任务与发送端本地副本。 */
  async settle(clientMsgId: string): Promise<void> {
    const task = await this.store.getByClientMsgId(clientMsgId);
    if (task == null) return;
    await this.store.delete(task.taskId);
    await this.binary.remove(task.localUri).catch(() => {});
    this.notify(task.cid);
  }

  private schedule(taskId: string): void {
    if (this.running.has(taskId)) return;
    this.running.add(taskId);
    this.queue = this.queue
      .then(() => this.process(taskId))
      .catch(() => {})
      .finally(() => this.running.delete(taskId));
  }

  private async process(taskId: string): Promise<void> {
    let task = await this.store.get(taskId);
    if (task == null || task.accountId !== this.getAccountId()) return;
    if (!(await this.binary.exists(task.localUri))) {
      await this.fail(task, 'UPLOAD_SOURCE_MISSING');
      return;
    }
    try {
      if (task.status === 'sending' && task.objectKey != null) {
        await this.chat.sendMedia(task.cid, task.type, {
          ...mediaBody(task),
          localUri: task.localUri,
          progress: 1,
        }, task.clientMsgId);
        return;
      }
      await this.store.update(taskId, { status: 'preparing', error: null });
      this.notify(task.cid);
      this.ensureActive(task);
      task = (await this.store.get(taskId))!;
      if (task.mode === 'single') await this.uploadSingle(task);
      else await this.uploadMultipart(task);
      task = (await this.store.get(taskId))!;
      this.ensureActive(task);
      await this.store.update(taskId, { status: 'sending', progress: 1, error: null });
      this.notify(task.cid);
      await this.chat.sendMedia(task.cid, task.type, {
        ...mediaBody(task),
        localUri: task.localUri,
        progress: 1,
      }, task.clientMsgId);
      this.notify(task.cid);
    } catch (cause) {
      const current = await this.store.get(taskId);
      if (current != null && current.accountId === this.getAccountId()
          && !this.cancelled.has(taskId)) {
        await this.fail(current, cause instanceof Error ? cause.message : 'UPLOAD_FAILED');
      }
    }
  }

  private async uploadSingle(task: MediaUploadTask): Promise<void> {
    await this.store.update(task.taskId, { status: 'uploading', progress: 0, error: null });
    this.notify(task.cid);
    const result = await this.http.post<ApiResult<PresignResult>>('/im/upload/presign', {
      cid: task.cid,
      type: task.type,
      filename: task.filename,
      mime: task.mime,
      size: task.size,
    });
    const presign = dataOf(result, 'UPLOAD_PRESIGN_FAILED');
    await this.store.update(task.taskId, { objectKey: presign.objectKey });
    const base64 = await this.binary.readChunkBase64(task.localUri, 0, task.size);
    await this.binary.putBase64(presign.uploadUrl, base64, task.mime, task.size);
    await this.store.update(task.taskId, { progress: 1 });
    this.notify(task.cid);
  }

  private async uploadMultipart(initial: MediaUploadTask): Promise<void> {
    let task = initial;
    if (task.serverTaskId == null) {
      const result = await this.http.post<ApiResult<MultipartInitResult>>(
        '/im/upload/multipart/init',
        {
          cid: task.cid,
          type: task.type,
          filename: task.filename,
          mime: task.mime,
          size: task.size,
        },
      );
      const session = dataOf(result, 'UPLOAD_INIT_FAILED');
      await this.store.update(task.taskId, {
        serverTaskId: session.taskId,
        objectKey: session.objectKey,
        partSize: session.partSize,
      });
      task = (await this.store.get(task.taskId))!;
    }
    const serverTaskId = task.serverTaskId!;
    const statusResult = await this.http.get<ApiResult<MultipartStatusResult>>(
      `/im/upload/multipart/${encodeURIComponent(serverTaskId)}`,
    );
    const status = dataOf(statusResult, 'UPLOAD_STATUS_FAILED');
    if (status.status === 'ABORTED' || status.status === 'EXPIRED') {
      throw new Error('UPLOAD_SESSION_EXPIRED');
    }
    if (status.status !== 'COMPLETED') {
      await this.uploadMissingParts(task, status);
      await this.store.update(task.taskId, { status: 'completing', progress: 1 });
      this.notify(task.cid);
      const completed = await this.http.post<ApiResult<MultipartStatusResult>>(
        `/im/upload/multipart/${encodeURIComponent(serverTaskId)}/complete`,
      );
      dataOf(completed, 'UPLOAD_COMPLETE_FAILED');
    }
  }

  private async uploadMissingParts(
    task: MediaUploadTask,
    status: MultipartStatusResult,
  ): Promise<void> {
    const uploaded = new Set(status.uploadedParts.map((part) => part.partNumber));
    let uploadedBytes = status.uploadedParts.reduce((sum, part) => sum + part.size, 0);
    await this.store.update(task.taskId, {
      status: 'uploading',
      progress: Math.min(1, uploadedBytes / task.size),
      error: null,
    });
    this.notify(task.cid);
    for (let partNumber = 1; partNumber <= status.partCount; partNumber += 1) {
      this.ensureActive(task);
      if (uploaded.has(partNumber)) continue;
      const offset = (partNumber - 1) * status.partSize;
      const length = Math.min(status.partSize, task.size - offset);
      const signed = await this.http.post<ApiResult<UploadPartPresignResult>>(
        `/im/upload/multipart/${encodeURIComponent(status.taskId)}/parts/${partNumber}/presign`,
      );
      const presign = dataOf(signed, 'UPLOAD_PART_PRESIGN_FAILED');
      const base64 = await this.binary.readChunkBase64(task.localUri, offset, length);
      await this.binary.putBase64(presign.uploadUrl, base64, task.mime, length);
      this.ensureActive(task);
      uploadedBytes += length;
      await this.store.update(task.taskId, {
        progress: Math.min(1, uploadedBytes / task.size),
      });
      this.notify(task.cid);
    }
  }

  private validateSource(type: MediaMessageType, source: PickedMedia): void {
    if (!source.uri || !source.filename || !source.mime || source.size <= 0) {
      throw new Error('MEDIA_INVALID');
    }
    const maxSize = type === 'IMAGE' ? IMAGE_MAX_SIZE : FILE_MAX_SIZE;
    if (source.size > maxSize) throw new Error('MEDIA_TOO_LARGE');
  }

  private ensureActive(task: MediaUploadTask): void {
    if (this.cancelled.has(task.taskId)) throw new Error('UPLOAD_CANCELLED');
    if (task.accountId !== this.getAccountId()) throw new Error('UPLOAD_PAUSED');
  }

  private async fail(task: MediaUploadTask, error: string): Promise<void> {
    await this.store.update(task.taskId, { status: 'failed', error });
    this.notify(task.cid);
  }

  private notify(cid: string): void {
    this.emitter.emit('message', { cid, type: 'MEDIA_UPLOAD' });
  }
}
