import type { ChatMessage } from '../store/outboxStore';

export type MediaMessageType = 'IMAGE' | 'AUDIO' | 'FILE';
export type MediaUploadMode = 'single' | 'multipart';
export type MediaUploadStatus =
  | 'queued'
  | 'preparing'
  | 'uploading'
  | 'completing'
  | 'sending'
  | 'failed'
  | 'cancelled';

export interface MediaUploadTask {
  taskId: string;
  clientMsgId: string;
  accountId: number;
  cid: string;
  type: MediaMessageType;
  localUri: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
  mode: MediaUploadMode | null;
  serverTaskId: string | null;
  objectKey: string | null;
  partSize: number | null;
  status: MediaUploadStatus;
  progress: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export function mediaTaskToChatMessage(task: MediaUploadTask): ChatMessage {
  return {
    cid: task.cid,
    seq: null,
    clientMsgId: task.clientMsgId,
    msgId: null,
    senderId: null,
    type: task.type,
    body: {
      ...task.metadata,
      localUri: task.localUri,
      filename: task.filename,
      mime: task.mime,
      size: task.size,
      width: task.width,
      height: task.height,
      progress: task.progress,
      uploadTaskId: task.taskId,
    },
    recalled: false,
    status: task.status === 'failed' ? 'failed' : 'uploading',
    error: task.error,
    ts: task.createdAt,
  };
}
