package com.appmobile.push.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PushPayloadTest {
    @Test
    fun parseRejectsMissingAccountAndOversizedPreview() {
        assertNull(PushPayload.parse(validData() - "recipientUserId"))
        assertNull(PushPayload.parse(validData() + ("preview" to "x".repeat(241))))
    }

    @Test
    fun parseAcceptsVersionOneMessage() {
        val payload = PushPayload.parse(validData())

        assertEquals("msg-1", payload?.msgId)
        assertEquals(86L, payload?.seq)
        assertTrue(payload?.mentioned == true)
    }

    @Test
    fun parseRejectsUnsupportedEnvelopeAndInvalidNumbers() {
        assertNull(PushPayload.parse(validData() + ("version" to "2")))
        assertNull(PushPayload.parse(validData() + ("event" to "MESSAGE_READ")))
        assertNull(PushPayload.parse(validData() + ("seq" to "-1")))
        assertNull(PushPayload.parse(validData() + ("ts" to "not-a-number")))
    }

    @Test
    fun parseRequiresValidGroupIdForGroupConversations() {
        assertNull(PushPayload.parse(validData() + ("conversationType" to "GROUP")))
        assertNull(
            PushPayload.parse(
                validData() + mapOf("conversationType" to "GROUP", "groupId" to "-1"),
            ),
        )

        val groupPayload = PushPayload.parse(
            validData() + mapOf("conversationType" to "GROUP", "groupId" to "9"),
        )
        assertEquals(9L, groupPayload?.groupId)
    }

    @Test
    fun parseRejectsBlankAndOverlongRemoteFields() {
        assertNull(PushPayload.parse(validData() + ("msgId" to " ")))
        assertNull(PushPayload.parse(validData() + ("cid" to "x".repeat(65))))
        assertNull(PushPayload.parse(validData() + ("title" to "x".repeat(129))))
        assertNull(PushPayload.parse(validData() + ("senderName" to "x".repeat(129))))
    }

    private fun validData(): Map<String, String> = mapOf(
        "version" to "1",
        "event" to "NEW_MESSAGE",
        "recipientUserId" to "42",
        "msgId" to "msg-1",
        "cid" to "conversation-1",
        "seq" to "86",
        "conversationType" to "SINGLE",
        "title" to "Alice",
        "senderName" to "Alice",
        "preview" to "Hello",
        "mentioned" to "true",
        "ts" to "1000",
    )
}
