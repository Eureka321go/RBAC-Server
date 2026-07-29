package com.rbac.im.dto;

import lombok.Data;

@Data
public class MultipartInitRequest {
    private String cid;
    private String type;
    private String filename;
    private String mime;
    private long size;
}
