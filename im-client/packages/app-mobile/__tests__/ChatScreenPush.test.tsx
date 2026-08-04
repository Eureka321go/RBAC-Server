import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {ChatScreen} from '../src/screens/ChatScreen';

const mockClearConversationNotification = jest.fn(
  async (_cid: unknown) => undefined,
);
const mockGetChatMessages = jest.fn(async (_cid: string) => []);
const mockGetReadState = jest.fn(async (_cid: string) => ({peerReadSeq: null}));
const mockSdkOn = jest.fn((_event: string, _listener: unknown) => jest.fn());
const mockCancelVoiceRecording = jest.fn(async () => undefined);
const mockVoiceRecording = {
  state: {active: false, starting: false, cancelling: false},
  cancel: mockCancelVoiceRecording,
  ensurePermission: jest.fn(async () => true),
  start: jest.fn(),
  finish: jest.fn(),
  setCancelling: jest.fn(),
};

jest.mock('react-native/Libraries/Lists/FlatList', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../src/push/nativePush', () => ({
  nativePush: {
    clearConversationNotification: (cid: string) =>
      mockClearConversationNotification(cid),
  },
}));

jest.mock('../src/sdk', () => ({
  sdk: {
    chat: {
      getChatMessages: (cid: string) => mockGetChatMessages(cid),
      getReadState: (cid: string) => mockGetReadState(cid),
      markRead: jest.fn(async () => undefined),
      on: (event: string, listener: unknown) => mockSdkOn(event, listener),
    },
    connection: {
      on: (event: string, listener: unknown) => mockSdkOn(event, listener),
    },
    voice: {heard: {listHeardSeqs: jest.fn(async () => new Set())}},
  },
}));

jest.mock('../src/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({myId: 42, displayName: '我'}),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactModule = require('react');
    ReactModule.useEffect(effect, [effect]);
  },
}));

jest.mock('../src/ui/ThemeProvider', () => ({
  useAppTheme: () => ({
    theme: {
      colors: new Proxy({}, {get: () => '#000000'}),
    },
  }),
}));

jest.mock('../src/voice/useVoiceRecording', () => ({
  useVoiceRecording: () => mockVoiceRecording,
}));

jest.mock('../src/voice/voicePlaybackCoordinator', () => ({
  voiceMessageKey: jest.fn(),
  voicePlaybackCoordinator: {
    pause: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    getSnapshot: () => ({key: null}),
  },
}));

jest.mock('../src/components/ChatHeader', () => ({ChatHeader: () => null}));
jest.mock('../src/components/ChatComposerSurface', () => ({
  ChatComposerSurface: () => null,
}));
jest.mock('../src/components/MessageActionSheet', () => ({
  MessageActionSheet: () => null,
}));
jest.mock('../src/components/MentionPickerSheet', () => ({
  MentionPickerSheet: () => null,
}));
jest.mock('../src/components/AttachmentPickerSheet', () => ({
  AttachmentPickerSheet: () => null,
}));
jest.mock('../src/components/ImagePreviewModal', () => ({
  ImagePreviewModal: () => null,
}));
jest.mock('../src/components/VoiceRecordingOverlay', () => ({
  VoiceRecordingOverlay: () => null,
}));

function props(cid: string) {
  return {
    route: {
      key: `Chat-${cid}`,
      name: 'Chat' as const,
      params: {
        cid,
        title: '张三',
        conversationType: 'SINGLE' as const,
        syncOnOpen: false,
      },
    },
    navigation: {} as never,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClearConversationNotification.mockRejectedValue(new Error('native'));
});

test('clears the current conversation notification without blocking message loading', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<ChatScreen {...props('c_1_42')} />);
  });

  expect(mockClearConversationNotification).toHaveBeenCalledWith('c_1_42');
  expect(mockGetChatMessages).toHaveBeenCalledWith('c_1_42');

  await ReactTestRenderer.act(async () => {
    renderer.update(<ChatScreen {...props('c_2_42')} />);
  });

  expect(mockClearConversationNotification).toHaveBeenCalledWith('c_2_42');
  expect(mockGetChatMessages).toHaveBeenCalledWith('c_2_42');
});
