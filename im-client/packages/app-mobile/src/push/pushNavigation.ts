import type {RootStackParamList} from '../navigation/types';
import type {PushOpenEvent} from './nativePush';

interface PushNavigationState {
  booted: boolean;
  myId: number | null;
  ready: boolean;
}

export interface PushNavigationAction {
  name: 'Chat';
  params: RootStackParamList['Chat'];
}

export class PushNavigationQueue {
  private pending: PushOpenEvent | null = null;

  accept(event: PushOpenEvent): void {
    this.pending = event;
  }

  flush(state: PushNavigationState): PushNavigationAction | null {
    const event = this.pending;
    if (event == null || !state.booted || state.myId == null) return null;
    if (event.recipientUserId !== state.myId) {
      this.pending = null;
      return null;
    }
    if (!state.ready) return null;

    this.pending = null;
    return {
      name: 'Chat',
      params: {
        cid: event.cid,
        title: event.title,
        conversationType: event.conversationType,
        ...(event.conversationType === 'GROUP' ? {groupId: event.groupId} : {}),
        syncOnOpen: true,
      },
    };
  }

  hasPending(): boolean {
    return this.pending != null;
  }
}
