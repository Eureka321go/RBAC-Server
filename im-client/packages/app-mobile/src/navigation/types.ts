export type RootStackParamList = {
  Login: undefined;
  Conversations: undefined;
  Contacts: undefined;
  CreateGroup: undefined;
  Chat: {
    cid: string;
    title: string;
    conversationType: 'SINGLE' | 'GROUP';
    groupId?: number;
    syncOnOpen?: boolean;
  };
  GroupDetails: { cid: string; groupId: number; title: string };
};
