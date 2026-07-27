import {
  AuthService,
  ChatService,
  ConnectionManager,
  Emitter,
  MessageStore,
  OutboxStore,
  SyncEngine,
  TOKEN_KEYS,
  runMigrations,
  type SdkEvents,
} from '@im/sdk-core';
import { AxiosHttp } from './adapters/axiosHttp';
import { WebSocketTransport } from './adapters/webSocketTransport';
import { KeychainSecureStore } from './adapters/keychainSecureStore';
import { AppStateLifecycle } from './adapters/appStateLifecycle';
import { OpSqliteDatabase } from './adapters/opSqliteDatabase';
import { rnIds } from './adapters/rnIds';

export interface SdkConfig {
  apiBaseUrl: string; // 例：http://10.0.2.2:8080/api
  wsBaseUrl: string;  // 例：ws://10.0.2.2:9001/im
  deviceId?: string;
  dbName?: string;
}

export function createSdk(config: SdkConfig) {
  const store = new KeychainSecureStore();
  const http = new AxiosHttp(config.apiBaseUrl, () => store.get(TOKEN_KEYS.access));
  const auth = new AuthService(http, store);
  const transport = new WebSocketTransport();
  const lifecycle = new AppStateLifecycle();
  const connection = new ConnectionManager(
    transport,
    lifecycle,
    () => auth.getAccessToken(),
    { wsBaseUrl: config.wsBaseUrl, deviceId: config.deviceId ?? rnIds.uuid() },
  );

  const db = OpSqliteDatabase.open(config.dbName ?? 'im.db');
  const emitter = new Emitter<SdkEvents>();
  const engine = new SyncEngine(db, emitter);
  const chat = new ChatService(
    connection,
    engine,
    new MessageStore(db),
    new OutboxStore(db),
    rnIds,
    emitter,
  );

  // 建表是异步的；调用方必须先 await ready 再用 chat。
  const ready = runMigrations(db);

  return { auth, connection, chat, http, ids: rnIds, ready };
}
