package com.rbac.im.gateway.protocol;

import lombok.Data;

/** logic → 网关：把一条 Envelope 投给某网关上的某用户设备。字段须与 backend 侧 com.rbac.im.protocol.OutboundPacket 完全一致。 */
@Data
public class OutboundPacket {
    private String gatewayId;
    private Long targetUserId;
    private String deviceId;
    private Envelope envelope;
}
