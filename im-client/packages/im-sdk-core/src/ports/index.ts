// —— 数据库端口（全 Promise 化；同步驱动包一层 Promise.resolve）——
export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface Database {
  exec(sql: string, params?: SqlValue[]): Promise<void>;
  query<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  tx(fn: (tx: Database) => Promise<void>): Promise<void>;
}

// —— 长连接端口（M1 实现）——
export type TransportState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed';

export interface Transport {
  connect(url: string): void;
  send(text: string): void;
  onMessage(handler: (text: string) => void): void;
  onState(handler: (state: TransportState) => void): void;
  close(): void;
}

// —— HTTP 端口（M1 实现，axios 适配）——
export interface Http {
  get<T>(path: string, params?: Record<string, unknown>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T = void>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

// —— 安全存储端口（M1 实现，keychain）——
export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

// —— 媒体选择端口（M5 实现）——
export interface PickedMedia {
  uri: string;
  filename: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
}

export interface MediaPicker {
  pickCameraImage(): Promise<PickedMedia | null>;
  pickLibraryImage(): Promise<PickedMedia | null>;
  pickFile(): Promise<PickedMedia | null>;
}

/** 文件持久化、分片读取和二进制传输由平台适配层实现。 */
export interface MediaBinaryPort {
  persist(source: PickedMedia, taskId: string): Promise<PickedMedia>;
  exists(uri: string): Promise<boolean>;
  readChunkBase64(uri: string, offset: number, length: number): Promise<string>;
  putBase64(
    url: string,
    base64: string,
    contentType: string,
    contentLength: number,
  ): Promise<{ eTag: string | null }>;
  download(
    url: string,
    filename: string,
    onProgress: (done: number, total: number) => void,
  ): Promise<string>;
  remove(uri: string): Promise<void>;
}

export interface MediaOpenPort {
  open(uri: string, mime: string): Promise<void>;
}

// —— 生命周期端口（M1 实现，AppState）——
export interface AppLifecycle {
  onForeground(handler: () => void): () => void;
  onBackground(handler: () => void): () => void;
}

// —— id / 时间端口（Hermes 不保证 crypto.randomUUID）——
export interface Ids {
  uuid(): string;
  now(): number;
}
