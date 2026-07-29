import type { ApiResult } from '../auth/authService';
import type { Http } from '../ports/index';

export type GroupRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface GroupDetail {
  groupId: number;
  name: string;
  ownerId: number;
  memberCount: number;
  myRole: GroupRole;
}

export interface GroupMember {
  userId: number;
  role: GroupRole;
  muted: boolean;
}

export interface CreateGroupResult {
  groupId: number;
  cid: string;
}

function dataOf<T>(result: ApiResult<T>, fallback: string): T {
  if (result.code !== 200 || result.data == null) {
    throw new Error(result.message || fallback);
  }
  return result.data;
}

function assertSuccess(result: ApiResult<unknown>, fallback: string): void {
  if (result.code !== 200) {
    throw new Error(result.message || fallback);
  }
}

function uniqueUserIds(userIds: number[]): number[] {
  return [...new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
}

/** 平台无关的群生命周期与成员管理服务。 */
export class GroupService {
  constructor(private readonly http: Http) {}

  async createGroup(name: string, memberIds: number[]): Promise<CreateGroupResult> {
    const result = await this.http.post<ApiResult<CreateGroupResult>>('/im/groups', {
      name: name.trim(),
      memberIds: uniqueUserIds(memberIds),
    });
    return dataOf(result, 'create group failed');
  }

  async getGroup(groupId: number): Promise<GroupDetail> {
    const result = await this.http.get<ApiResult<GroupDetail>>(`/im/groups/${groupId}`);
    return dataOf(result, 'load group failed');
  }

  async getMembers(groupId: number): Promise<GroupMember[]> {
    const result = await this.http.get<ApiResult<GroupMember[]>>(`/im/groups/${groupId}/members`);
    return dataOf(result, 'load group members failed');
  }

  async addMembers(groupId: number, userIds: number[]): Promise<void> {
    const result = await this.http.post<ApiResult<null>>(`/im/groups/${groupId}/members`, {
      userIds: uniqueUserIds(userIds),
    });
    assertSuccess(result, 'add group members failed');
  }

  async removeMember(groupId: number, userId: number): Promise<void> {
    const result = await this.http.delete<ApiResult<null>>(`/im/groups/${groupId}/members/${userId}`);
    assertSuccess(result, 'remove group member failed');
  }

  async renameGroup(groupId: number, name: string): Promise<void> {
    const result = await this.http.patch<ApiResult<null>>(`/im/groups/${groupId}`, {
      name: name.trim(),
    });
    assertSuccess(result, 'rename group failed');
  }

  async transferOwner(groupId: number, newOwnerId: number): Promise<void> {
    const result = await this.http.post<ApiResult<null>>(`/im/groups/${groupId}/owner`, {
      newOwnerId,
    });
    assertSuccess(result, 'transfer group owner failed');
  }

  async setMemberRole(groupId: number, userId: number, role: Exclude<GroupRole, 'OWNER'>): Promise<void> {
    const result = await this.http.put<ApiResult<null>>(`/im/groups/${groupId}/members/${userId}/role`, {
      role,
    });
    assertSuccess(result, 'change group member role failed');
  }

  async setMemberMuted(groupId: number, userId: number, muted: boolean): Promise<void> {
    const result = await this.http.put<ApiResult<null>>(`/im/groups/${groupId}/members/${userId}/mute`, {
      muted,
    });
    assertSuccess(result, 'change group member mute failed');
  }

  async leaveGroup(groupId: number): Promise<void> {
    const result = await this.http.delete<ApiResult<null>>(`/im/groups/${groupId}/members/me`);
    assertSuccess(result, 'leave group failed');
  }

  async dissolveGroup(groupId: number): Promise<void> {
    const result = await this.http.delete<ApiResult<null>>(`/im/groups/${groupId}`);
    assertSuccess(result, 'dissolve group failed');
  }
}
