import {NativeModules, Platform} from 'react-native';

const mockPushModule = {
  getRegistrationTarget: jest.fn(),
  setActiveUserId: jest.fn(),
  clearActiveUserId: jest.fn(),
  areNotificationsEnabled: jest.fn(),
  getInitialOpenEvent: jest.fn(),
  clearConversationNotification: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
  listenerReady: jest.fn(),
  listenerRemoved: jest.fn(),
};

type Listener = (payload: unknown) => void;
const mockListeners = new Map<string, Set<Listener>>();
const mockSubscriptionRemovers: jest.Mock[] = [];

function emit(event: string, payload: unknown) {
  mockListeners.get(event)?.forEach(listener => listener(payload));
}

jest.mock('react-native', () => ({
  NativeModules: {},
  Platform: {OS: 'android'},
  NativeEventEmitter: class {
    addListener(event: string, listener: Listener) {
      const eventListeners = mockListeners.get(event) ?? new Set<Listener>();
      eventListeners.add(listener);
      mockListeners.set(event, eventListeners);
      const remove = jest.fn(() => {
        eventListeners.delete(listener);
        if (eventListeners.size === 0) mockListeners.delete(event);
      });
      mockSubscriptionRemovers.push(remove);
      return {remove};
    }
  },
}));

const {nativePush} = require('../src/push/nativePush');

describe('nativePush', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockListeners.clear();
    mockSubscriptionRemovers.length = 0;
    (Platform as {OS: string}).OS = 'android';
    NativeModules.PushNotification = mockPushModule;
  });

  test('normalizes registration target', async () => {
    expect(Platform.OS).toBe('android');
    mockPushModule.getRegistrationTarget.mockResolvedValue({
      targetType: 'FID',
      targetValue: 'fid-a',
      targetFingerprint: 'hash-a',
      appVersion: '1.0',
    });
    await expect(nativePush.getRegistrationTarget()).resolves.toEqual({
      targetType: 'FID',
      targetValue: 'fid-a',
      targetFingerprint: 'hash-a',
      appVersion: '1.0',
    });
  });

  test('rejects malformed registration targets and open events', async () => {
    mockPushModule.getRegistrationTarget.mockResolvedValue({
      targetType: 'TOKEN',
      targetValue: 'secret',
      targetFingerprint: 'hash',
      appVersion: '1',
    });
    mockPushModule.getInitialOpenEvent.mockResolvedValue({
      recipientUserId: Number.MAX_SAFE_INTEGER + 1,
      cid: 'g_1',
      conversationType: 'GROUP',
      groupId: 1,
      title: '群聊',
    });
    await expect(nativePush.getRegistrationTarget()).resolves.toBeNull();
    await expect(nativePush.getInitialOpenEvent()).resolves.toBeNull();
  });

  test('fails closed when an active user id is unsafe for the JS bridge', async () => {
    mockPushModule.clearActiveUserId.mockResolvedValue(undefined);

    await nativePush.setActiveUserId(Number.MAX_SAFE_INTEGER + 1);

    expect(mockPushModule.setActiveUserId).not.toHaveBeenCalled();
    expect(mockPushModule.clearActiveUserId).toHaveBeenCalledTimes(1);
  });

  test('normalizes native events and unsubscribe removes the listener', () => {
    const opened = jest.fn();
    const foreground = jest.fn();
    const syncAll = jest.fn();
    const offOpen = nativePush.onNotificationOpened(opened);
    nativePush.onForegroundMessage(foreground);
    nativePush.onSyncAllRequired(syncAll);

    emit('notificationOpened', {
      recipientUserId: 42,
      cid: 'g_100',
      conversationType: 'GROUP',
      groupId: 100,
      title: '项目群',
      preview: 'must not cross bridge',
    });
    emit('foregroundMessage', {cid: 'c_1_2'});
    emit('syncAllRequired', {});

    expect(opened).toHaveBeenCalledWith({
      recipientUserId: 42,
      cid: 'g_100',
      conversationType: 'GROUP',
      groupId: 100,
      title: '项目群',
    });
    expect(foreground).toHaveBeenCalledWith({cid: 'c_1_2'});
    expect(syncAll).toHaveBeenCalledTimes(1);

    offOpen();
    expect(mockListeners.has('notificationOpened')).toBe(false);
    expect(mockPushModule.listenerReady).toHaveBeenCalledWith('notificationOpened');
    expect(mockPushModule.listenerRemoved).toHaveBeenCalledWith('notificationOpened');
  });

  test('unsubscribe is idempotent while another listener for the event stays active', () => {
    const first = jest.fn();
    const second = jest.fn();
    const firstOff = nativePush.onForegroundMessage(first);
    const secondOff = nativePush.onForegroundMessage(second);

    firstOff();
    firstOff();
    emit('foregroundMessage', {cid: 'c_1_2'});

    expect(mockPushModule.listenerRemoved).toHaveBeenCalledTimes(1);
    expect(mockPushModule.listenerRemoved).toHaveBeenCalledWith('foregroundMessage');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({cid: 'c_1_2'});
    expect(mockListeners.get('foregroundMessage')).toHaveProperty('size', 1);
    expect(mockSubscriptionRemovers[0]).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionRemovers[1]).not.toHaveBeenCalled();

    secondOff();
    secondOff();
    expect(mockPushModule.listenerRemoved).toHaveBeenCalledTimes(2);
    expect(mockSubscriptionRemovers[0]).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionRemovers[1]).toHaveBeenCalledTimes(1);
    expect(mockListeners.has('foregroundMessage')).toBe(false);
  });

  test('does not deliver malformed native events', () => {
    const opened = jest.fn();
    const foreground = jest.fn();
    nativePush.onNotificationOpened(opened);
    nativePush.onForegroundMessage(foreground);

    emit('notificationOpened', {
      recipientUserId: 42,
      cid: 'g_100',
      conversationType: 'GROUP',
      title: 'missing group id',
    });
    emit('foregroundMessage', {cid: ''});

    expect(opened).not.toHaveBeenCalled();
    expect(foreground).not.toHaveBeenCalled();
  });

  test('returns null safely outside Android', async () => {
    (Platform as {OS: string}).OS = 'ios';
    await expect(nativePush.getRegistrationTarget()).resolves.toBeNull();
    await expect(nativePush.getInitialOpenEvent()).resolves.toBeNull();
    await expect(nativePush.areNotificationsEnabled()).resolves.toBe(false);
    expect(mockPushModule.getRegistrationTarget).not.toHaveBeenCalled();
  });
});
