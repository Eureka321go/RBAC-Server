import AsyncStorage from '@react-native-async-storage/async-storage';
import { sdk } from '../sdk';
import { nativePush, type RegistrationTarget } from './nativePush';

export const REGISTRATION_TIME_KEY = 'im.push.lastRegistrationAt';
export const REGISTRATION_FINGERPRINT_KEY = 'im.push.targetFingerprint';

const REGISTRATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface RegistrationSdk {
  installationDeviceId(): Promise<string>;
  http: {
    put(path: string, body: unknown): Promise<unknown>;
    delete(path: string): Promise<unknown>;
  };
}

interface RegistrationNativePush {
  getRegistrationTarget(): Promise<RegistrationTarget | null>;
  setActiveUserId(userId: number): Promise<void>;
  clearActiveUserId(): Promise<void>;
  areNotificationsEnabled(): Promise<boolean>;
}

interface RegistrationStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeMany(keys: string[]): Promise<void>;
}

interface StoredTargetFingerprint {
  userId: number;
  deviceId: string;
  fingerprint: string;
}

function parseStoredFingerprint(
  value: string | null,
): StoredTargetFingerprint | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredTargetFingerprint>;
    if (
      !Number.isSafeInteger(parsed.userId) ||
      typeof parsed.deviceId !== 'string' ||
      parsed.deviceId.length === 0 ||
      typeof parsed.fingerprint !== 'string' ||
      parsed.fingerprint.length === 0
    ) {
      return null;
    }
    return parsed as StoredTargetFingerprint;
  } catch {
    return null;
  }
}

function isFreshRegistration(value: string | null, nowMs: number): boolean {
  if (value == null) return false;
  const registeredAt = Number(value);
  const age = nowMs - registeredAt;
  return (
    Number.isFinite(registeredAt) && age >= 0 && age < REGISTRATION_MAX_AGE_MS
  );
}

export class PushRegistrationManager {
  private activeUserId: number | null = null;
  private generation = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private activationFlight: { userId: number; promise: Promise<void> } | null =
    null;

  constructor(
    private readonly sdkClient: RegistrationSdk = sdk as unknown as RegistrationSdk,
    private readonly push: RegistrationNativePush = nativePush,
    private readonly storage: RegistrationStorage = AsyncStorage,
    private readonly now: () => number = Date.now,
  ) {}

  activate(userId: number): Promise<void> {
    if (!Number.isSafeInteger(userId) || userId < 0) {
      return Promise.reject(new Error('INVALID_PUSH_USER_ID'));
    }
    if (this.activationFlight?.userId === userId) {
      return this.activationFlight.promise;
    }

    const generation = ++this.generation;
    const promise = this.operationTail.then(() =>
      this.performActivation(userId, generation),
    );
    this.operationTail = promise.catch(() => undefined);
    this.activationFlight = { userId, promise };
    void promise
      .finally(() => {
        if (this.activationFlight?.promise === promise)
          this.activationFlight = null;
      })
      .catch(() => undefined);
    return promise;
  }

  refreshIfDue(): Promise<void> {
    if (this.activeUserId == null) return Promise.resolve();
    return this.activate(this.activeUserId);
  }

  async deactivate(): Promise<void> {
    ++this.generation;
    this.activeUserId = null;
    this.activationFlight = null;
    const previousOperations = this.operationTail;
    const operation = (async () => {
      try {
        await this.push.clearActiveUserId();
      } catch {
        // 本地原生桥失败也不能阻塞后续缓存清理和服务端解绑。
      }
      try {
        await this.storage.removeMany([
          REGISTRATION_FINGERPRINT_KEY,
          REGISTRATION_TIME_KEY,
        ]);
      } catch {
        // 下次登录仍会依据账号和设备校验缓存，不让存储故障阻塞登出。
      }
      await previousOperations.catch(() => undefined);
      try {
        const deviceId = await this.sdkClient.installationDeviceId();
        await this.sdkClient.http.delete(
          `/im/push/registrations/${encodeURIComponent(deviceId)}`,
        );
      } catch {
        // 服务端删除是 best effort；不记录设备标识或 FID。
      }
    })();
    this.operationTail = operation;
    await operation;
  }

  private async performActivation(
    userId: number,
    generation: number,
  ): Promise<void> {
    if (!(await this.push.areNotificationsEnabled())) return;
    if (generation !== this.generation) return;

    const [deviceId, target, storedFingerprint, storedTime] = await Promise.all(
      [
        this.sdkClient.installationDeviceId(),
        this.push.getRegistrationTarget(),
        this.storage.getItem(REGISTRATION_FINGERPRINT_KEY).catch(() => null),
        this.storage.getItem(REGISTRATION_TIME_KEY).catch(() => null),
      ],
    );
    if (generation !== this.generation || target == null) return;

    const cached = parseStoredFingerprint(storedFingerprint);
    const targetMatches =
      cached?.userId === userId &&
      cached.deviceId === deviceId &&
      cached.fingerprint === target.targetFingerprint;
    const registrationIsCurrent =
      targetMatches && isFreshRegistration(storedTime, this.now());

    if (!registrationIsCurrent) {
      await this.sdkClient.http.put(
        `/im/push/registrations/${encodeURIComponent(deviceId)}`,
        {
          platform: 'ANDROID',
          provider: 'FCM',
          targetType: target.targetType,
          targetValue: target.targetValue,
          appVersion: target.appVersion,
        },
      );
      if (generation !== this.generation) return;
      await Promise.all([
        this.storage.setItem(
          REGISTRATION_FINGERPRINT_KEY,
          JSON.stringify({
            userId,
            deviceId,
            fingerprint: target.targetFingerprint,
          }),
        ),
        this.storage.setItem(REGISTRATION_TIME_KEY, String(this.now())),
      ]).catch(() => undefined);
    }

    if (generation !== this.generation) return;
    await this.push.setActiveUserId(userId);
    if (generation === this.generation) this.activeUserId = userId;
  }
}

export const pushRegistration = new PushRegistrationManager();
