import {
  AuthService,
  ChatService,
  ConnectionManager,
  Emitter,
  MessageStore,
  OutboxStore,
  SyncService,
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

const DEVICE_ID_KEY = 'im.installationDeviceId';

export interface SdkConfig {
  apiBaseUrl: string; // 例：http://10.0.2.2:8080/api
  wsBaseUrl: string;  // 例：ws://10.0.2.2:9001/im
  deviceId?: string;
  dbName?: string;
}

export function createSdk(config: SdkConfig) {
  const store = new KeychainSecureStore();
  // 同一安装内跨启动、跨账号保持稳定；卸载后由系统清理 Keychain，再生成新值。
  // 缓存 Promise 可避免启动与前台恢复同时触发连接时重复生成两个标识。
  let installationDeviceId: Promise<string> | null = null;
  const getInstallationDeviceId = (): Promise<string> => {
    installationDeviceId ??= store.get(DEVICE_ID_KEY).then(async (saved) => {
      if (saved != null && saved !== '') return saved;
      const created = rnIds.uuid();
      await store.set(DEVICE_ID_KEY, created);
      return created;
    });
    return installationDeviceId;
  };
  const http = new AxiosHttp(config.apiBaseUrl, () => store.get(TOKEN_KEYS.access));
  const auth = new AuthService(http, store);
  const transport = new WebSocketTransport();
  const lifecycle = new AppStateLifecycle();
  const connection = new ConnectionManager(
    transport,
    lifecycle,
    () => auth.getAccessToken(),
    {
      wsBaseUrl: config.wsBaseUrl,
      deviceId: config.deviceId ?? getInstallationDeviceId,
    },
  );

  const db = OpSqliteDatabase.open(config.dbName ?? 'im.db');
  const emitter = new Emitter<SdkEvents>();
  const engine = new SyncEngine(db, emitter);
  const messages = new MessageStore(db);
  const sync = new SyncService(http, engine, messages, emitter);
  const chat = new ChatService(
    connection,
    engine,
    messages,
    new OutboxStore(db),
    rnIds,
    emitter,
  );

  // 建表是异步的；调用方必须先 await ready 再用 chat。
  const ready = runMigrations(db);

  const triggerSync = () => {
    // SyncService 已通过 syncState 报错；这里兜住 Promise，避免自动触发产生未处理拒绝。
    void ready.then(() => sync.syncAll()).catch(() => {});
  };
  connection.on('state', (state) => {
    if (state === 'connected') triggerSync();
  });
  lifecycle.onForeground(() => {
    if (connection.getState() === 'connected') triggerSync();
  });

  return { auth, connection, chat, sync, http, ids: rnIds, ready };
}
