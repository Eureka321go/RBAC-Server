package com.appmobile.push.store

import android.content.Context
import java.net.URLDecoder
import java.net.URLEncoder

data class PendingOpen(val cid: String)

class PushStateStore(
    private val keyValueStore: KeyValueStore,
) {
    fun activeUserId(): Long? = keyValueStore.getString(KEY_ACTIVE_USER_ID)
        ?.toLongOrNull()
        ?.takeIf { it >= 0 }

    fun setActiveUserId(userId: Long) {
        if (userId >= 0) {
            keyValueStore.putString(KEY_ACTIVE_USER_ID, userId.toString())
        }
    }

    fun clearActiveUserId() {
        keyValueStore.remove(KEY_ACTIVE_USER_ID)
    }

    fun matchesAccount(userId: Long): Boolean = activeUserId() == userId

    fun markIfNew(msgId: String, nowMs: Long): Boolean {
        if (msgId.isBlank() || msgId.length > MAX_MSG_ID_LENGTH || nowMs < 0) return false

        val retained = readSeen().filterValues { timestamp ->
            nowMs - timestamp <= SEEN_TTL_MS
        }.toMutableMap()
        if (retained.containsKey(msgId)) return false

        retained[msgId] = nowMs
        writeSeen(retained.entries.sortedByDescending { it.value }.take(MAX_SEEN))
        return true
    }

    fun enqueueOpen(cid: String) {
        if (isValidCid(cid)) {
            keyValueStore.putString(KEY_PENDING_OPEN_CID, cid)
        }
    }

    fun consumeOpen(): PendingOpen? = consumeCid(KEY_PENDING_OPEN_CID)?.let(::PendingOpen)

    fun enqueueForegroundMessage(cid: String) {
        if (isValidCid(cid)) {
            keyValueStore.putString(KEY_FOREGROUND_CID, cid)
        }
    }

    fun consumeForegroundMessage(): String? = consumeCid(KEY_FOREGROUND_CID)

    fun markSyncAllRequired() {
        keyValueStore.putString(KEY_SYNC_ALL_REQUIRED, "1")
    }

    fun consumeSyncAllRequired(): Boolean {
        val required = keyValueStore.getString(KEY_SYNC_ALL_REQUIRED) == "1"
        keyValueStore.remove(KEY_SYNC_ALL_REQUIRED)
        return required
    }

    private fun consumeCid(key: String): String? {
        val cid = keyValueStore.getString(key)
        keyValueStore.remove(key)
        return cid?.takeIf(::isValidCid)
    }

    private fun readSeen(): Map<String, Long> {
        val raw = keyValueStore.getString(KEY_SEEN_MESSAGES) ?: return emptyMap()
        val seen = linkedMapOf<String, Long>()
        raw.lineSequence().take(MAX_SEEN * 2).forEach { line ->
            if (seen.size >= MAX_SEEN) return@forEach

            val separator = line.lastIndexOf(':')
            if (separator <= 0 || separator == line.lastIndex) return@forEach

            val msgId = decode(line.substring(0, separator)) ?: return@forEach
            val timestamp = line.substring(separator + 1).toLongOrNull() ?: return@forEach
            if (msgId.isNotBlank() && msgId.length <= MAX_MSG_ID_LENGTH && timestamp >= 0) {
                seen.putIfAbsent(msgId, timestamp)
            }
        }
        return seen
    }

    private fun writeSeen(entries: List<Map.Entry<String, Long>>) {
        val value = entries.joinToString(separator = "\n") { entry ->
            "${encode(entry.key)}:${entry.value}"
        }
        keyValueStore.putString(KEY_SEEN_MESSAGES, value)
    }

    private fun isValidCid(cid: String): Boolean = cid.isNotBlank() && cid.length <= MAX_CID_LENGTH

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun decode(value: String): String? = try {
        URLDecoder.decode(value, Charsets.UTF_8.name())
    } catch (_: IllegalArgumentException) {
        null
    }

    companion object {
        const val SEEN_TTL_MS = 48L * 60L * 60L * 1000L
        private const val MAX_SEEN = 512
        private const val MAX_MSG_ID_LENGTH = 128
        private const val MAX_CID_LENGTH = 64
        private const val PREFS_NAME = "im_push_state"
        private const val KEY_ACTIVE_USER_ID = "active_user_id"
        private const val KEY_SEEN_MESSAGES = "seen_messages"
        private const val KEY_PENDING_OPEN_CID = "pending_open_cid"
        private const val KEY_FOREGROUND_CID = "foreground_cid"
        private const val KEY_SYNC_ALL_REQUIRED = "sync_all_required"

        fun create(context: Context): PushStateStore = PushStateStore(
            SharedPreferencesKeyValueStore(
                context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE),
            ),
        )
    }
}
