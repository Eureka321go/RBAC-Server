package com.rbac.im.vo;

import lombok.AllArgsConstructor;
import lombok.Data;

/** 创建单聊结果；重复调用返回同一个 cid。 */
@Data
@AllArgsConstructor
public class CreateSingleConversationResult {
    private String cid;
}
