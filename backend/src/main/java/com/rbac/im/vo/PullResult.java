package com.rbac.im.vo;

import lombok.Data;

import java.util.List;

/** 单会话增量拉取结果。 */
@Data
public class PullResult {
    private List<ImMessageVO> messages;
    private boolean hasMore;
    private Long nextSinceSeq;
}
