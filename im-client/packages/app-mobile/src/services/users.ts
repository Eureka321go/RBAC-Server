import type { ApiResult } from '@im/sdk-core';
import { sdk } from '../sdk';

export interface SelectableUser {
  id: number;
  username: string;
  nickname: string | null;
}

interface PageResult<T> {
  records: T[];
}

export function userDisplayName(user: SelectableUser): string {
  return user.nickname?.trim() || user.username;
}

export async function listSelectableUsers(myId: number | null): Promise<SelectableUser[]> {
  const result = await sdk.http.get<ApiResult<PageResult<SelectableUser>>>('/system/users', {
    page: 1,
    pageSize: 100,
  });
  if (result.code !== 200 || !Array.isArray(result.data?.records)) {
    throw new Error(result.message || 'load users failed');
  }
  return result.data.records.filter((user) => user.id !== myId);
}
