const mockDeactivatePush = jest.fn(async () => undefined);
const mockCancelPermissionPrompt = jest.fn();
const mockRecordingCancel = jest.fn(async () => undefined);
const mockPlayerStop = jest.fn(async () => undefined);
const mockAudioDeactivate = jest.fn(async () => undefined);
const mockConnectionStop = jest.fn();
const mockAuthLogout = jest.fn(async () => undefined);
const mockPreparePushAfterLogin = jest.fn(async () => undefined);
const mockAuthLogin = jest.fn(async () => undefined);
const mockFetchMe = jest.fn(async () => ({
  id: 42,
  username: 'user42',
  nickname: '用户 42',
}));
const mockIsAuthenticated = jest.fn(async () => true);
const mockActivateAccount = jest.fn(async () => undefined);
const mockConnectionStart = jest.fn(async () => undefined);

const mockSdk = {
  connection: {
    on: jest.fn(),
    stop: mockConnectionStop,
    start: mockConnectionStart,
  },
  auth: {
    onSessionExpired: jest.fn(),
    logout: mockAuthLogout,
    login: mockAuthLogin,
    fetchMe: mockFetchMe,
    isAuthenticated: mockIsAuthenticated,
  },
  voice: {
    recording: { cancel: mockRecordingCancel },
    player: { stop: mockPlayerStop },
    audioSession: { deactivate: mockAudioDeactivate },
  },
  sync: { activateAccount: mockActivateAccount },
  ready: Promise.resolve(),
};

jest.mock('../src/sdk', () => ({ sdk: mockSdk }));
jest.mock('../src/push/pushPermission', () => ({
  cancelPendingPushPermissionPrompt: mockCancelPermissionPrompt,
  preparePushAfterLogin: mockPreparePushAfterLogin,
}));
jest.mock('../src/push/pushRegistration', () => ({
  pushRegistration: { deactivate: mockDeactivatePush },
}));

const { useAppStore } = require('../src/store');

beforeEach(() => {
  jest.clearAllMocks();
  mockPreparePushAfterLogin.mockResolvedValue(undefined);
  mockAuthLogin.mockResolvedValue(undefined);
  mockFetchMe.mockResolvedValue({
    id: 42,
    username: 'user42',
    nickname: '用户 42',
  });
  mockIsAuthenticated.mockResolvedValue(true);
  mockActivateAccount.mockResolvedValue(undefined);
  mockConnectionStart.mockResolvedValue(undefined);
  useAppStore.setState({ loggedIn: true, myId: 42, displayName: '用户' });
});

test('login sets app state and starts push preparation before websocket startup', async () => {
  let stateSeenByPreparation: unknown;
  mockPreparePushAfterLogin.mockImplementationOnce(async () => {
    stateSeenByPreparation = useAppStore.getState();
  });

  await useAppStore.getState().login('user42', 'password');

  expect(stateSeenByPreparation).toMatchObject({ loggedIn: true, myId: 42 });
  expect(mockPreparePushAfterLogin).toHaveBeenCalledWith(42);
  expect(mockPreparePushAfterLogin.mock.invocationCallOrder[0]).toBeLessThan(
    mockConnectionStart.mock.invocationCallOrder[0],
  );
});

test('session restoration sets app state and starts push preparation before websocket startup', async () => {
  useAppStore.setState({
    booted: false,
    loggedIn: false,
    myId: null,
    displayName: null,
  });
  let stateSeenByPreparation: unknown;
  mockPreparePushAfterLogin.mockImplementationOnce(async () => {
    stateSeenByPreparation = useAppStore.getState();
  });

  await useAppStore.getState().boot();

  expect(stateSeenByPreparation).toMatchObject({ loggedIn: true, myId: 42 });
  expect(mockPreparePushAfterLogin).toHaveBeenCalledWith(42);
  expect(mockPreparePushAfterLogin.mock.invocationCallOrder[0]).toBeLessThan(
    mockConnectionStart.mock.invocationCallOrder[0],
  );
});

test('push preparation failure does not block login or websocket startup', async () => {
  mockPreparePushAfterLogin.mockRejectedValue(new Error('push unavailable'));

  await useAppStore.getState().login('user42', 'password');
  await Promise.resolve();

  expect(mockConnectionStart).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState()).toMatchObject({ loggedIn: true, myId: 42 });
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
