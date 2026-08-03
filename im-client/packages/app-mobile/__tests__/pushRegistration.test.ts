import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PushRegistrationManager,
  REGISTRATION_FINGERPRINT_KEY,
  REGISTRATION_TIME_KEY,
} from '../src/push/pushRegistration';

jest.mock('../src/sdk', () => ({ sdk: {} }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeMany: jest.fn(),
  },
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

function createFixture() {
  const sdk = {
    installationDeviceId: jest.fn(async () => 'device-a'),
    http: {
      put: jest.fn<Promise<unknown>, [string, unknown]>(async () => undefined),
      delete: jest.fn<Promise<unknown>, [string]>(async () => undefined),
    },
  };
  const nativePush = {
    getRegistrationTarget: jest.fn(async () => ({
      targetType: 'FID' as const,
      targetValue: 'fid-secret-a',
      targetFingerprint: 'hash-a',
      appVersion: '1.0',
    })),
    setActiveUserId: jest.fn(async () => undefined),
    clearActiveUserId: jest.fn(async () => undefined),
    areNotificationsEnabled: jest.fn(async () => true),
  };
  const manager = new PushRegistrationManager(
    sdk,
    nativePush,
    storage,
    () => 1_000,
  );
  return { sdk, nativePush, manager };
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue(undefined);
  storage.removeMany.mockResolvedValue(undefined);
});

async function waitForCall(mock: jest.Mock): Promise<void> {
  for (let index = 0; index < 20 && mock.mock.calls.length === 0; index += 1) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalled();
}

test('activate registers the websocket installation id with an exact request body', async () => {
  const { sdk, nativePush, manager } = createFixture();

  await manager.activate(42);

  expect(sdk.installationDeviceId).toHaveBeenCalledTimes(1);
  expect(sdk.http.put).toHaveBeenCalledWith('/im/push/registrations/device-a', {
    platform: 'ANDROID',
    provider: 'FCM',
    targetType: 'FID',
    targetValue: 'fid-secret-a',
    appVersion: '1.0',
  });
  expect(nativePush.setActiveUserId).toHaveBeenCalledWith(42);
  expect(storage.setItem).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('fid-secret-a'),
  );
});

test('activate skips a fresh matching target but refreshes a changed target', async () => {
  const { sdk, nativePush, manager } = createFixture();
  storage.getItem.mockImplementation(async key => {
    if (key === REGISTRATION_FINGERPRINT_KEY) {
      return JSON.stringify({
        userId: 42,
        deviceId: 'device-a',
        fingerprint: 'hash-a',
      });
    }
    return '999';
  });

  await manager.activate(42);
  expect(sdk.http.put).not.toHaveBeenCalled();
  expect(nativePush.setActiveUserId).toHaveBeenCalledWith(42);

  nativePush.getRegistrationTarget.mockResolvedValueOnce({
    targetType: 'FID',
    targetValue: 'fid-secret-b',
    targetFingerprint: 'hash-b',
    appVersion: '1.0',
  });
  await manager.refreshIfDue();
  expect(sdk.http.put).toHaveBeenCalledTimes(1);
});

test('cached registration from another account never suppresses registration', async () => {
  const { sdk, manager } = createFixture();
  storage.getItem.mockImplementation(async key => {
    if (key === REGISTRATION_FINGERPRINT_KEY) {
      return JSON.stringify({
        userId: 41,
        deviceId: 'device-a',
        fingerprint: 'hash-a',
      });
    }
    return '999';
  });

  await manager.activate(42);

  expect(sdk.http.put).toHaveBeenCalledTimes(1);
});

test('malformed cache and a future timestamp cannot suppress registration', async () => {
  const { sdk, manager } = createFixture();
  storage.getItem.mockImplementation(async key =>
    key === REGISTRATION_FINGERPRINT_KEY ? '{invalid' : '2000',
  );

  await manager.activate(42);

  expect(sdk.http.put).toHaveBeenCalledTimes(1);
});

test('cache read failure does not prevent registration and native activation', async () => {
  const { sdk, nativePush, manager } = createFixture();
  storage.getItem.mockRejectedValue(new Error('storage unavailable'));

  await expect(manager.activate(42)).resolves.toBeUndefined();

  expect(sdk.http.put).toHaveBeenCalledTimes(1);
  expect(nativePush.setActiveUserId).toHaveBeenCalledWith(42);
});

test('cache write failure does not undo a successful registration', async () => {
  const { sdk, nativePush, manager } = createFixture();
  storage.setItem.mockRejectedValue(new Error('storage unavailable'));

  await expect(manager.activate(42)).resolves.toBeUndefined();

  expect(sdk.http.put).toHaveBeenCalledTimes(1);
  expect(nativePush.setActiveUserId).toHaveBeenCalledWith(42);
});

test('concurrent activation for one account shares one PUT', async () => {
  const { sdk, manager } = createFixture();
  let release!: () => void;
  sdk.http.put.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );

  const first = manager.activate(42);
  const second = manager.activate(42);
  await waitForCall(sdk.http.put);
  release();
  await Promise.all([first, second]);

  expect(sdk.http.put).toHaveBeenCalledTimes(1);
});

test('a superseded activation cannot restore the old native account', async () => {
  const { sdk, nativePush, manager } = createFixture();
  let releaseFirst!: () => void;
  sdk.http.put
    .mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          releaseFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(undefined);

  const oldActivation = manager.activate(41);
  await waitForCall(sdk.http.put);
  const newActivation = manager.activate(42);
  releaseFirst();
  await Promise.all([oldActivation, newActivation]);

  expect(nativePush.setActiveUserId).not.toHaveBeenCalledWith(41);
  expect(nativePush.setActiveUserId).toHaveBeenLastCalledWith(42);
});

test('activate does nothing while system notifications are disabled', async () => {
  const { sdk, nativePush, manager } = createFixture();
  nativePush.areNotificationsEnabled.mockResolvedValue(false);

  await manager.activate(42);

  expect(sdk.http.put).not.toHaveBeenCalled();
  expect(nativePush.setActiveUserId).not.toHaveBeenCalled();
});

test('deactivate clears native account before best-effort delete and local cache', async () => {
  const { sdk, nativePush, manager } = createFixture();

  await manager.deactivate();

  expect(nativePush.clearActiveUserId.mock.invocationCallOrder[0]).toBeLessThan(
    sdk.http.delete.mock.invocationCallOrder[0],
  );
  expect(sdk.http.delete).toHaveBeenCalledWith(
    '/im/push/registrations/device-a',
  );
  expect(storage.removeMany).toHaveBeenCalledWith([
    REGISTRATION_FINGERPRINT_KEY,
    REGISTRATION_TIME_KEY,
  ]);
});

test('deactivate still clears local cache when resolving device id fails', async () => {
  const { sdk, manager } = createFixture();
  sdk.installationDeviceId.mockRejectedValue(
    new Error('secret fid should not leak'),
  );

  await expect(manager.deactivate()).resolves.toBeUndefined();

  expect(storage.removeMany).toHaveBeenCalled();
  expect(sdk.http.delete).not.toHaveBeenCalled();
});

test('native and storage cleanup failures do not prevent server deletion', async () => {
  const { sdk, nativePush, manager } = createFixture();
  nativePush.clearActiveUserId.mockRejectedValue(
    new Error('native unavailable'),
  );
  storage.removeMany.mockRejectedValue(new Error('storage unavailable'));

  await expect(manager.deactivate()).resolves.toBeUndefined();

  expect(sdk.http.delete).toHaveBeenCalledWith(
    '/im/push/registrations/device-a',
  );
});
