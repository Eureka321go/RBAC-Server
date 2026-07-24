package com.rbac.im.doc;

import com.rbac.im.vo.LinkCard;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import java.util.LinkedHashMap;
import java.util.Map;

/** Spring Data 约定：命名必须是 {主接口名}Impl。 */
public class ImMessageRepositoryImpl implements ImMessageRepositoryCustom {

    private final MongoTemplate template;

    public ImMessageRepositoryImpl(MongoTemplate template) {
        this.template = template;
    }

    @Override
    public void updateLink(String cid, long seq, LinkCard card) {
        Query q = new Query(Criteria.where("cid").is(cid).and("seq").is(seq));
        Update u = new Update().set("body.link", toMap(card));
        template.updateFirst(q, u, ImMessage.class);
    }

    private static Map<String, Object> toMap(LinkCard c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("url", c.url());
        m.put("title", c.title());
        if (c.description() != null) m.put("description", c.description());
        if (c.image() != null) m.put("image", c.image());
        if (c.siteName() != null) m.put("siteName", c.siteName());
        return m;
    }
}
