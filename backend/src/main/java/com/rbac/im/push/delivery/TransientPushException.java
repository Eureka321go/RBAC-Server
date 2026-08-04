package com.rbac.im.push.delivery;

public class TransientPushException extends RuntimeException {

    public TransientPushException(String reason) {
        super(PushMetrics.safeReason(reason));
    }
}
