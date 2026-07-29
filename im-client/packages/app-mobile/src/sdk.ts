import { createSdk, routeSignedUrl } from '@im/sdk-rn';
import { Platform } from 'react-native';

// Android 模拟器用 10.0.2.2 访问宿主机；iOS 模拟器用 localhost。
const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const mediaTransportBaseUrl = `http://${host}:9000`;

export const routeMediaUrl = (url: string) => {
  const routed = routeSignedUrl(url, mediaTransportBaseUrl);
  return { uri: routed.url, headers: routed.headers };
};

export const sdk = createSdk({
  apiBaseUrl: `http://${host}:8080/api`,
  wsBaseUrl: `ws://${host}:9001/im`,
  mediaTransportBaseUrl,
});
