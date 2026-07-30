import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type { ConversationRow } from '@im/sdk-core';
import { ConversationRowView } from '../src/components/ConversationRowView';

jest.mock('../src/ui/ThemeProvider', () => {
  const { LIGHT_THEME: mockLightTheme } = require('../src/ui/theme');
  return { useAppTheme: () => ({ theme: mockLightTheme }) };
});
jest.mock('../src/components/Avatar', () => ({
  GroupAvatar: () => null,
  InitialAvatar: () => null,
}));
jest.mock('../src/components/AnimatedEntrance', () => ({
  AnimatedEntrance: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@react-native-vector-icons/ionicons/static', () => ({ Ionicons: () => null }));

const baseRow = {
  cid: 'c_1_2',
  type: 'SINGLE',
  peerId: 2,
  peerName: '苏晴',
  displayName: '苏晴',
  lastMsgPreview: '下午同步',
  lastMsgTs: Date.now(),
  unreadCount: 3,
  hasMention: true,
  muted: true,
} as ConversationRow;

test('announces mentions, mute, preview, and unread count', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ConversationRowView
        row={baseRow}
        title="苏晴"
        formattedTime="10:24"
        entranceIndex={0}
        onPress={jest.fn()}
      />,
    );
  });

  const button = renderer.root.findByProps({ accessibilityRole: 'button' });
  expect(button.props.accessibilityLabel).toContain('已开启消息免打扰');
  expect(button.props.accessibilityLabel).toContain('有人@我');
  expect(button.props.accessibilityLabel).toContain('下午同步');
  expect(button.props.accessibilityLabel).toContain('3 条未读');
});
