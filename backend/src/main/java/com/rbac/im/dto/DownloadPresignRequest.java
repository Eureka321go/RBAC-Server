package com.rbac.im.dto;

import lombok.Data;

@Data
public class DownloadPresignRequest {
    private String cid;
    private String objectKey;
}
