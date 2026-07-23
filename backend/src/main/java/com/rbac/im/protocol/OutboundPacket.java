package com.rbac.im.protocol;

import lombok.Data;

/** logic → 网关：把一条 Envelope 投给某网关上的某用户设备。 */
@Data
public class OutboundPacket {
    private String gatewayId;
    private Long targetUserId;
    private String deviceId;
    private Envelope envelope;
}
