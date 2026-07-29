package com.rbac.im.service;

import com.rbac.im.config.LinkPreviewProperties;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.vo.LinkCard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class LinkPreviewServiceTest {

    LinkPreviewProperties props;
    SsrfGuardedFetcher fetcher;
    ImMessageRepository repo;
    OutboundDispatcher dispatcher;
    StringRedisTemplate redis;
    ValueOperations<String, String> ops;
    LinkPreviewService svc;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        props = new LinkPreviewProperties();
        fetcher = mock(SsrfGuardedFetcher.class);
        repo = mock(ImMessageRepository.class);
        dispatcher = mock(OutboundDispatcher.class);
        redis = mock(StringRedisTemplate.class);
        ops = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        svc = new LinkPreviewService(props, fetcher, repo, dispatcher, redis);
    }

    @Test
    void success_writes_mongo_and_dispatches_link_preview() {
        when(ops.get(anyString())).thenReturn(null);   // 缓存未命中
        when(fetcher.fetch("https://x.com/a"))
                .thenReturn(Optional.of(new SsrfGuardedFetcher.FetchResult(
                        "https://x.com/a", "<html><head><meta property=\"og:title\" content=\"T\"></head></html>")));

        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");

        verify(repo).updateLink(eq("c_1_2"), eq(42L), any(LinkCard.class));
        ArgumentCaptor<Envelope> env = ArgumentCaptor.forClass(Envelope.class);
        verify(dispatcher).dispatch(eq("c_1_2"), env.capture());
        assertThat(env.getValue().getOp()).isEqualTo("LINK_PREVIEW");
        assertThat(env.getValue().getSeq()).isEqualTo(42L);
        assertThat(env.getValue().getBody()).containsKey("link");
        verify(ops).set(anyString(), anyString(), any());   // 写正缓存
    }

    @Test
    void no_url_does_nothing() {
        svc.enrichNow("c_1_2", 42L, "纯文本没链接");
        verifyNoInteractions(fetcher, repo, dispatcher);
    }

    @Test
    void fetch_fail_writes_negative_cache_no_dispatch() {
        when(ops.get(anyString())).thenReturn(null);
        when(fetcher.fetch(anyString())).thenReturn(Optional.empty());

        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");

        verify(repo, never()).updateLink(anyString(), anyLong(), any());
        verify(dispatcher, never()).dispatch(anyString(), any());
        verify(ops).set(anyString(), eq("FAIL"), any());   // 负缓存
    }

    @Test
    void title_missing_treated_as_fail() {
        when(ops.get(anyString())).thenReturn(null);
        when(fetcher.fetch(anyString()))
                .thenReturn(Optional.of(new SsrfGuardedFetcher.FetchResult(
                        "https://x.com/a", "<html><head><meta property=\"og:image\" content=\"https://x.com/i.png\"></head></html>")));

        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");

        verify(repo, never()).updateLink(anyString(), anyLong(), any());
        verify(dispatcher, never()).dispatch(anyString(), any());
        verify(ops).set(anyString(), eq("FAIL"), any());
    }

    @Test
    void positive_cache_hit_skips_fetch() {
        // 正缓存命中：存的是 LinkCard 的 JSON
        String cached = "{\"url\":\"https://x.com/a\",\"title\":\"T\",\"description\":null,\"image\":null,\"siteName\":null}";
        when(ops.get(anyString())).thenReturn(cached);

        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");

        verifyNoInteractions(fetcher);                    // 不抓
        verify(repo).updateLink(eq("c_1_2"), eq(42L), any(LinkCard.class));
        verify(dispatcher).dispatch(eq("c_1_2"), any(Envelope.class));
    }

    @Test
    void negative_cache_hit_does_nothing() {
        when(ops.get(anyString())).thenReturn("FAIL");
        svc.enrichNow("c_1_2", 42L, "看 https://x.com/a");
        verifyNoInteractions(fetcher);
        verify(repo, never()).updateLink(anyString(), anyLong(), any());
        verify(dispatcher, never()).dispatch(anyString(), any());
    }
}
