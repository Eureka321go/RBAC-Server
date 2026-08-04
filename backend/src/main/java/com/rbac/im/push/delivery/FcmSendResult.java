package com.rbac.im.push.delivery;

public record FcmSendResult(boolean success, PushFailureKind failureKind, String reason) {

    public static FcmSendResult delivered() {
        return new FcmSendResult(true, PushFailureKind.NONE, "NONE");
    }
}
