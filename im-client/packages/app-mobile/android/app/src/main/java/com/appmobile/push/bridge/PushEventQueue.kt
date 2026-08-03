package com.appmobile.push.bridge

import android.content.Context
import android.content.SharedPreferences
import java.net.URLDecoder
import java.net.URLEncoder

data class PushOpenEvent(
    val recipientUserId: Long,
    val cid: String,
    val conversationType: String,
    val groupId: Long?,
    val title: String,
) {
    fun isValid(): Boolean =
        recipientUserId in 0..MAX_SAFE_JS_INTEGER &&
            cid.isNotBlank() && cid.length <= 64 &&
            title.isNotBlank() && title.length <= 128 &&
            when (conversationType) {
                "SINGLE" -> groupId == null
                "GROUP" -> groupId != null && groupId in 0..MAX_SAFE_JS_INTEGER
                else -> false
            }

    companion object {
        const val MAX_SAFE_JS_INTEGER = 9_007_199_254_740_991L
    }
}

class PushEventQueue(
    private val storage: Storage,
) {
    constructor(context: Context) : this(
        SharedPreferencesStorage(
            context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE),
        ),
    )

    interface Storage {
        fun get(key: String): String?
        fun put(key: String, value: String)
        fun remove(key: String)
    }

    fun enqueue(event: PushOpenEvent) = synchronized(LOCK) {
        if (!event.isValid()) return@synchronized
        storage.put(KEY_OPEN, encode(event))
        emitOpenIfPossible()
    }

    fun consumeOpen(): PushOpenEvent? = synchronized(LOCK) {
        val event = storage.get(KEY_OPEN)?.let(::decode)
        storage.remove(KEY_OPEN)
        event
    }

    fun enqueueForegroundMessage(cid: String) = synchronized(LOCK) {
        if (cid.isBlank() || cid.length > 64) return@synchronized
        storage.put(KEY_FOREGROUND, cid)
        emitForegroundIfPossible()
    }

    fun markSyncAllRequired() = synchronized(LOCK) {
        storage.put(KEY_SYNC_ALL, "1")
        emitSyncAllIfPossible()
    }

    fun drain(eventName: String) = synchronized(LOCK) {
        when (eventName) {
            EVENT_FOREGROUND -> emitForegroundIfPossible()
            EVENT_OPENED -> emitOpenIfPossible()
            EVENT_SYNC_ALL -> emitSyncAllIfPossible()
        }
    }

    private fun emitOpenIfPossible() {
        val encoded = storage.get(KEY_OPEN) ?: return
        val event = decode(encoded) ?: run {
            storage.remove(KEY_OPEN)
            return
        }
        if (eventSink?.emit(EVENT_OPENED, event.toPayload()) == true && storage.get(KEY_OPEN) == encoded) {
            storage.remove(KEY_OPEN)
        }
    }

    private fun emitForegroundIfPossible() {
        val cid = storage.get(KEY_FOREGROUND)
            ?.takeIf { it.isNotBlank() && it.length <= 64 }
            ?: return
        if (eventSink?.emit(EVENT_FOREGROUND, mapOf("cid" to cid)) == true &&
            storage.get(KEY_FOREGROUND) == cid
        ) {
            storage.remove(KEY_FOREGROUND)
        }
    }

    private fun emitSyncAllIfPossible() {
        if (storage.get(KEY_SYNC_ALL) != "1") return
        if (eventSink?.emit(EVENT_SYNC_ALL, emptyMap()) == true && storage.get(KEY_SYNC_ALL) == "1") {
            storage.remove(KEY_SYNC_ALL)
        }
    }

    private fun PushOpenEvent.toPayload(): Map<String, Any?> = buildMap {
        put("recipientUserId", recipientUserId.toDouble())
        put("cid", cid)
        put("conversationType", conversationType)
        groupId?.let { put("groupId", it.toDouble()) }
        put("title", title)
    }

    private fun encode(event: PushOpenEvent): String = listOf(
        event.recipientUserId.toString(),
        encodeText(event.cid),
        event.conversationType,
        event.groupId?.toString().orEmpty(),
        encodeText(event.title),
    ).joinToString("|")

    private fun decode(raw: String): PushOpenEvent? = runCatching {
        val fields = raw.split('|')
        if (fields.size != 5) return null
        PushOpenEvent(
            recipientUserId = fields[0].toLong(),
            cid = decodeText(fields[1]),
            conversationType = fields[2],
            groupId = fields[3].takeIf(String::isNotEmpty)?.toLong(),
            title = decodeText(fields[4]),
        ).takeIf(PushOpenEvent::isValid)
    }.getOrNull()

    private fun encodeText(value: String): String =
        URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun decodeText(value: String): String =
        URLDecoder.decode(value, Charsets.UTF_8.name())

    fun interface EventSink {
        fun emit(eventName: String, payload: Map<String, Any?>): Boolean
    }

    private class SharedPreferencesStorage(
        private val preferences: SharedPreferences,
    ) : Storage {
        override fun get(key: String): String? = preferences.getString(key, null)
        override fun put(key: String, value: String) {
            preferences.edit().putString(key, value).apply()
        }
        override fun remove(key: String) {
            preferences.edit().remove(key).apply()
        }
    }

    companion object {
        const val EVENT_FOREGROUND = "foregroundMessage"
        const val EVENT_OPENED = "notificationOpened"
        const val EVENT_SYNC_ALL = "syncAllRequired"
        internal const val KEY_OPEN = "pending_open"
        internal const val KEY_FOREGROUND = "pending_foreground"
        internal const val KEY_SYNC_ALL = "pending_sync_all"
        private const val PREFS_NAME = "im_push_events"
        private val LOCK = Any()

        @Volatile
        private var eventSink: EventSink? = null

        fun registerEventSink(sink: EventSink) {
            eventSink = sink
        }

        fun unregisterEventSink(sink: EventSink) {
            synchronized(LOCK) {
                if (eventSink === sink) eventSink = null
            }
        }

        internal fun setEventSinkForTests(sink: EventSink) {
            eventSink = sink
        }

        internal fun clearEventSinkForTests() {
            eventSink = null
        }
    }
}
