import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import {
  PERMISSION_PROMPTED_KEY,
  cancelPendingPushPermissionPrompt,
  handlePushPermissionAfterLogin,
  preparePushAfterLogin,
  reconcilePushRegistrationOnForeground,
  shouldPromptForNotifications,
} from '../src/push/pushPermission';

jest.mock('../src/push/pushRegistration', () => ({ pushRegistration: {} }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const manager = {
  activate: jest.fn<Promise<void>, [number]>(async () => undefined),
  deactivate: jest.fn<Promise<void>, []>(async () => undefined),
  refreshIfDue: jest.fn<Promise<void>, []>(async () => undefined),
};
const push = {
  areNotificationsEnabled: jest.fn<Promise<boolean>, []>(async () => false),
  setActiveUserId: jest.fn<Promise<void>, [number]>(async () => undefined),
};

beforeEach(() => {
  jest.clearAllMocks();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue(undefined);
  manager.activate.mockResolvedValue(undefined);
  manager.deactivate.mockResolvedValue(undefined);
  manager.refreshIfDue.mockResolvedValue(undefined);
  push.areNotificationsEnabled.mockResolvedValue(false);
  push.setActiveUserId.mockResolvedValue(undefined);
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: 'android',
  });
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 33 });
});

test.each([
  [{ androidVersion: 32, prompted: false, enabled: true }, false],
  [{ androidVersion: 33, prompted: false, enabled: false }, true],
  [{ androidVersion: 33, prompted: true, enabled: false }, false],
])('shouldPrompt(%o) is %s', (input, expected) => {
  expect(shouldPromptForNotifications(input)).toBe(expected);
});

test('non-Android platforms never prompt or register', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });

  expect(
    shouldPromptForNotifications({
      androidVersion: 33,
      prompted: false,
      enabled: false,
    }),
  ).toBe(false);
  await handlePushPermissionAfterLogin(42, manager, push, storage);

  expect(push.areNotificationsEnabled).not.toHaveBeenCalled();
  expect(manager.activate).not.toHaveBeenCalled();
});

test('an already stale direct permission task exits before native queries', async () => {
  await handlePushPermissionAfterLogin(
    42,
    manager,
    push,
    storage,
    Number.MIN_SAFE_INTEGER,
  );

  expect(push.areNotificationsEnabled).not.toHaveBeenCalled();
  expect(storage.getItem).not.toHaveBeenCalled();
});

test('Android 12 activates immediately without an explanation', async () => {
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 32 });
  push.areNotificationsEnabled.mockResolvedValue(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

  await handlePushPermissionAfterLogin(42, manager, push, storage);

  expect(alert).not.toHaveBeenCalled();
  expect(manager.activate).toHaveBeenCalledWith(42);
});

test('an unrecognized Android version safely follows the pre-13 path', async () => {
  Object.defineProperty(Platform, 'Version', {
    configurable: true,
    value: 'unknown',
  });

  await handlePushPermissionAfterLogin(42, manager, push, storage);

  expect(manager.activate).toHaveBeenCalledWith(42);
});

test('prepare binds the native account before a pending remote registration', async () => {
  push.areNotificationsEnabled.mockResolvedValue(true);
  let finishRegistration: (() => void) | undefined;
  manager.activate.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finishRegistration = resolve;
      }),
  );

  const preparing = preparePushAfterLogin(42, manager, push, storage);
  for (
    let index = 0;
    index < 20 && manager.activate.mock.calls.length === 0;
    index += 1
  ) {
    await Promise.resolve();
  }

  expect(push.setActiveUserId).toHaveBeenCalledWith(42);
  expect(push.setActiveUserId.mock.invocationCallOrder[0]).toBeLessThan(
    manager.activate.mock.invocationCallOrder[0],
  );
  finishRegistration?.();
  await preparing;
});

