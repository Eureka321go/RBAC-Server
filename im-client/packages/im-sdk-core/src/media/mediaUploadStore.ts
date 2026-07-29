import type { Database, Row } from '../ports/index';
import type {
  MediaUploadMode,
  MediaUploadStatus,
  MediaUploadTask,
} from './mediaTypes';

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function toTask(row: Row): MediaUploadTask {
  return {
    taskId: row.task_id as string,
    clientMsgId: row.client_msg_id as string,
    accountId: row.account_id as number,
    cid: row.cid as string,
    type: row.type as MediaUploadTask['type'],
    localUri: row.local_uri as string,
    filename: row.filename as string,
    mime: row.mime as string,
    size: row.size as number,
    width: optionalNumber(row.width),
    height: optionalNumber(row.height),
    mode: (row.mode as MediaUploadMode | null) ?? null,
    serverTaskId: (row.server_task_id as string | null) ?? null,
    objectKey: (row.object_key as string | null) ?? null,
    partSize: optionalNumber(row.part_size),
    status: row.status as MediaUploadStatus,
    progress: row.progress as number,
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

const COLUMNS = `task_id, client_msg_id, account_id, cid, type, local_uri,
  filename, mime, size, width, height, mode, server_task_id, object_key,
  part_size, status, progress, error, created_at, updated_at`;

export class MediaUploadStore {
  constructor(private readonly db: Database) {}

  async insert(task: MediaUploadTask): Promise<void> {
    await this.db.exec(
      `INSERT INTO media_upload_task (${COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.taskId, task.clientMsgId, task.accountId, task.cid, task.type,
        task.localUri, task.filename, task.mime, task.size, task.width, task.height,
        task.mode, task.serverTaskId, task.objectKey, task.partSize, task.status,
        task.progress, task.error, task.createdAt, task.updatedAt,
      ],
    );
  }

  async get(taskId: string): Promise<MediaUploadTask | null> {
    const rows = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM media_upload_task WHERE task_id = ?`,
      [taskId],
    );
    return rows.length === 0 ? null : toTask(rows[0]);
  }

  async listByCid(cid: string, accountId: number | null): Promise<MediaUploadTask[]> {
    if (accountId == null) return [];
    const rows = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM media_upload_task
        WHERE cid = ? AND account_id = ? AND status != 'cancelled'
        ORDER BY created_at ASC`,
      [cid, accountId],
    );
    return rows.map(toTask);
  }

  async listResumable(accountId: number): Promise<MediaUploadTask[]> {
    const rows = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM media_upload_task
        WHERE account_id = ? AND status != 'cancelled'
        ORDER BY created_at ASC`,
      [accountId],
    );
    return rows.map(toTask);
  }

  async update(taskId: string, patch: Partial<Pick<MediaUploadTask,
    'mode' | 'serverTaskId' | 'objectKey' | 'partSize' | 'status' | 'progress' | 'error'
  >>): Promise<void> {
    const entries: Array<[string, string | number | null]> = [];
    if ('mode' in patch) entries.push(['mode', patch.mode ?? null]);
    if ('serverTaskId' in patch) entries.push(['server_task_id', patch.serverTaskId ?? null]);
    if ('objectKey' in patch) entries.push(['object_key', patch.objectKey ?? null]);
    if ('partSize' in patch) entries.push(['part_size', patch.partSize ?? null]);
    if ('status' in patch) entries.push(['status', patch.status ?? 'failed']);
    if ('progress' in patch) entries.push(['progress', patch.progress ?? 0]);
    if ('error' in patch) entries.push(['error', patch.error ?? null]);
    if (entries.length === 0) return;
    entries.push(['updated_at', Date.now()]);
    await this.db.exec(
      `UPDATE media_upload_task SET ${entries.map(([column]) => `${column} = ?`).join(', ')}
        WHERE task_id = ?`,
      [...entries.map(([, value]) => value), taskId],
    );
  }

  async delete(taskId: string): Promise<void> {
    await this.db.exec(`DELETE FROM media_upload_task WHERE task_id = ?`, [taskId]);
  }
}
