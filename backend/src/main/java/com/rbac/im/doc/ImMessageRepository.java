package com.rbac.im.doc;

import org.springframework.data.domain.Limit;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface ImMessageRepository extends MongoRepository<ImMessage, String>, ImMessageRepositoryCustom {

    List<ImMessage> findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, Long seq);

    List<ImMessage> findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, Long seq, Limit limit);

    boolean existsBySenderIdAndClientMsgId(Long senderId, String clientMsgId);
}