test('cancel while native binding is pending stops all later preparation work', async () => {
  push.areNotificationsEnabled.mockResolvedValue(true);
  let finishBinding: (() => void) | undefined;
  push.setActiveUserId.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finishBinding = resolve;
      }),
  );

  const preparing = preparePushAfterLogin(42, manager, push, storage);
  for (
    let index = 0;
    index < 20 && push.setActiveUserId.mock.calls.length === 0;
    index += 1
  ) {
    await Promise.resolve();
  }
  cancelPendingPushPermissionPrompt();
  finishBinding?.();
  await preparing;

  expect(push.areNotificationsEnabled).not.toHaveBeenCalled();
  expect(manager.activate).not.toHaveBeenCalled();
});

test('cancel while notification state is pending prevents stale activation', async () => {
  let finishNotificationCheck: ((enabled: boolean) => void) | undefined;
  push.areNotificationsEnabled.mockImplementationOnce(
    () =>
      new Promise<boolean>(resolve => {
        finishNotificationCheck = resolve;
      }),
  );

  const preparing = preparePushAfterLogin(42, manager, push, storage);
  for (
    let index = 0;
    index < 20 && push.areNotificationsEnabled.mock.calls.length === 0;
    index += 1
  ) {
    await Promise.resolve();
  }
  cancelPendingPushPermissionPrompt();
  finishNotificationCheck?.(true);
  await preparing;

  expect(manager.activate).not.toHaveBeenCalled();
  expect(push.setActiveUserId).toHaveBeenCalledTimes(1);
});

test('a newer login supersedes an older pending preparation', async () => {
  let finishOldBinding: (() => void) | undefined;
  push.setActiveUserId
    .mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishOldBinding = resolve;
        }),
    )
    .mockResolvedValueOnce(undefined);
  push.areNotificationsEnabled.mockResolvedValue(true);

  const oldPreparation = preparePushAfterLogin(41, manager, push, storage);
  for (
    let index = 0;
    index < 20 && push.setActiveUserId.mock.calls.length === 0;
    index += 1
  ) {
    await Promise.resolve();
  }
  const newPreparation = preparePushAfterLogin(42, manager, push, storage);
  await newPreparation;
  finishOldBinding?.();
  await oldPreparation;

  expect(manager.activate).toHaveBeenCalledTimes(1);
  expect(manager.activate).toHaveBeenCalledWith(42);
});

test('native binding failure does not block best-effort registration', async () => {
  push.setActiveUserId.mockRejectedValue(new Error('native unavailable'));
  push.areNotificationsEnabled.mockResolvedValue(true);
  manager.activate.mockRejectedValue(new Error('PUT failed'));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  await expect(
    preparePushAfterLogin(42, manager, push, storage),
  ).resolves.toBeUndefined();

  expect(manager.activate).toHaveBeenCalledWith(42);
});

test('automatic registration failure is contained and logged without its details', async () => {
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 32 });
  push.areNotificationsEnabled.mockResolvedValue(true);
  manager.activate.mockRejectedValue(new Error('fid-secret-value'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  await expect(
    handlePushPermissionAfterLogin(42, manager, push, storage),
  ).resolves.toBeUndefined();

  expect(warn).toHaveBeenCalledWith('自动推送登记失败');
  expect(warn).not.toHaveBeenCalledWith(
    expect.stringContaining('fid-secret-value'),
  );
});

test('Android 13 explains once and marks prompted after rejecting', async () => {
  const alert = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[0]?.onPress?.(),
    );

  await handlePushPermissionAfterLogin(42, manager, push, storage);
  await Promise.resolve();

  expect(alert).toHaveBeenCalledWith(
    expect.any(String),
    expect.stringContaining('用于在应用后台提醒新消息'),
    expect.any(Array),
    { cancelable: false },
  );
  expect(storage.setItem).toHaveBeenCalledWith(PERMISSION_PROMPTED_KEY, 'true');
  expect(manager.activate).not.toHaveBeenCalled();
});

