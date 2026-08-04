package com.rayim.eureka32.app.push.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class PushEventQueueTest {
    private lateinit var storage: FakeStorage
    private lateinit var queue: PushEventQueue

    @Before
    fun setUp() {
        PushEventQueue.clearEventSinkForTests()
        storage = FakeStorage()
        queue = PushEventQueue(storage)
    }

    @Test
    fun consumeOpenReturnsLatestOnce() {
        queue.enqueue(open("c_1_2"))
        queue.enqueue(open("g_100", "GROUP", 100))

        assertEquals("g_100", queue.consumeOpen()?.cid)
        assertNull(queue.consumeOpen())
    }

    @Test
    fun liveEventsAreEmittedAndConsumedExactlyOnce() {
        val received = mutableListOf<Pair<String, Map<String, Any?>>>()
        PushEventQueue.setEventSinkForTests { event, payload ->
            received += event to payload
            true
        }

        queue.enqueueForegroundMessage("c_1_2")
        queue.markSyncAllRequired()

        assertEquals(listOf("foregroundMessage", "syncAllRequired"), received.map { it.first })
        assertNull(storage.get(PushEventQueue.KEY_FOREGROUND))
        assertNull(storage.get(PushEventQueue.KEY_SYNC_ALL))
        queue.drain("foregroundMessage")
        queue.drain("syncAllRequired")
        assertEquals(2, received.size)
    }

    @Test
    fun eventsRemainPendingUntilAListenerCanReceiveThem() {
        queue.enqueueForegroundMessage("c_1_2")
        queue.markSyncAllRequired()
        val received = mutableListOf<String>()
        PushEventQueue.setEventSinkForTests { event, _ ->
            received += event
            true
        }

        queue.drain("foregroundMessage")
        queue.drain("syncAllRequired")

        assertEquals(listOf("foregroundMessage", "syncAllRequired"), received)
        assertNull(storage.get(PushEventQueue.KEY_FOREGROUND))
        assertNull(storage.get(PushEventQueue.KEY_SYNC_ALL))
    }

    @Test
    fun failedEmissionKeepsEventForRetry() {
        PushEventQueue.setEventSinkForTests { _, _ -> false }

        queue.enqueueForegroundMessage("c_1_2")
        queue.markSyncAllRequired()

        assertEquals("c_1_2", storage.get(PushEventQueue.KEY_FOREGROUND))
        assertEquals("1", storage.get(PushEventQueue.KEY_SYNC_ALL))
    }

    @Test
    fun rejectsInvalidOrUnsafeOpenIdentifiers() {
        queue.enqueue(open("g_100", "GROUP", null))
        queue.enqueue(open("g_100", "GROUP", PushOpenEvent.MAX_SAFE_JS_INTEGER + 1))
        queue.enqueue(open("c_1_2", "SINGLE", 100))

        assertNull(queue.consumeOpen())
    }

    private fun open(
        cid: String,
        type: String = "SINGLE",
        groupId: Long? = null,
    ) = PushOpenEvent(42, cid, type, groupId, "会话")

    private class FakeStorage : PushEventQueue.Storage {
        private val values = mutableMapOf<String, String>()

        override fun get(key: String): String? = values[key]
        override fun put(key: String, value: String) { values[key] = value }
        override fun remove(key: String) { values.remove(key) }
    }
}
