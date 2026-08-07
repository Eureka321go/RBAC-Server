import type {
  BottomTabNavigationProp,
  BottomTabScreenProps,
} from '@react-navigation/bottom-tabs';
import type {
  CompositeNavigationProp,
  RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

export interface ChatRouteParams {
  cid: string;
  title: string;
  conversationType: 'SINGLE' | 'GROUP';
  groupId?: number;
  syncOnOpen?: boolean;
}

export type RootTabParamList = {
  ChatsTab: undefined;
  ContactsTab: undefined;
  ProfileTab: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  AppearanceSettings: undefined;
  CreateGroup: undefined;
  Chat: ChatRouteParams;
  ConversationSettings: { cid: string; title: string };
  GroupDetails: { cid: string; groupId: number; title: string };
};

export interface RootTabScreenProps<T extends keyof RootTabParamList> {
  navigation: CompositeNavigationProp<
    BottomTabNavigationProp<RootTabParamList, T>,
    NativeStackNavigationProp<RootStackParamList>
  >;
  route: RouteProp<RootTabParamList, T>;
}

export type AnyRootTabScreenProps = BottomTabScreenProps<RootTabParamList>;
