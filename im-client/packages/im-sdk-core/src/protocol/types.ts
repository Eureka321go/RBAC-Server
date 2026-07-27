export const OP = {
  SEND: 'SEND',
  RECALL: 'RECALL',
  READ: 'READ',
  ACK: 'ACK',
  PUSH: 'PUSH',
  ERROR: 'ERROR',
  PING: 'PING',
  PONG: 'PONG',
} as const;

export type Op = (typeof OP)[keyof typeof OP];

export type MessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'FILE'
  | 'LINK'
  | 'RECALL'
  | 'SYSTEM';

/** 网关/客户端统一消息信封（对齐接口文档 §4.3）。 */
export interface Envelope {
  op: Op;
  cid?: string;
  senderId?: number;
  deviceId?: string;
  clientMsgId?: string;
  type?: MessageType;
  body?: Record<string, unknown>;
  seq?: number;
  msgId?: string;
  ts?: number;
}

const MEDIA_TYPES = new Set<string>(['IMAGE', 'AUDIO', 'FILE']);

/** null-safe：缺 type 的报文不能炸线程。 */
export function isMedia(type: string | null | undefined): boolean {
  return type != null && MEDIA_TYPES.has(type);
}
