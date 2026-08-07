package com.rayim.eureka32.app.push.notification

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationChannelsTest {
    @Test
    fun regularMessagesUseNewHighPriorityChannelId() {
        assertEquals("messages_high", NotificationChannels.MESSAGES)
    }
}
