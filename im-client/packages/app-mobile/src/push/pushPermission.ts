import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { nativePush } from './nativePush';
import { pushRegistration } from './pushRegistration';

export const PERMISSION_PROMPTED_KEY = 'im.push.permissionPrompted';

export interface PromptState {
  androidVersion: number;
  prompted: boolean;
  enabled: boolean;
}

interface RegistrationManager {
  activate(userId: number): Promise<void>;
  deactivate(): Promise<void>;
  refreshIfDue(): Promise<void>;
}

interface NotificationStateSource {
  areNotificationsEnabled(): Promise<boolean>;
}

interface PushAccountBridge extends NotificationStateSource {
  setActiveUserId(userId: number): Promise<void>;
}

interface PermissionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

let permissionPromptVisible = false;
let permissionPromptGeneration = 0;

export function cancelPendingPushPermissionPrompt(): void {
  permissionPromptGeneration += 1;
}

export function shouldPromptForNotifications(input: PromptState): boolean {
  return (
    Platform.OS === 'android' &&
    input.androidVersion >= 33 &&
    !input.prompted &&
    !input.enabled
  );
}

function androidVersion(): number {
  const version = Number(Platform.Version);
  return Number.isFinite(version) ? version : 0;
}

async function runAutomaticPushAction(
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch {
    console.warn('自动推送登记失败');
  }
}

export async function handlePushPermissionAfterLogin(
  userId: number,
  manager: RegistrationManager = pushRegistration,
  push: NotificationStateSource = nativePush,
  storage: PermissionStorage = AsyncStorage,
): Promise<void> {
  if (Platform.OS !== 'android') return;

  const [enabled, promptedValue] = await Promise.all([
    push.areNotificationsEnabled(),
    storage.getItem(PERMISSION_PROMPTED_KEY),
  ]);
  const promptState = {
    androidVersion: androidVersion(),
    prompted: promptedValue === 'true',
    enabled,
  };

  if (enabled || promptState.androidVersion < 33) {
    await runAutomaticPushAction(() => manager.activate(userId));
    return;
  }
  if (!shouldPromptForNotifications(promptState)) return;
  if (permissionPromptVisible) return;

  permissionPromptVisible = true;
  const promptGeneration = ++permissionPromptGeneration;

  const markPrompted = () =>
    runAutomaticPushAction(() =>
      storage.setItem(PERMISSION_PROMPTED_KEY, 'true'),
    );
  try {
    Alert.alert(
      '开启消息通知',
      '用于在应用后台提醒新消息。',
      [
        {
          text: '暂不开启',
          style: 'cancel',
          onPress: () => {
            void markPrompted().finally(() => {
              permissionPromptVisible = false;
            });
          },
        },
        {
          text: '开启',
          onPress: () => {
            void (async () => {
              try {
                let result: string | null = null;
                try {
                  result = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
                  );
                } finally {
                  await markPrompted();
                }
                if (
                  result === PermissionsAndroid.RESULTS.GRANTED &&
                  promptGeneration === permissionPromptGeneration
                ) {
                  await runAutomaticPushAction(() => manager.activate(userId));
                }
              } finally {
                permissionPromptVisible = false;
              }
            })().catch(() => undefined);
          },
        },
      ],
      { cancelable: false },
    );
  } catch (cause) {
    permissionPromptVisible = false;
    throw cause;
  }
}

export async function preparePushAfterLogin(
  userId: number,
  manager: RegistrationManager = pushRegistration,
  push: PushAccountBridge = nativePush,
  storage: PermissionStorage = AsyncStorage,
): Promise<void> {
  await runAutomaticPushAction(() => push.setActiveUserId(userId));
  await handlePushPermissionAfterLogin(userId, manager, push, storage);
}

export async function reconcilePushRegistrationOnForeground(
  userId: number,
  manager: RegistrationManager = pushRegistration,
  push: NotificationStateSource = nativePush,
): Promise<void> {
  await runAutomaticPushAction(async () => {
    if (await push.areNotificationsEnabled()) {
      await manager.activate(userId);
    } else {
      await manager.deactivate();
    }
  });
}
