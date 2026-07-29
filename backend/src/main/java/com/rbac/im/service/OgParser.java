package com.rbac.im.service;

import com.rbac.im.vo.LinkCard;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.util.Optional;

/** HTML → LinkCard。纯函数，无 IO。title 缺失返回空。 */
public final class OgParser {

    private static final int MAX_TITLE = 200;
    private static final int MAX_DESC = 300;
    private static final int MAX_URL = 2048;

    private OgParser() {}

    public static Optional<LinkCard> parse(String html, String baseUrl) {
        if (html == null || html.isBlank()) {
            return Optional.empty();
        }
        Document doc = Jsoup.parse(html, baseUrl == null ? "" : baseUrl);

        String title = firstNonBlank(metaContent(doc, "og:title"), textOrNull(doc.selectFirst("title")));
        if (title == null || title.isBlank()) {
            return Optional.empty();   // title 必填
        }
        String desc = metaContent(doc, "og:description");
        String siteName = metaContent(doc, "og:site_name");

        // og:image 用 abs: 前缀让 jsoup 基于 baseUrl 绝对化相对路径
        String image = null;
        Element imgMeta = doc.selectFirst("meta[property=og:image]");
        if (imgMeta != null) {
            String abs = imgMeta.absUrl("content");
            image = (abs != null && !abs.isBlank()) ? abs : imgMeta.attr("content");
            if (image.isBlank()) image = null;
        }

        return Optional.of(new LinkCard(
                trunc(baseUrl, MAX_URL),
                trunc(title.trim(), MAX_TITLE),
                trunc(blankToNull(desc), MAX_DESC),
                image,
                blankToNull(siteName)));
    }

    private static String metaContent(Document doc, String property) {
        Element el = doc.selectFirst("meta[property=" + property + "]");
        return el == null ? null : el.attr("content");
    }

    private static String textOrNull(Element el) {
        return el == null ? null : el.text();
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.isBlank()) return a;
        return (b != null && !b.isBlank()) ? b : null;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private static String trunc(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }
}
