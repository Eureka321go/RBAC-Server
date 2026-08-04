package com.appmobile.push

import com.appmobile.push.ImPushMessageLogic.Action
import com.appmobile.push.model.PushPayload
import com.appmobile.push.notification.ConversationNotificationStore
import com.appmobile.push.notification.ConversationNotificationSequencer
import com.appmobile.push.store.KeyValueStore
import com.appmobile.push.store.PushStateStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class ImFirebaseMessagingServiceLogicTest {
    private val keyValueStore = InMemoryKeyValueStore()
    private val stateStore = PushStateStore(keyValueStore)
    private val logic = ImPushMessageLogic(
        stateStore,
        Clock.fixed(Instant.ofEpochMilli(2_000L), ZoneOffset.UTC),
    )

    @Test
    fun foregroundEmitsSyncWithoutPostingNotification() {
        val result = logic.handle(validPayload(), activeUser = 42L, foreground = true)

        assertEquals(Action.EMIT_FOREGROUND_SYNC, result.action)
    }

    @Test
    fun backgroundMessageShowsNotification() {
        val result = logic.handle(validPayload(), activeUser = 42L, foreground = false)

        assertEquals(Action.SHOW_NOTIFICATION, result.action)
    }

    @Test
    fun accountMismatchIsDroppedWithoutClaimingMessageId() {
        val mismatch = logic.handle(validPayload(), activeUser = 41L, foreground = false)
        val matching = logic.handle(validPayload(), activeUser = 42L, foreground = false)

        assertEquals(Action.DROP_ACCOUNT_MISMATCH, mismatch.action)
        assertEquals(Action.SHOW_NOTIFICATION, matching.action)
    }

    @Test
    fun duplicateMessageIsDropped() {
        logic.handle(validPayload(), activeUser = 42L, foreground = false)

        val duplicate = logic.handle(validPayload(), activeUser = 42L, foreground = false)

        assertEquals(Action.DROP_DUPLICATE, duplicate.action)
    }

    @Test
    fun conversationStoreKeepsFiveLatestSummariesAndTotalCount() {
        val store = ConversationNotificationStore(keyValueStore)

        repeat(6) { index -> store.append("g_100", "摘要-$index") }

        val summary = store.get("g_100")
        assertEquals(6, summary?.totalCount)
        assertEquals(listOf("摘要-1", "摘要-2", "摘要-3", "摘要-4", "摘要-5"), summary?.lines)
    }

    @Test
    fun conversationStoreKeepsOnlyFiftyMostRecentlyUpdatedConversations() {
        val store = ConversationNotificationStore(keyValueStore)
        repeat(50) { index -> store.append("cid-$index", "摘要-$index") }
        store.append("cid-0", "最新摘要")

        store.append("cid-50", "摘要-50")

        assertNull(store.get("cid-1"))
        assertEquals(2, store.get("cid-0")?.totalCount)
        assertEquals(1, store.get("cid-50")?.totalCount)
    }

    @Test
    fun clearingConversationRemovesItsSummary() {
        val store = ConversationNotificationStore(keyValueStore)
        store.append("g_100", "摘要")

        store.clear("g_100")

        assertNull(store.get("g_100"))
    }

    @Test
    fun concurrentUpdatesAcrossSequencerInstancesPublishInCountOrder() {
        val store = ConversationNotificationStore(keyValueStore)
        val firstSequencer = ConversationNotificationSequencer(store)
        val secondSequencer = ConversationNotificationSequencer(store)
        val firstPublishEntered = CountDownLatch(1)
        val allowFirstPublishToFinish = CountDownLatch(1)
        val secondUpdateStarted = CountDownLatch(1)
        val secondPublishFinished = CountDownLatch(1)
        val publishedCounts = Collections.synchronizedList(mutableListOf<Int>())
        val executor = Executors.newFixedThreadPool(2)

        try {
            val first = executor.submit {
                firstSequencer.update("g_100", "第一条") { summary ->
                    firstPublishEntered.countDown()
                    assertTrue(allowFirstPublishToFinish.await(5, TimeUnit.SECONDS))
                    publishedCounts += summary.totalCount
                }
            }
            assertTrue(firstPublishEntered.await(5, TimeUnit.SECONDS))
            val second = executor.submit {
                secondUpdateStarted.countDown()
                secondSequencer.update("g_100", "第二条") { summary ->
                    publishedCounts += summary.totalCount
                    secondPublishFinished.countDown()
                }
            }

            assertTrue(secondUpdateStarted.await(5, TimeUnit.SECONDS))
            assertFalse(secondPublishFinished.await(100, TimeUnit.MILLISECONDS))
            allowFirstPublishToFinish.countDown()
            first.get(5, TimeUnit.SECONDS)
            second.get(5, TimeUnit.SECONDS)

            assertEquals(listOf(1, 2), publishedCounts)
        } finally {
            allowFirstPublishToFinish.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun clearAcrossSequencerInstancesWaitsForInFlightPublish() {
        val store = ConversationNotificationStore(keyValueStore)
        val updateSequencer = ConversationNotificationSequencer(store)
        val clearSequencer = ConversationNotificationSequencer(store)
        val publishEntered = CountDownLatch(1)
        val allowPublishToFinish = CountDownLatch(1)
        val clearStarted = CountDownLatch(1)
        val clearFinished = CountDownLatch(1)
        val operations = Collections.synchronizedList(mutableListOf<String>())
        val executor = Executors.newFixedThreadPool(2)

        try {
            val update = executor.submit {
                updateSequencer.update("g_100", "摘要") {
                    publishEntered.countDown()
                    assertTrue(allowPublishToFinish.await(5, TimeUnit.SECONDS))
                    operations += "publish"
                }
            }
            assertTrue(publishEntered.await(5, TimeUnit.SECONDS))
            val clear = executor.submit {
                clearStarted.countDown()
                clearSequencer.clear("g_100") {
                    operations += "cancel"
                    clearFinished.countDown()
                }
            }

            assertTrue(clearStarted.await(5, TimeUnit.SECONDS))
            assertFalse(clearFinished.await(100, TimeUnit.MILLISECONDS))
            allowPublishToFinish.countDown()
            update.get(5, TimeUnit.SECONDS)
            clear.get(5, TimeUnit.SECONDS)

            assertEquals(listOf("publish", "cancel"), operations)
            assertNull(store.get("g_100"))
        } finally {
            allowPublishToFinish.countDown()
            executor.shutdownNow()
        }
    }

    private fun validPayload() = PushPayload(
        recipientUserId = 42L,
        msgId = "msg-1",
        cid = "g_100",
        seq = 86L,
        conversationType = "GROUP",
        groupId = 100L,
        title = "研发群",
        senderName = "张三",
        preview = "今晚八点发布",
        mentioned = false,
        ts = 1_000L,
    )

    private class InMemoryKeyValueStore : KeyValueStore {
        private val values = mutableMapOf<String, String>()

        override fun getString(key: String): String? = values[key]

        override fun putString(key: String, value: String) {
            values[key] = value
        }

        override fun remove(key: String) {
            values.remove(key)
        }
    }
}
