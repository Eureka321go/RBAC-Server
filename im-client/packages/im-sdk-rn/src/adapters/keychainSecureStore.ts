import * as Keychain from 'react-native-keychain';
import type { SecureStore } from '@im/sdk-core';

/** 每个 key 用一条 internet credentials（server=key），互不覆盖。 */
export class KeychainSecureStore implements SecureStore {
  async get(key: string): Promise<string | null> {
    const r = await Keychain.getInternetCredentials(key);
    return r ? r.password : null;
  }

  async set(key: string, value: string): Promise<void> {
    await Keychain.setInternetCredentials(key, key, value);
  }

  async del(key: string): Promise<void> {
    await Keychain.resetInternetCredentials({ server: key });
  }
}
