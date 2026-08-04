package com.rayim.eureka32.app.push.model

import com.rayim.eureka32.app.push.notification.NotificationChannels
import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationSpecFactoryTest {
    private val factory = NotificationSpecFactory()

    @Test
    fun groupMessageUsesGroupTitleSenderPrefixAndMentionChannel() {
        val spec = factory.create(groupPayload(mentioned = true))

        assertEquals("研发群", spec.title)
        assertEquals("张三：今晚八点发布", spec.body)
        assertEquals(NotificationChannels.MENTIONS, spec.channelId)
        assertEquals(98_001_433, spec.notificationId)
        assertEquals("im_messages", spec.groupKey)
    }

    @Test
    fun singleMessageUsesPreviewWithoutRepeatingSender() {
        val spec = factory.create(singlePayload())

        assertEquals("张三", spec.title)
        assertEquals("今晚八点发布", spec.body)
        assertEquals(NotificationChannels.MESSAGES, spec.channelId)
    }

    private fun groupPayload(mentioned: Boolean) = PushPayload(
        recipientUserId = 42L,
        msgId = "msg-1",
        cid = "g_100",
        seq = 86L,
        conversationType = "GROUP",
        groupId = 100L,
        title = "研发群",
        senderName = "张三",
        preview = "今晚八点发布",
        mentioned = mentioned,
        ts = 1_000L,
    )

    private fun singlePayload() = groupPayload(mentioned = false).copy(
        cid = "u_42_43",
        conversationType = "SINGLE",
        groupId = null,
        title = "张三",
    )
}
