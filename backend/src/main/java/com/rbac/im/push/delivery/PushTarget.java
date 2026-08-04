package com.rbac.im.push.delivery;

import com.rbac.im.push.registration.ImPushRegistration;

public record PushTarget(ImPushRegistration registration, long recipientUserId, boolean mentioned) {
}
