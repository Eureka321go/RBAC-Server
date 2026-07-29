package com.rbac.im.doc;

import com.rbac.im.vo.LinkCard;

/** MongoRepository 自定义片段：链接卡片回写。 */
public interface ImMessageRepositoryCustom {
    /** 对 cid+seq 定位的文档 $set body.link（不整档覆盖，避免并发打架）。 */
    void updateLink(String cid, long seq, LinkCard card);

    /** 对 cid+seq 定位的文档原子 $set recalled=true 且清空 body（不整档覆盖）。 */
    void markRecalled(String cid, long seq);
}
