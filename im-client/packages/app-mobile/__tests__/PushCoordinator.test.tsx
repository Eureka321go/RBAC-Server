import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type {PushOpenEvent} from '../src/push/nativePush';
import {PushCoordinator} from '../src/push/PushCoordinator';

const mockNavigate = jest.fn((_name: string, _params: unknown) => undefined);
const mockIsReady = jest.fn(() => false);
const mockSyncConversation = jest.fn(async (_cid: string) => undefined);
const mockSyncAll = jest.fn(async () => undefined);
const mockState = {booted: false, myId: null as number | null};
const mockHandlers: Record<string, ((event?: unknown) => void) | undefined> = {};
const mockRemovers = {
  foregroundMessage: jest.fn(),
  notificationOpened: jest.fn(),
  syncAllRequired: jest.fn(),
};
let mockInitialOpenPromise: Promise<PushOpenEvent | null> = Promise.resolve(null);

jest.mock('../src/navigation/navigationRef', () => ({
  navigationRef: {
    navigate: (name: string, params: unknown) => mockNavigate(name, params),
    isReady: () => mockIsReady(),
  },
}));

jest.mock('../src/sdk', () => ({
  sdk: {
    sync: {
      syncConversation: (cid: string) => mockSyncConversation(cid),
      syncAll: () => mockSyncAll(),
    },
  },
}));

jest.mock('../src/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof mockState) => unknown) => selector(mockState),
    {getState: () => mockState},
  );
  return {useAppStore};
});

jest.mock('../src/push/nativePush', () => ({
  nativePush: {
    getInitialOpenEvent: () => mockInitialOpenPromise,
    onForegroundMessage: (handler: (event: unknown) => void) => {
      mockHandlers.foregroundMessage = handler;
      return mockRemovers.foregroundMessage;
    },
    onNotificationOpened: (handler: (event: unknown) => void) => {
      mockHandlers.notificationOpened = handler;
      return mockRemovers.notificationOpened;
    },
    onSyncAllRequired: (handler: () => void) => {
      mockHandlers.syncAllRequired = handler;
      return mockRemovers.syncAllRequired;
    },
  },
}));

function groupOpen(cid: string, recipientUserId = 42): PushOpenEvent {
  return {
    recipientUserId,
    cid,
    conversationType: 'GROUP',
    groupId: 100,
    title: '项目群',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return {promise, resolve};
}

async function renderCoordinator(navigationRevision = 0) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <PushCoordinator navigationRevision={navigationRevision} />,
    );
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.booted = false;
  mockState.myId = null;
  mockIsReady.mockReturnValue(false);
  mockInitialOpenPromise = Promise.resolve(null);
  Object.keys(mockHandlers).forEach(key => delete mockHandlers[key]);
});

