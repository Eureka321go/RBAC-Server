package com.appmobile.push.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

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
