package com.rbac.im.doc;

import org.springframework.data.domain.Limit;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface ImMessageRepository extends MongoRepository<ImMessage, String>, ImMessageRepositoryCustom {

    List<ImMessage> findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, Long seq);

    List<ImMessage> findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, Long seq, Limit limit);

    Optional<ImMessage> findByCidAndSeq(String cid, Long seq);

    boolean existsBySenderIdAndClientMsgId(Long senderId, String clientMsgId);
}
