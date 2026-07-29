import { createSdk } from '@im/sdk-rn';
import { Platform } from 'react-native';

// Android 模拟器用 10.0.2.2 访问宿主机；iOS 模拟器用 localhost。
const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const sdk = createSdk({
  apiBaseUrl: `http://${host}:8080/api`,
  wsBaseUrl: `ws://${host}:9001/im`,
});
