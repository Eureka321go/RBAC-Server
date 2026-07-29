package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.LinkPreviewProperties;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.LinkCard;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** 链接卡片编排：提取→缓存→抓取→解析→回写 Mongo + 扇出 LINK_PREVIEW。异步、异常不外抛。 */
@Service
public class LinkPreviewService {

    private static final Logger log = LoggerFactory.getLogger(LinkPreviewService.class);
    private static final String NEG = "FAIL";

    private final LinkPreviewProperties props;
    private final SsrfGuardedFetcher fetcher;
    private final ImMessageRepository repo;
    private final OutboundDispatcher dispatcher;
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper = new ObjectMapper();
    private final ThreadPoolExecutor pool;

    public LinkPreviewService(LinkPreviewProperties props,
                              SsrfGuardedFetcher fetcher,
                              ImMessageRepository repo,
                              OutboundDispatcher dispatcher,
                              StringRedisTemplate redis) {
        this.props = props;
        this.fetcher = fetcher;
        this.repo = repo;
        this.dispatcher = dispatcher;
        this.redis = redis;
        this.pool = new ThreadPoolExecutor(
                props.getPoolCore(), props.getPoolMax(),
                60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(props.getPoolQueue()),
                r -> { Thread t = new Thread(r, "im-linkpreview"); t.setDaemon(true); return t; },
                new ThreadPoolExecutor.DiscardPolicy());   // 满载丢弃预览，不拖住 Kafka
    }

    /** 提交异步任务。enabled=false / 无 URL 早退；线程池满则 DiscardPolicy 静默丢弃。 */
    public void tryEnrich(String cid, long seq, String text) {
        if (!props.isEnabled()) {
            return;
        }
        if (UrlExtractor.firstHttpUrl(text).isEmpty()) {
            return;   // 省一次线程池提交
        }
        pool.execute(() -> enrichNow(cid, seq, text));
    }

    /** 同步核心：任何异常都吞掉，绝不外抛（跑在独立线程池里）。 */
    public void enrichNow(String cid, long seq, String text) {
        try {
            Optional<String> urlOpt = UrlExtractor.firstHttpUrl(text);
            if (urlOpt.isEmpty()) {
                return;
            }
            String url = urlOpt.get();
            String key = cacheKey(url);

            String cached = redis.opsForValue().get(key);
            if (NEG.equals(cached)) {
                return;                                   // 负缓存命中
            }
            LinkCard card;
            if (cached != null) {
                card = mapper.readValue(cached, LinkCard.class);   // 正缓存命中
            } else {
                Optional<SsrfGuardedFetcher.FetchResult> fr = fetcher.fetch(url);
                Optional<LinkCard> parsed = fr.flatMap(r -> OgParser.parse(r.html(), r.finalUrl()));
                if (parsed.isEmpty()) {
                    redis.opsForValue().set(key, NEG, props.getCacheTtlFail());
                    return;
                }
                card = parsed.get();
                redis.opsForValue().set(key, mapper.writeValueAsString(card), props.getCacheTtlOk());
            }

            repo.updateLink(cid, seq, card);
            dispatcher.dispatch(cid, linkPreviewEnvelope(cid, seq, card));
        } catch (Throwable t) {
            log.warn("链接卡片补写失败 cid={} seq={}", cid, seq, t);
        }
    }

    private Envelope linkPreviewEnvelope(String cid, long seq, LinkCard card) {
        Envelope env = new Envelope();
        env.setOp("LINK_PREVIEW");
        env.setCid(cid);
        env.setSeq(seq);
        env.setBody(Map.of("link", mapper.convertValue(card, Map.class)));
        return env;
    }

    private static String cacheKey(String url) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(url.getBytes(StandardCharsets.UTF_8));
            return "im:link:og:" + HexFormat.of().formatHex(h);
        } catch (Exception e) {
            return "im:link:og:" + Integer.toHexString(url.hashCode());   // 不可达兜底
        }
    }

    @PreDestroy
    public void shutdown() {
        pool.shutdown();
    }
}
