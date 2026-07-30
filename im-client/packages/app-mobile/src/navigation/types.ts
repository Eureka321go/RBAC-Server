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
  ConversationSettings: { cid: string; title: string };
  GroupDetails: { cid: string; groupId: number; title: string };
};
