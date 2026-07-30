import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { Http } from '@im/sdk-core';

interface AuthRecovery {
  refreshAccessToken(): Promise<string>;
  onSessionExpired(): Promise<void>;
}

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  authRetried?: boolean;
}

const UNAUTHENTICATED_PATHS = new Set(['/auth/login', '/auth/refresh-token']);
const RECOVERY_EXCLUDED_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/refresh-token',
]);

function requestPath(url: string | undefined): string {
  return (url ?? '').split('?')[0];
}

export class AxiosHttp implements Http {
  private readonly client: AxiosInstance;
  private authRecovery: AuthRecovery | null = null;
  private refreshFlight: Promise<string> | null = null;
  private expirationFlight: Promise<void> | null = null;

  constructor(baseURL: string, getToken: () => Promise<string | null>) {
    this.client = axios.create({ baseURL, timeout: 15000 });
    this.client.interceptors.request.use(async (cfg) => {
      const token = await getToken();
      if (token && !UNAUTHENTICATED_PATHS.has(requestPath(cfg.url))) {
        cfg.headers.set('Authorization', `Bearer ${token}`);
      }
      return cfg;
    });
    this.client.interceptors.response.use(
      (response) => response,
      async (cause: unknown) => {
        if (!axios.isAxiosError(cause)) return Promise.reject(cause);
        const config = cause.config as RetriableRequestConfig | undefined;
        if (
          cause.response?.status !== 401
          || config == null
          || config.authRetried === true
          || RECOVERY_EXCLUDED_PATHS.has(requestPath(config.url))
          || this.authRecovery == null
        ) {
          return Promise.reject(cause);
        }

        config.authRetried = true;
        try {
          const accessToken = await this.refreshOnce();
          config.headers.set('Authorization', `Bearer ${accessToken}`);
          return await this.client.request(config);
        } catch (refreshCause) {
          await this.expireSessionOnce();
          return Promise.reject(refreshCause);
        }
      },
    );
  }

  configureAuthRecovery(recovery: AuthRecovery): void {
    this.authRecovery = recovery;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const res = await this.client.get<T>(path, { params });
    return res.data;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.client.post<T>(path, body);
    return res.data;
  }

  async put<T = void>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    const res = await this.client.put<T>(url, body, { headers });
    return res.data;
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.client.patch<T>(path, body);
    return res.data;
  }

  async delete<T>(path: string): Promise<T> {
    const res = await this.client.delete<T>(path);
    return res.data;
  }

  private refreshOnce(): Promise<string> {
    if (this.authRecovery == null) return Promise.reject(new Error('AUTH_RECOVERY_UNAVAILABLE'));
    if (this.refreshFlight == null) {
      const flight = this.authRecovery.refreshAccessToken().finally(() => {
        if (this.refreshFlight === flight) this.refreshFlight = null;
      });
      this.refreshFlight = flight;
    }
    return this.refreshFlight;
  }

  private expireSessionOnce(): Promise<void> {
    if (this.authRecovery == null) return Promise.resolve();
    if (this.expirationFlight == null) {
      const flight = this.authRecovery.onSessionExpired().finally(() => {
        if (this.expirationFlight === flight) this.expirationFlight = null;
      });
      this.expirationFlight = flight;
    }
    return this.expirationFlight;
  }
}
