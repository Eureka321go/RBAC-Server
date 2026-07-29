package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;

class UrlExtractorTest {

    @Test
    void takes_first_of_multiple() {
        assertThat(UrlExtractor.firstHttpUrl("看这个 https://a.com 和 https://b.com"))
                .contains("https://a.com");
    }

    @Test
    void none_when_no_url() {
        assertThat(UrlExtractor.firstHttpUrl("纯文本没有链接")).isEmpty();
        assertThat(UrlExtractor.firstHttpUrl(null)).isEmpty();
        assertThat(UrlExtractor.firstHttpUrl("")).isEmpty();
    }

    @Test
    void trims_trailing_chinese_and_punctuation() {
        assertThat(UrlExtractor.firstHttpUrl("戳 https://x.com/a，快看")).contains("https://x.com/a");
        assertThat(UrlExtractor.firstHttpUrl("链接：https://x.com/p。")).contains("https://x.com/p");
    }

    @Test
    void trims_trailing_ascii_sentence_punctuation() {
        assertThat(UrlExtractor.firstHttpUrl("见 https://x.com.")).contains("https://x.com");
    }

    @Test
    void trims_trailing_wrapping_paren_without_matching_open() {
        assertThat(UrlExtractor.firstHttpUrl("链接(https://x.com)")).contains("https://x.com");
    }

    @Test
    void keeps_balanced_parens_inside_url() {
        assertThat(UrlExtractor.firstHttpUrl("https://en.wikipedia.org/wiki/Foo_(bar)"))
                .contains("https://en.wikipedia.org/wiki/Foo_(bar)");
    }

    @Test
    void ignores_non_http_scheme() {
        assertThat(UrlExtractor.firstHttpUrl("ftp://x.com file:///etc/passwd")).isEmpty();
    }

    @Test
    void keeps_query_and_path() {
        assertThat(UrlExtractor.firstHttpUrl("https://x.com/p?a=1&b=2#frag next"))
                .contains("https://x.com/p?a=1&b=2#frag");
    }
}
