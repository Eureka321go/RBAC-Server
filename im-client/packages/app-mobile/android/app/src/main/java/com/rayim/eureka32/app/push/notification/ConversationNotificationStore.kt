package com.rayim.eureka32.app.push.notification

import android.content.Context
import com.rayim.eureka32.app.push.store.KeyValueStore
import com.rayim.eureka32.app.push.store.SharedPreferencesKeyValueStore
import java.net.URLDecoder
import java.net.URLEncoder

data class ConversationSummary(
    val totalCount: Int,
    val lines: List<String>,
)

class ConversationNotificationStore(
    private val keyValueStore: KeyValueStore,
) {
    fun append(cid: String, line: String): ConversationSummary = synchronized(STORE_LOCK) {
        val conversations = readAll().toMutableList()
        val existingIndex = conversations.indexOfFirst { it.cid == cid }
        val existing = if (existingIndex >= 0) conversations.removeAt(existingIndex) else null
        val nextCount = existing?.totalCount?.let { count ->
            if (count == Int.MAX_VALUE) count else count + 1
        } ?: 1
        val updated = StoredConversation(
            cid = cid,
            totalCount = nextCount,
            lines = ((existing?.lines ?: emptyList()) + line).takeLast(MAX_LINES),
        )
        conversations += updated
        writeAll(conversations.takeLast(MAX_CONVERSATIONS))
        updated.toSummary()
    }

    fun get(cid: String): ConversationSummary? = synchronized(STORE_LOCK) {
        readAll().firstOrNull { it.cid == cid }?.toSummary()
    }

    fun clear(cid: String) {
        synchronized(STORE_LOCK) {
            writeAll(readAll().filterNot { it.cid == cid })
        }
    }

    private fun readAll(): List<StoredConversation> {
        val raw = keyValueStore.getString(KEY_CONVERSATIONS) ?: return emptyList()
        return raw.lineSequence()
            .take(MAX_CONVERSATIONS)
            .mapNotNull(::decodeConversation)
            .toList()
    }

    private fun writeAll(conversations: List<StoredConversation>) {
        if (conversations.isEmpty()) {
            keyValueStore.remove(KEY_CONVERSATIONS)
            return
        }
        keyValueStore.putString(
            KEY_CONVERSATIONS,
            conversations.joinToString("\n", transform = ::encodeConversation),
        )
    }

    private fun encodeConversation(conversation: StoredConversation): String = listOf(
        encode(conversation.cid),
        conversation.totalCount.toString(),
        conversation.lines.joinToString(",", transform = ::encode),
    ).joinToString("\t")

    private fun decodeConversation(raw: String): StoredConversation? {
        val parts = raw.split('\t', limit = 3)
        if (parts.size != 3) return null
        val cid = decode(parts[0])?.takeIf { it.isNotBlank() && it.length <= MAX_CID_LENGTH }
            ?: return null
        val totalCount = parts[1].toIntOrNull()?.takeIf { it > 0 } ?: return null
        val lines = if (parts[2].isEmpty()) {
            emptyList()
        } else {
            parts[2].split(',').mapNotNull(::decode).takeLast(MAX_LINES)
        }
        return StoredConversation(cid, totalCount, lines)
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun decode(value: String): String? = try {
        URLDecoder.decode(value, Charsets.UTF_8.name())
    } catch (_: IllegalArgumentException) {
        null
    }

    private data class StoredConversation(
        val cid: String,
        val totalCount: Int,
        val lines: List<String>,
    ) {
        fun toSummary() = ConversationSummary(totalCount, lines)
    }

    companion object {
        private const val PREFS_NAME = "im_push_notifications"
        private const val KEY_CONVERSATIONS = "conversations"
        private const val MAX_CID_LENGTH = 64
        private const val MAX_LINES = 5
        private const val MAX_CONVERSATIONS = 50
        private val STORE_LOCK = Any()

        fun create(context: Context): ConversationNotificationStore = ConversationNotificationStore(
            SharedPreferencesKeyValueStore(
                context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE),
            ),
        )
    }
}
