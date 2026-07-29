package com.rbac.im.vo;

/** 链接卡片值对象。title 必填（否则判抓取失败）；其余可空。 */
public record LinkCard(String url, String title, String description, String image, String siteName) {}
