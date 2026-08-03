import type {PushOpenEvent} from '../src/push/nativePush';
import {PushNavigationQueue} from '../src/push/pushNavigation';

function openEvent(overrides: Partial<PushOpenEvent> = {}): PushOpenEvent {
  return {
    recipientUserId: 42,
    cid: 'g_100',
    conversationType: 'GROUP',
    groupId: 100,
    title: '项目群',
    ...overrides,
  };
}

describe('PushNavigationQueue', () => {
  test('waits for boot, authentication and navigation before opening a matching conversation', () => {
    const queue = new PushNavigationQueue();

    queue.accept(openEvent());

    expect(queue.flush({booted: false, myId: null, ready: false})).toBeNull();
    expect(queue.flush({booted: true, myId: null, ready: true})).toBeNull();
    expect(queue.flush({booted: true, myId: 42, ready: false})).toBeNull();
    expect(queue.flush({booted: true, myId: 42, ready: true})).toEqual({
      name: 'Chat',
      params: {
        cid: 'g_100',
        title: '项目群',
        conversationType: 'GROUP',
        groupId: 100,
        syncOnOpen: true,
      },
    });
    expect(queue.hasPending()).toBe(false);
  });

  test('drops the event when another account is already logged in', () => {
    const queue = new PushNavigationQueue();

    queue.accept(openEvent());

    expect(queue.flush({booted: true, myId: 99, ready: true})).toBeNull();
    expect(queue.hasPending()).toBe(false);
  });

  test('keeps only the latest open event', () => {
    const queue = new PushNavigationQueue();
    queue.accept(openEvent({cid: 'g_older', groupId: 1, title: '旧群'}));
    queue.accept(openEvent({cid: 'g_latest', groupId: 2, title: '新群'}));

    expect(queue.flush({booted: true, myId: 42, ready: true})).toEqual({
      name: 'Chat',
      params: {
        cid: 'g_latest',
        title: '新群',
        conversationType: 'GROUP',
        groupId: 2,
        syncOnOpen: true,
      },
    });
  });

  test('does not carry a group id into a single conversation route', () => {
    const queue = new PushNavigationQueue();
    queue.accept(
      openEvent({
        cid: 'c_1_42',
        conversationType: 'SINGLE',
        groupId: undefined,
        title: '张三',
      }),
    );

    expect(queue.flush({booted: true, myId: 42, ready: true})).toEqual({
      name: 'Chat',
      params: {
        cid: 'c_1_42',
        title: '张三',
        conversationType: 'SINGLE',
        syncOnOpen: true,
      },
    });
  });
});
