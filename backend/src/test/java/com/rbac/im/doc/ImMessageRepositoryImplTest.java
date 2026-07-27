package com.rbac.im.doc;

import com.rbac.im.vo.LinkCard;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class ImMessageRepositoryImplTest {

    @Test
    void updateLink_sets_body_link_by_cid_and_seq() {
        MongoTemplate template = mock(MongoTemplate.class);
        ImMessageRepositoryImpl repo = new ImMessageRepositoryImpl(template);

        LinkCard card = new LinkCard("https://x.com/a", "T", "D", "https://x.com/i.png", "S");
        repo.updateLink("c_1_2", 42L, card);

        ArgumentCaptor<Query> q = ArgumentCaptor.forClass(Query.class);
        ArgumentCaptor<Update> u = ArgumentCaptor.forClass(Update.class);
        verify(template).updateFirst(q.capture(), u.capture(), eq(ImMessage.class));

        assertThat(q.getValue().getQueryObject().get("cid")).isEqualTo("c_1_2");
        assertThat(q.getValue().getQueryObject().get("seq")).isEqualTo(42L);
        // Update 里应含 $set body.link
        assertThat(u.getValue().getUpdateObject().toJson()).contains("body.link").contains("https://x.com/a");
    }

    @Test
    void markRecalled_sets_recalled_and_clears_body_by_cid_and_seq() {
        MongoTemplate template = mock(MongoTemplate.class);
        ImMessageRepositoryImpl repo = new ImMessageRepositoryImpl(template);

        repo.markRecalled("c_1_2", 42L);

        ArgumentCaptor<Query> q = ArgumentCaptor.forClass(Query.class);
        ArgumentCaptor<Update> u = ArgumentCaptor.forClass(Update.class);
        verify(template).updateFirst(q.capture(), u.capture(), eq(ImMessage.class));

        assertThat(q.getValue().getQueryObject().get("cid")).isEqualTo("c_1_2");
        assertThat(q.getValue().getQueryObject().get("seq")).isEqualTo(42L);
        String updateJson = u.getValue().getUpdateObject().toJson();
        assertThat(updateJson).contains("recalled").contains("body");
        assertThat(u.getValue().getUpdateObject().get("$set")).isNotNull();
    }
}
