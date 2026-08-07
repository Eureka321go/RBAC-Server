import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

export interface PushOpenEvent {
  recipientUserId: number;
  cid: string;
  conversationType: 'SINGLE' | 'GROUP';
  groupId?: number;
  title: string;
}

export interface RegistrationTarget {
  targetType: 'FID' | 'TOKEN';
  targetValue: string;
  targetFingerprint: string;
  appVersion: string;
}

export interface ForegroundMessageEvent {
  cid: string;
}

type NativePushModule = {
  getRegistrationTarget(): Promise<unknown>;
  setActiveUserId(userId: number): Promise<void>;
  clearActiveUserId(): Promise<void>;
  areNotificationsEnabled(): Promise<boolean>;
  getInitialOpenEvent(): Promise<unknown>;
  clearConversationNotification(cid: string): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  listenerReady?(eventName: string): void;
  listenerRemoved?(eventName: string): void;
};

type EventName =
  | 'foregroundMessage'
  | 'notificationOpened'
  | 'syncAllRequired';

const noop = () => {};
const MAX_CID_LENGTH = 64;
const MAX_TITLE_LENGTH = 128;

function moduleOrNull(): NativePushModule | null {
  if (Platform.OS !== 'android') return null;
  return (NativeModules.PushNotification as NativePushModule | undefined) ?? null;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
  );
}

function isSafeId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function normalizeRegistrationTarget(value: unknown): RegistrationTarget | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.targetType !== 'FID' && candidate.targetType !== 'TOKEN') ||
    !isBoundedText(candidate.targetValue, 4096) ||
    !isBoundedText(candidate.targetFingerprint, 128) ||
    !isBoundedText(candidate.appVersion, 128)
  ) {
    return null;
  }
  return {
    targetType: candidate.targetType,
    targetValue: candidate.targetValue,
    targetFingerprint: candidate.targetFingerprint,
    appVersion: candidate.appVersion,
  };
}

function normalizeOpenEvent(value: unknown): PushOpenEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !isSafeId(candidate.recipientUserId) ||
    !isBoundedText(candidate.cid, MAX_CID_LENGTH) ||
    (candidate.conversationType !== 'SINGLE' && candidate.conversationType !== 'GROUP') ||
    !isBoundedText(candidate.title, MAX_TITLE_LENGTH)
  ) {
    return null;
  }
  if (candidate.conversationType === 'GROUP' && !isSafeId(candidate.groupId)) {
    return null;
  }
  if (candidate.conversationType === 'SINGLE' && candidate.groupId !== undefined) {
    return null;
  }
  return {
    recipientUserId: candidate.recipientUserId,
    cid: candidate.cid,
    conversationType: candidate.conversationType,
    ...(candidate.conversationType === 'GROUP' ? {groupId: candidate.groupId as number} : {}),
    title: candidate.title,
  };
}

function subscribe(eventName: EventName, listener: (payload: unknown) => void): () => void {
  const nativeModule = moduleOrNull();
  if (!nativeModule) return noop;
  const subscription = new NativeEventEmitter(nativeModule).addListener(eventName, listener);
  nativeModule.listenerReady?.(eventName);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    nativeModule.listenerRemoved?.(eventName);
    subscription.remove();
  };
}

export const nativePush = {
  async getRegistrationTarget(): Promise<RegistrationTarget | null> {
    const nativeModule = moduleOrNull();
    if (!nativeModule) return null;
    try {
      return normalizeRegistrationTarget(await nativeModule.getRegistrationTarget());
    } catch {
      return null;
    }
  },

  async setActiveUserId(userId: number): Promise<void> {
    const nativeModule = moduleOrNull();
    if (!nativeModule) return;
    if (!isSafeId(userId)) {
      await nativeModule.clearActiveUserId();
      return;
    }
    await nativeModule.setActiveUserId(userId);
  },

  async clearActiveUserId(): Promise<void> {
    await moduleOrNull()?.clearActiveUserId();
  },

  async areNotificationsEnabled(): Promise<boolean> {
    try {
      return (await moduleOrNull()?.areNotificationsEnabled()) === true;
    } catch {
      return false;
    }
  },

  async getInitialOpenEvent(): Promise<PushOpenEvent | null> {
    const nativeModule = moduleOrNull();
    if (!nativeModule) return null;
    try {
      return normalizeOpenEvent(await nativeModule.getInitialOpenEvent());
    } catch {
      return null;
    }
  },

  async clearConversationNotification(cid: string): Promise<void> {
    const nativeModule = moduleOrNull();
    if (!nativeModule || !isBoundedText(cid, MAX_CID_LENGTH)) return;
    await nativeModule.clearConversationNotification(cid);
  },

  onForegroundMessage(listener: (event: ForegroundMessageEvent) => void): () => void {
    return subscribe('foregroundMessage', value => {
      if (typeof value !== 'object' || value === null) return;
      const cid = (value as Record<string, unknown>).cid;
      if (isBoundedText(cid, MAX_CID_LENGTH)) listener({cid});
    });
  },

  onNotificationOpened(listener: (event: PushOpenEvent) => void): () => void {
    return subscribe('notificationOpened', value => {
      const event = normalizeOpenEvent(value);
      if (event) listener(event);
    });
  },

  onSyncAllRequired(listener: () => void): () => void {
    return subscribe('syncAllRequired', () => listener());
  },
};
