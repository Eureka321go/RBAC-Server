package com.appmobile.push.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class PushStateStoreTest {
    private val store = PushStateStore(InMemoryKeyValueStore())

    @Test
    fun accountMismatchAndDuplicateAreRejected() {
        store.setActiveUserId(42L)

        assertTrue(store.matchesAccount(42L))
        assertFalse(store.matchesAccount(41L))
        assertTrue(store.markIfNew("msg-1", nowMs = 1000L))
        assertFalse(store.markIfNew("msg-1", nowMs = 1001L))
    }

    @Test
    fun seenMessagesExpireAndKeepOnlyTheMostRecent512Entries() {
        repeat(513) { index ->
            assertTrue(store.markIfNew("msg-$index", nowMs = index.toLong()))
        }

        assertTrue(store.markIfNew("msg-0", nowMs = 513L))
        assertFalse(store.markIfNew("msg-512", nowMs = 514L))
        assertTrue(store.markIfNew("expired", nowMs = 1L))
        assertTrue(
            store.markIfNew(
                "expired",
                nowMs = 1L + PushStateStore.SEEN_TTL_MS + 1L,
            ),
        )
    }

    @Test
    fun clearingTheAccountDoesNotClearDuplicateHistory() {
        store.setActiveUserId(42L)
        assertTrue(store.markIfNew("msg-1", nowMs = 1000L))

        store.clearActiveUserId()

        assertNull(store.activeUserId())
        assertFalse(store.markIfNew("msg-1", nowMs = 1001L))
    }

    @Test
    fun pendingOpenAndForegroundMessageKeepTheLatestValueAndConsumeOnce() {
        store.enqueueOpen("cid-1")
        store.enqueueOpen("cid-2")
        store.enqueueForegroundMessage("cid-3")
        store.enqueueForegroundMessage("cid-4")

        assertEquals("cid-2", store.consumeOpen()?.cid)
        assertNull(store.consumeOpen())
        assertEquals("cid-4", store.consumeForegroundMessage())
        assertNull(store.consumeForegroundMessage())
    }

    @Test
    fun syncAllFlagIsConsumedOnlyOnce() {
        assertFalse(store.consumeSyncAllRequired())

        store.markSyncAllRequired()

        assertTrue(store.consumeSyncAllRequired())
        assertFalse(store.consumeSyncAllRequired())
    }

    @Test
    fun stateRejectsUnboundedIdentifiers() {
        assertFalse(store.markIfNew(" ", nowMs = 1000L))
        assertFalse(store.markIfNew("x".repeat(129), nowMs = 1000L))

        store.enqueueOpen("x".repeat(65))
        store.enqueueForegroundMessage(" ")

        assertNull(store.consumeOpen())
        assertNull(store.consumeForegroundMessage())
    }

    @Test
    fun sharedStoresAllowOnlyOneConcurrentClaimForTheSameMessage() {
        val keyValueStore = RacingKeyValueStore()
        val firstStore = PushStateStore(keyValueStore)
        val secondStore = PushStateStore(keyValueStore)
        val executor = Executors.newFixedThreadPool(2)
        val startBarrier = CyclicBarrier(2)

        try {
            val results = executor.invokeAll(
                listOf(
                    java.util.concurrent.Callable {
                        startBarrier.await()
                        firstStore.markIfNew("msg-1", nowMs = 1000L)
                    },
                    java.util.concurrent.Callable {
                        startBarrier.await()
                        secondStore.markIfNew("msg-1", nowMs = 1000L)
                    },
                ),
            ).map { it.get() }

            assertEquals(1, results.count { it })
        } finally {
            executor.shutdownNow()
        }
    }

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

    private class RacingKeyValueStore : KeyValueStore {
        private val values = mutableMapOf<String, String>()
        private val reads = AtomicInteger(0)
        private val secondReadArrived = CountDownLatch(1)

        override fun getString(key: String): String? {
            val value = synchronized(values) { values[key] }
            when (reads.incrementAndGet()) {
                1 -> {
                    secondReadArrived.await(1, TimeUnit.SECONDS)
                }

                2 -> secondReadArrived.countDown()
            }
            return value
        }

        override fun putString(key: String, value: String) {
            synchronized(values) { values[key] = value }
        }

        override fun remove(key: String) {
            synchronized(values) { values.remove(key) }
        }
    }
}