test('foreground message syncs the conversation without navigating', async () => {
  await renderCoordinator();

  await ReactTestRenderer.act(async () => {
    mockHandlers.foregroundMessage?.({cid: 'c_1_2'});
  });

  expect(mockSyncConversation).toHaveBeenCalledWith('c_1_2');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('sync-all request uses the existing full sync and contains rejection', async () => {
  mockSyncAll.mockRejectedValueOnce(new Error('offline'));
  await renderCoordinator();

  await ReactTestRenderer.act(async () => {
    mockHandlers.syncAllRequired?.();
  });

  expect(mockSyncAll).toHaveBeenCalledTimes(1);
});

test('retains an opened notification until navigation becomes ready', async () => {
  mockState.booted = true;
  mockState.myId = 42;
  const renderer = await renderCoordinator(0);

  await ReactTestRenderer.act(async () => {
    mockHandlers.notificationOpened?.(groupOpen('g_waiting'));
  });
  expect(mockNavigate).not.toHaveBeenCalled();

  mockIsReady.mockReturnValue(true);
  await ReactTestRenderer.act(async () => {
    renderer.update(<PushCoordinator navigationRevision={1} />);
  });

  expect(mockNavigate).toHaveBeenCalledWith('Chat', {
    cid: 'g_waiting',
    title: '项目群',
    conversationType: 'GROUP',
    groupId: 100,
    syncOnOpen: true,
  });
});

test('a live open supersedes an unresolved cold-start event', async () => {
  const initial = deferred<PushOpenEvent | null>();
  mockInitialOpenPromise = initial.promise;
  mockState.booted = true;
  mockState.myId = 42;
  const renderer = await renderCoordinator(0);

  await ReactTestRenderer.act(async () => {
    mockHandlers.notificationOpened?.(groupOpen('g_live'));
    initial.resolve(groupOpen('g_initial'));
    await initial.promise;
  });
  mockIsReady.mockReturnValue(true);
  await ReactTestRenderer.act(async () => {
    renderer.update(<PushCoordinator navigationRevision={1} />);
  });

  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith(
    'Chat',
    expect.objectContaining({cid: 'g_live'}),
  );
});

test('does not inject an unresolved initial event after account switch', async () => {
  const initial = deferred<PushOpenEvent | null>();
  mockInitialOpenPromise = initial.promise;
  mockState.booted = true;
  mockState.myId = 42;
  mockIsReady.mockReturnValue(true);
  const renderer = await renderCoordinator(0);

  mockState.myId = 99;
  await ReactTestRenderer.act(async () => {
    renderer.update(<PushCoordinator navigationRevision={0} />);
    initial.resolve(groupOpen('g_stale', 42));
    await initial.promise;
  });
  mockState.myId = 42;
  await ReactTestRenderer.act(async () => {
    renderer.update(<PushCoordinator navigationRevision={1} />);
  });

  expect(mockNavigate).not.toHaveBeenCalled();
});

test('invalidates an initial event even when the original account logs back in', async () => {
  const initial = deferred<PushOpenEvent | null>();
  mockInitialOpenPromise = initial.promise;
  mockState.booted = true;
  mockState.myId = 42;
  mockIsReady.mockReturnValue(true);
  const renderer = await renderCoordinator(0);

  mockState.myId = 99;
  await ReactTestRenderer.act(async () => {
    renderer.update(<PushCoordinator navigationRevision={0} />);
  });
  mockState.myId = 42;
  await ReactTestRenderer.act(async () => {
    renderer.update(<PushCoordinator navigationRevision={1} />);
  });
  await ReactTestRenderer.act(async () => {
    initial.resolve(groupOpen('g_stale_after_switch', 42));
    await initial.promise;
  });

  expect(mockNavigate).not.toHaveBeenCalled();
});

test('retains an unresolved initial event while a user logs in', async () => {
  const initial = deferred<PushOpenEvent | null>();
  mockInitialOpenPromise = initial.promise;
  mockState.booted = true;
  mockState.myId = null;
  mockIsReady.mockReturnValue(true);
  const renderer = await renderCoordinator(0);

  mockState.myId = 42;
  await ReactTestRenderer.act(async () => {
    renderer.update(<PushCoordinator navigationRevision={0} />);
  });
  await ReactTestRenderer.act(async () => {
    initial.resolve(groupOpen('g_after_login', 42));
    await initial.promise;
  });

  expect(mockNavigate).toHaveBeenCalledWith(
    'Chat',
    expect.objectContaining({cid: 'g_after_login'}),
  );
});

test('deduplicates the live copy of a consumed cold-start open', async () => {
  mockInitialOpenPromise = Promise.resolve(groupOpen('g_cold'));
  mockState.booted = true;
  mockState.myId = 42;
  mockIsReady.mockReturnValue(true);
  await renderCoordinator();

  await ReactTestRenderer.act(async () => {
    mockHandlers.notificationOpened?.(groupOpen('g_cold'));
  });

  expect(mockNavigate).toHaveBeenCalledTimes(1);
});

test('allows a later notification with the same conversation metadata', async () => {
  jest.useFakeTimers();
  try {
    mockInitialOpenPromise = Promise.resolve(groupOpen('g_repeat'));
    mockState.booted = true;
    mockState.myId = 42;
    mockIsReady.mockReturnValue(true);
    await renderCoordinator();

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1_001);
      mockHandlers.notificationOpened?.(groupOpen('g_repeat'));
    });

    expect(mockNavigate).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('ignores an initial event resolved after unmount and removes subscriptions once', async () => {
  const initial = deferred<PushOpenEvent | null>();
  mockInitialOpenPromise = initial.promise;
  mockState.booted = true;
  mockState.myId = 42;
  mockIsReady.mockReturnValue(true);
  const renderer = await renderCoordinator();

  await ReactTestRenderer.act(async () => renderer.unmount());
  await ReactTestRenderer.act(async () => {
    initial.resolve(groupOpen('g_late'));
    await initial.promise;
  });

  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockRemovers.foregroundMessage).toHaveBeenCalledTimes(1);
  expect(mockRemovers.notificationOpened).toHaveBeenCalledTimes(1);
  expect(mockRemovers.syncAllRequired).toHaveBeenCalledTimes(1);
});
