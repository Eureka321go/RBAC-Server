import type { Ids } from '@im/sdk-core';

/** clientMsgId 用途，Math.random v4 足够（不需密码学强度）。 */
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const rnIds: Ids = {
  uuid: uuidv4,
  now: () => Date.now(),
};
