import React, {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  loadLanguage,
  saveLanguage,
  type AppLanguage,
} from './languagePreference';

type TranslationKey = keyof typeof translations['zh-CN'];

const translations = {
  'zh-CN': {
    chats: '聊天', contacts: '通讯录', profile: '我的', login: '登录', loggingIn: '正在登录…',
    username: '用户名', password: '密码', enterUsername: '请输入用户名', enterPassword: '请输入密码',
    welcomeBack: '欢迎回来', loginSubtitle: '登录后继续处理消息、群聊与协作', secureConnection: '端到端安全连接 · 多端消息同步',
    preferences: '偏好设置', appearance: '外观', notification: '通知', language: '语言',
    enabled: '已开启', disabled: '已关闭', simplifiedChinese: '简体中文', english: 'English',
    workspaceAndPreferences: '工作空间与个人偏好', online: '在线', offline: '离线', connecting: '连接中', reconnecting: '重连中',
    logout: '退出登录', appearanceTitle: '选择界面模式', appearanceHint: '设置会立即生效并自动保存',
    followSystem: '跟随系统', light: '浅色', dark: '深色',
    languageTitle: '选择显示语言', languageHint: '切换后会立即应用并自动保存',
    chatSubtitle: '保持专注，也保持连接', searchPlaceholder: '搜索会话、消息与联系人',
    startDirectChat: '发起单聊', createGroup: '创建群聊', noMessages: '还没有消息', syncingConversations: '正在同步会话',
    syncingHint: '请稍候，正在获取最新内容…', noMessagesHint: '前往通讯录找到同事，或创建一个群聊',
    contactsEyebrow: '快速找到团队里的每个人', organization: '组织架构', findByDepartment: '按部门查找',
    groupChat: '发起群聊', collaboration: '多人协作', members: '组织成员', selectContactToChat: '选择联系人开始聊天', loadingMembers: '正在加载组织成员…',
    unknown: '未知', user: '用户', group: '群聊',
  },
  'en-US': {
    chats: 'Chats', contacts: 'Contacts', profile: 'Profile', login: 'Sign in', loggingIn: 'Signing in…',
    username: 'Username', password: 'Password', enterUsername: 'Enter your username', enterPassword: 'Enter your password',
    welcomeBack: 'Welcome back', loginSubtitle: 'Continue with messages, groups, and collaboration', secureConnection: 'Secure connection · Multi-device sync',
    preferences: 'Preferences', appearance: 'Appearance', notification: 'Notifications', language: 'Language',
    enabled: 'On', disabled: 'Off', simplifiedChinese: 'Simplified Chinese', english: 'English',
    workspaceAndPreferences: 'Workspace & preferences', online: 'Online', offline: 'Offline', connecting: 'Connecting', reconnecting: 'Reconnecting',
    logout: 'Sign out', appearanceTitle: 'Choose appearance', appearanceHint: 'Changes apply and save automatically',
    followSystem: 'System default', light: 'Light', dark: 'Dark',
    languageTitle: 'Choose display language', languageHint: 'Changes apply and save automatically',
    chatSubtitle: 'Stay focused, stay connected', searchPlaceholder: 'Search chats, messages, and contacts',
    startDirectChat: 'Start direct chat', createGroup: 'Create group', noMessages: 'No messages yet', syncingConversations: 'Syncing conversations',
    syncingHint: 'Please wait while we get the latest content…', noMessagesHint: 'Find a teammate in Contacts or create a group',
    contactsEyebrow: 'Find everyone on your team', organization: 'Organization', findByDepartment: 'Browse by department',
    groupChat: 'Start group chat', collaboration: 'Collaborate together', members: 'Members', selectContactToChat: 'Select a contact to start chatting', loadingMembers: 'Loading members…',
    unknown: 'Unknown', user: 'User', group: 'Group',
  },
} as const;

interface LanguageContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'zh-CN', setLanguage: async () => {}, t: key => translations['zh-CN'][key],
});

export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<AppLanguage>('zh-CN');
  useEffect(() => { void loadLanguage().then(setLanguageState); }, []);
  const setLanguage = useCallback(async (nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    await saveLanguage(nextLanguage);
  }, []);
  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (key: TranslationKey) => translations[language][key],
  }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue { return useContext(LanguageContext); }
