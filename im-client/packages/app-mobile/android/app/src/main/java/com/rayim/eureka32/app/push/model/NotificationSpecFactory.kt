package com.rayim.eureka32.app.push.model

import com.rayim.eureka32.app.push.notification.NotificationChannels

class NotificationSpecFactory {
    fun create(payload: PushPayload): NotificationSpec = NotificationSpec(
        notificationId = payload.cid.hashCode() and Int.MAX_VALUE,
        channelId = if (payload.mentioned) {
            NotificationChannels.MENTIONS
        } else {
            NotificationChannels.MESSAGES
        },
        title = payload.title,
        body = if (payload.conversationType == "GROUP") {
            "${payload.senderName}：${payload.preview}"
        } else {
            payload.preview
        },
        groupKey = NotificationChannels.MESSAGE_GROUP,
    )
}
