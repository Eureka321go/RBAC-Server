import type { ApiResult } from '../auth/authService';
import type { Http } from '../ports/index';

export interface ContactDepartment {
  id: number;
  parentId: number | null;
  name: string;
  sortOrder: number;
}

export interface ContactMember {
  userId: number;
  deptId: number | null;
  username: string;
  displayName: string;
  avatar: string | null;
}

export interface ContactDirectory {
  departments: ContactDepartment[];
  members: ContactMember[];
}

/** 平台无关的 IM 完整通讯录服务。 */
export class ContactService {
  constructor(private readonly http: Http) {}

  async getDirectory(): Promise<ContactDirectory> {
    const result = await this.http.get<ApiResult<ContactDirectory>>('/im/contacts');
    if (
      result.code !== 200
      || result.data == null
      || !Array.isArray(result.data.departments)
      || !Array.isArray(result.data.members)
    ) {
      throw new Error(result.message || 'load contact directory failed');
    }
    return result.data;
  }
}
