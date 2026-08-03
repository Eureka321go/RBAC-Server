package com.rbac.im.push.delivery;

import java.util.List;

public interface FcmGateway {

    List<FcmSendResult> send(List<FcmRequest> requests);
}
