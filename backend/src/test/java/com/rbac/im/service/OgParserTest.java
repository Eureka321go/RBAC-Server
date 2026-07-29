package com.rbac.im.service;

import com.rbac.im.vo.LinkCard;
import org.junit.jupiter.api.Test;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;

class OgParserTest {

    @Test
    void full_og_tags() {
        String html = """
            <html><head>
              <meta property="og:title" content="标题T">
              <meta property="og:description" content="摘要D">
              <meta property="og:image" content="https://x.com/og.png">
              <meta property="og:site_name" content="Example">
            </head><body>x</body></html>""";
        Optional<LinkCard> c = OgParser.parse(html, "https://x.com/a");
        assertThat(c).isPresent();
        assertThat(c.get().title()).isEqualTo("标题T");
        assertThat(c.get().description()).isEqualTo("摘要D");
        assertThat(c.get().image()).isEqualTo("https://x.com/og.png");
        assertThat(c.get().siteName()).isEqualTo("Example");
        assertThat(c.get().url()).isEqualTo("https://x.com/a");
    }

    @Test
    void falls_back_to_title_tag_when_no_og_title() {
        String html = "<html><head><title>页面标题</title></head><body>x</body></html>";
        Optional<LinkCard> c = OgParser.parse(html, "https://x.com/a");
        assertThat(c).isPresent();
        assertThat(c.get().title()).isEqualTo("页面标题");
        assertThat(c.get().description()).isNull();
        assertThat(c.get().image()).isNull();
    }

    @Test
    void empty_when_no_title_at_all() {
        String html = "<html><head><meta property=\"og:image\" content=\"https://x.com/i.png\"></head></html>";
        assertThat(OgParser.parse(html, "https://x.com/a")).isEmpty();
    }

    @Test
    void empty_on_blank_or_malformed() {
        assertThat(OgParser.parse("", "https://x.com/a")).isEmpty();
        assertThat(OgParser.parse("<<not html>>", "https://x.com/a")).isEmpty();
        assertThat(OgParser.parse(null, "https://x.com/a")).isEmpty();
    }

    @Test
    void absolutizes_relative_image() {
        String html = """
            <html><head><meta property="og:title" content="T">
            <meta property="og:image" content="/img/og.png"></head></html>""";
        Optional<LinkCard> c = OgParser.parse(html, "https://x.com/dir/page");
        assertThat(c.get().image()).isEqualTo("https://x.com/img/og.png");
    }

    @Test
    void truncates_long_fields() {
        String longTitle = "t".repeat(300);
        String longDesc = "d".repeat(400);
        String html = "<html><head>"
                + "<meta property=\"og:title\" content=\"" + longTitle + "\">"
                + "<meta property=\"og:description\" content=\"" + longDesc + "\">"
                + "</head></html>";
        Optional<LinkCard> c = OgParser.parse(html, "https://x.com/a");
        assertThat(c.get().title()).hasSize(200);
        assertThat(c.get().description()).hasSize(300);
    }
}
