import type { ChatMessage } from '@im/sdk-core';

function userLabel(value: unknown): string {
  return typeof value === 'number' ? `用户 #${value}` : '有成员';
}

function firstTarget(body: Record<string, unknown>): unknown {
  const targets = body.targetIds;
  return Array.isArray(targets) ? targets[0] : null;
}

function extraOf(body: Record<string, unknown>): Record<string, unknown> {
  return body.extra != null && typeof body.extra === 'object' && !Array.isArray(body.extra)
    ? body.extra as Record<string, unknown>
    : {};
}

export function formatGroupSystemMessage(message: ChatMessage): string {
  const body = message.body ?? {};
  const event = body.event;
  const operator = userLabel(body.operatorId);
  const target = userLabel(firstTarget(body));
  const extra = extraOf(body);

  switch (event) {
    case 'GROUP_CREATE':
      return `${operator} 创建了群聊`;
    case 'MEMBER_JOIN':
      return `${operator} 邀请新成员加入群聊`;
    case 'MEMBER_LEAVE':
      return `${target} 退出了群聊`;
    case 'MEMBER_KICK':
      return `${target} 被移出群聊`;
    case 'GROUP_DISSOLVE':
      return `${operator} 解散了群聊`;
    case 'GROUP_RENAME':
      return typeof extra.newName === 'string'
        ? `${operator} 将群名改为“${extra.newName}”`
        : `${operator} 修改了群名称`;
    case 'OWNER_TRANSFER':
      return `${target} 成为新群主`;
    case 'ADMIN_CHANGE':
      return extra.role === 'ADMIN' ? `${target} 被设为管理员` : `${target} 被取消管理员`;
    case 'MEMBER_MUTE':
      return extra.muted === true ? `${target} 被禁言` : `${target} 已解除禁言`;
    default:
      return '群聊信息已更新';
  }
}
