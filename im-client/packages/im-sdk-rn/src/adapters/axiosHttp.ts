import axios, { type AxiosInstance } from 'axios';
import type { Http } from '@im/sdk-core';

export class AxiosHttp implements Http {
  private readonly client: AxiosInstance;

  constructor(baseURL: string, getToken: () => Promise<string | null>) {
    this.client = axios.create({ baseURL, timeout: 15000 });
    this.client.interceptors.request.use(async (cfg) => {
      const token = await getToken();
      if (token) {
        cfg.headers.set('Authorization', `Bearer ${token}`);
      }
      return cfg;
    });
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
}
