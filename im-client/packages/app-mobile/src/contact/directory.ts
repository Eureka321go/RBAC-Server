import type { ContactDepartment, ContactDirectory, ContactMember } from '@im/sdk-core';

export interface ContactDirectoryModel {
  departmentsById: ReadonlyMap<number, ContactDepartment>;
  membersById: ReadonlyMap<number, ContactMember>;
  rootDepartmentIds: readonly number[];
  parentDepartmentId: ReadonlyMap<number, number | null>;
  childDepartmentIds: ReadonlyMap<number, readonly number[]>;
  directMemberIds: ReadonlyMap<number, readonly number[]>;
  descendantMemberIds: ReadonlyMap<number, readonly number[]>;
  unassignedMemberIds: readonly number[];
  namesById: ReadonlyMap<number, string>;
}

function normalizedParent(
  department: ContactDepartment,
  departmentsById: ReadonlyMap<number, ContactDepartment>,
): number | null {
  const parentId = department.parentId;
  if (parentId == null || parentId === 0 || !departmentsById.has(parentId)) return null;

  const visited = new Set<number>([department.id]);
  let cursor: number | null = parentId;
  while (cursor != null && cursor !== 0) {
    if (visited.has(cursor)) return null;
    visited.add(cursor);
    const parent = departmentsById.get(cursor);
    if (parent == null) return null;
    cursor = parent.parentId;
  }
  return parentId;
}

function pushToMap(map: Map<number, number[]>, key: number, value: number): void {
  const current = map.get(key);
  if (current == null) map.set(key, [value]);
  else current.push(value);
}

export function buildContactDirectory(directory: ContactDirectory): ContactDirectoryModel {
  const sortedDepartments = [...directory.departments].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
  );
  const departmentsById = new Map(sortedDepartments.map((department) => [department.id, department]));
  const membersById = new Map(directory.members.map((member) => [member.userId, member]));
  const namesById = new Map(directory.members.map((member) => [member.userId, member.displayName]));
  const childDepartmentIds = new Map<number, number[]>();
  const parentDepartmentId = new Map<number, number | null>();
  const rootDepartmentIds: number[] = [];

  for (const department of sortedDepartments) {
    const parentId = normalizedParent(department, departmentsById);
    parentDepartmentId.set(department.id, parentId);
    if (parentId == null) rootDepartmentIds.push(department.id);
    else pushToMap(childDepartmentIds, parentId, department.id);
  }

  const directMemberIds = new Map<number, number[]>();
  const unassignedMemberIds: number[] = [];
  for (const member of directory.members) {
    if (member.deptId == null || !departmentsById.has(member.deptId)) {
      unassignedMemberIds.push(member.userId);
    } else {
      pushToMap(directMemberIds, member.deptId, member.userId);
    }
  }

  const descendantMemberIds = new Map<number, number[]>();
  const collect = (departmentId: number, visiting: Set<number>): number[] => {
    const cached = descendantMemberIds.get(departmentId);
    if (cached != null) return cached;
    if (visiting.has(departmentId)) return [];
    const nextVisiting = new Set(visiting).add(departmentId);
    const result = [...(directMemberIds.get(departmentId) ?? [])];
    for (const childId of childDepartmentIds.get(departmentId) ?? []) {
      result.push(...collect(childId, nextVisiting));
    }
    const unique = [...new Set(result)];
    descendantMemberIds.set(departmentId, unique);
    return unique;
  };
  for (const departmentId of departmentsById.keys()) collect(departmentId, new Set());

  return {
    departmentsById,
    membersById,
    rootDepartmentIds,
    parentDepartmentId,
    childDepartmentIds,
    directMemberIds,
    descendantMemberIds,
    unassignedMemberIds,
    namesById,
  };
}
