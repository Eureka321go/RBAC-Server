import { sdk } from '../sdk';

export interface SelectableUser {
  id: number;
  username: string;
  nickname: string | null;
}

export function userDisplayName(user: SelectableUser): string {
  return user.nickname?.trim() || user.username;
}

export async function listSelectableUsers(myId: number | null): Promise<SelectableUser[]> {
  const directory = await sdk.contacts.getDirectory();
  return directory.members
    .filter((member) => member.userId !== myId)
    .map((member) => ({
      id: member.userId,
      username: member.username,
      nickname: member.displayName,
    }));
}