test('Android 13 requests permission once and activates only when granted', async () => {
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[1]?.onPress?.(),
    );

  await handlePushPermissionAfterLogin(42, manager, push, storage);
  await Promise.resolve();
  await Promise.resolve();

  expect(PermissionsAndroid.request).toHaveBeenCalledWith(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  expect(storage.setItem).toHaveBeenCalledWith(PERMISSION_PROMPTED_KEY, 'true');
  expect(manager.activate).toHaveBeenCalledWith(42);
});

test('Android 13 records a system denial without activating push', async () => {
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
  jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[1]?.onPress?.(),
    );

  await handlePushPermissionAfterLogin(42, manager, push, storage);
  await Promise.resolve();
  await Promise.resolve();

  expect(storage.setItem).toHaveBeenCalledWith(PERMISSION_PROMPTED_KEY, 'true');
  expect(manager.activate).not.toHaveBeenCalled();
});

test('concurrent login completion never presents duplicate explanations', async () => {
  let dismiss: (() => void) | undefined;
  const alert = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) => {
      dismiss = buttons?.[0]?.onPress;
    });

  await Promise.all([
    handlePushPermissionAfterLogin(42, manager, push, storage),
    handlePushPermissionAfterLogin(42, manager, push, storage),
  ]);

  expect(alert).toHaveBeenCalledTimes(1);
  dismiss?.();
  await Promise.resolve();
});

test('a permission response after logout cannot reactivate the old account', async () => {
  let enable: (() => void) | undefined;
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    enable = buttons?.[1]?.onPress;
  });
  await handlePushPermissionAfterLogin(42, manager, push, storage);

  cancelPendingPushPermissionPrompt();
  enable?.();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(manager.activate).not.toHaveBeenCalled();
});

test('an Alert bridge failure resets prompt state for a later retry', async () => {
  const alert = jest
    .spyOn(Alert, 'alert')
    .mockImplementationOnce(() => {
      throw new Error('alert unavailable');
    })
    .mockImplementation(() => undefined);

  await expect(
    handlePushPermissionAfterLogin(42, manager, push, storage),
  ).rejects.toThrow('alert unavailable');
  await handlePushPermissionAfterLogin(42, manager, push, storage);

  expect(alert).toHaveBeenCalledTimes(2);
  cancelPendingPushPermissionPrompt();
});

test('enabled Android 13 activates without repeating an old prompt', async () => {
  storage.getItem.mockResolvedValue('true');
  push.areNotificationsEnabled.mockResolvedValue(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

  await handlePushPermissionAfterLogin(42, manager, push, storage);

  expect(alert).not.toHaveBeenCalled();
  expect(manager.activate).toHaveBeenCalledWith(42);
});

test('foreground reconciliation deactivates when notifications were disabled', async () => {
  push.areNotificationsEnabled.mockResolvedValue(false);

  await reconcilePushRegistrationOnForeground(42, manager, push);

  expect(manager.deactivate).toHaveBeenCalledTimes(1);
  expect(manager.activate).not.toHaveBeenCalled();
});

test('foreground reconciliation refreshes when notifications are enabled', async () => {
  push.areNotificationsEnabled.mockResolvedValue(true);

  await reconcilePushRegistrationOnForeground(42, manager, push);

  expect(manager.activate).toHaveBeenCalledWith(42);
});

test('foreground reconciliation stops when logout happens during its state query', async () => {
  let finishNotificationCheck: ((enabled: boolean) => void) | undefined;
  push.areNotificationsEnabled.mockImplementationOnce(
    () =>
      new Promise<boolean>(resolve => {
        finishNotificationCheck = resolve;
      }),
  );

  const reconciliation = reconcilePushRegistrationOnForeground(
    42,
    manager,
    push,
  );
  await Promise.resolve();
  cancelPendingPushPermissionPrompt();
  finishNotificationCheck?.(true);
  await reconciliation;

  expect(manager.activate).not.toHaveBeenCalled();
  expect(manager.deactivate).not.toHaveBeenCalled();
});
