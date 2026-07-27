import { AuthService, ConnectionManager, TOKEN_KEYS } from '@im/sdk-core';
import { AxiosHttp } from './adapters/axiosHttp';
import { WebSocketTransport } from './adapters/webSocketTransport';
import { KeychainSecureStore } from './adapters/keychainSecureStore';
import { AppStateLifecycle } from './adapters/appStateLifecycle';
import { rnIds } from './adapters/rnIds';

export interface SdkConfig {
  apiBaseUrl: string; // 例：http://10.0.2.2:8080/api
  wsBaseUrl: string;  // 例：ws://10.0.2.2:9001/im
  deviceId?: string;
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
  return { auth, connection, ids: rnIds };
}
