const mockDeactivatePush = jest.fn(async () => undefined);
const mockCancelPermissionPrompt = jest.fn();
const mockRecordingCancel = jest.fn(async () => undefined);
const mockPlayerStop = jest.fn(async () => undefined);
const mockAudioDeactivate = jest.fn(async () => undefined);
const mockConnectionStop = jest.fn();
const mockAuthLogout = jest.fn(async () => undefined);

const mockSdk = {
  connection: {
    on: jest.fn(),
    stop: mockConnectionStop,
    start: jest.fn(async () => undefined),
  },
  auth: {
    onSessionExpired: jest.fn(),
    logout: mockAuthLogout,
  },
  voice: {
    recording: { cancel: mockRecordingCancel },
    player: { stop: mockPlayerStop },
    audioSession: { deactivate: mockAudioDeactivate },
  },
};

jest.mock('../src/sdk', () => ({ sdk: mockSdk }));
jest.mock('../src/push/pushPermission', () => ({
  cancelPendingPushPermissionPrompt: mockCancelPermissionPrompt,
  handlePushPermissionAfterLogin: jest.fn(async () => undefined),
}));
jest.mock('../src/push/pushRegistration', () => ({
  pushRegistration: { deactivate: mockDeactivatePush },
}));

const { useAppStore } = require('../src/store');

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({ loggedIn: true, myId: 42, displayName: '用户' });
});

test('logout clears push then all audio resources before disconnecting and logging out', async () => {
  await useAppStore.getState().logout();

  const order = (mock: jest.Mock) => mock.mock.invocationCallOrder[0];
  expect(order(mockDeactivatePush)).toBeLessThan(order(mockRecordingCancel));
  expect(order(mockRecordingCancel)).toBeLessThan(order(mockPlayerStop));
  expect(order(mockPlayerStop)).toBeLessThan(order(mockAudioDeactivate));
  expect(order(mockAudioDeactivate)).toBeLessThan(order(mockConnectionStop));
  expect(order(mockConnectionStop)).toBeLessThan(order(mockAuthLogout));
  expect(useAppStore.getState()).toMatchObject({
    loggedIn: false,
    myId: null,
    displayName: null,
  });
});
