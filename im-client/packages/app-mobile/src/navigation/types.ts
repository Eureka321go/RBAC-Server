export type RootStackParamList = {
  Login: undefined;
  Conversations: undefined;
  Contacts: undefined;
  Chat: { cid: string; title: string; syncOnOpen?: boolean };
};
