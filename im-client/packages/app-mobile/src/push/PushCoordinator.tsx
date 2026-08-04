import {useEffect, useRef} from 'react';
import {navigationRef} from '../navigation/navigationRef';
import {sdk} from '../sdk';
import {useAppStore} from '../store';
import {nativePush, type PushOpenEvent} from './nativePush';
import {PushNavigationQueue} from './pushNavigation';

interface Props {
  navigationRevision: number;
}

function openFingerprint(event: PushOpenEvent): string {
  return JSON.stringify([
    event.recipientUserId,
    event.cid,
    event.conversationType,
    event.groupId ?? null,
    event.title,
  ]);
}

export function PushCoordinator({navigationRevision}: Props) {
  const booted = useAppStore(state => state.booted);
  const myId = useAppStore(state => state.myId);
  const queueRef = useRef(new PushNavigationQueue());
  const flushRef = useRef<() => void>(() => {});
  const liveOpenVersionRef = useRef(0);
  const initialStartedRef = useRef(false);
  const suppressNextLiveFingerprintRef = useRef<string | null>(null);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousUserIdRef = useRef(myId);
  const accountGenerationRef = useRef(0);

  if (previousUserIdRef.current !== myId) {
    if (previousUserIdRef.current != null) accountGenerationRef.current += 1;
    previousUserIdRef.current = myId;
  }

  flushRef.current = () => {
    const currentState = useAppStore.getState();
    const action = queueRef.current.flush({
      booted: currentState.booted,
      myId: currentState.myId,
      ready: navigationRef.isReady(),
    });
    if (action != null) navigationRef.navigate(action.name, action.params);
  };

  useEffect(() => {
    const offForeground = nativePush.onForegroundMessage(({cid}) => {
      sdk.sync.syncConversation(cid).catch(() => {});
    });
    const offSyncAll = nativePush.onSyncAllRequired(() => {
      sdk.sync.syncAll().catch(() => {});
    });
    const offOpen = nativePush.onNotificationOpened(event => {
      liveOpenVersionRef.current += 1;
      const fingerprint = openFingerprint(event);
      if (suppressTimerRef.current != null) {
        clearTimeout(suppressTimerRef.current);
        suppressTimerRef.current = null;
      }
      if (suppressNextLiveFingerprintRef.current === fingerprint) {
        suppressNextLiveFingerprintRef.current = null;
        return;
      }
      suppressNextLiveFingerprintRef.current = null;
      queueRef.current.accept(event);
      flushRef.current();
    });

    return () => {
      offForeground();
      offSyncAll();
      offOpen();
      if (suppressTimerRef.current != null) {
        clearTimeout(suppressTimerRef.current);
        suppressTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!booted || initialStartedRef.current) return undefined;
    initialStartedRef.current = true;
    let active = true;
    const startingUserId = useAppStore.getState().myId;
    const startingAccountGeneration = accountGenerationRef.current;
    const startingLiveVersion = liveOpenVersionRef.current;

    nativePush.getInitialOpenEvent().then(event => {
      if (!active || event == null) return;
      if (liveOpenVersionRef.current !== startingLiveVersion) return;
      if (accountGenerationRef.current !== startingAccountGeneration) return;
      if (
        startingUserId != null &&
        useAppStore.getState().myId !== startingUserId
      ) {
        return;
      }
      suppressNextLiveFingerprintRef.current = openFingerprint(event);
      suppressTimerRef.current = setTimeout(() => {
        suppressTimerRef.current = null;
        suppressNextLiveFingerprintRef.current = null;
      }, 1_000);
      queueRef.current.accept(event);
      flushRef.current();
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [booted]);

  useEffect(() => {
    flushRef.current();
  }, [booted, myId, navigationRevision]);

  return null;
}
