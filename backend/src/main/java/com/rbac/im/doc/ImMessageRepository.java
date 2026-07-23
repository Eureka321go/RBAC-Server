package com.rbac.im.doc;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface ImMessageRepository extends MongoRepository<ImMessage, String> {

    List<ImMessage> findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, Long seq);

    boolean existsBySenderIdAndClientMsgId(Long senderId, String clientMsgId);
}
