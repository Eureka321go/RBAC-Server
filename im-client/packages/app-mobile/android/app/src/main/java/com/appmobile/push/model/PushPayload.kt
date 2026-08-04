package com.appmobile.push.model

data class PushPayload(
    val recipientUserId: Long,
    val msgId: String,
    val cid: String,
    val seq: Long,
    val conversationType: String,
    val groupId: Long?,
    val title: String,
    val senderName: String,
    val preview: String,
    val mentioned: Boolean,
    val ts: Long,
) {
    companion object {
        fun parse(data: Map<String, String>): PushPayload? {
            if (data["version"] != "1" || data["event"] != "NEW_MESSAGE") return null

            val recipientUserId = nonNegativeLong(data["recipientUserId"]) ?: return null
            val seq = nonNegativeLong(data["seq"]) ?: return null
            val ts = nonNegativeLong(data["ts"]) ?: return null
            val msgId = requiredText(data["msgId"], 128) ?: return null
            val cid = requiredText(data["cid"], 64) ?: return null
            val conversationType = data["conversationType"]
                ?.takeIf { it == "SINGLE" || it == "GROUP" }
                ?: return null
            val title = requiredText(data["title"], 128) ?: return null
            val senderName = requiredText(data["senderName"], 128) ?: return null
            val preview = data["preview"]?.takeIf { it.length <= 240 } ?: return null
            val groupId = data["groupId"]?.let(::nonNegativeLong)
            if (conversationType == "GROUP" && groupId == null) return null

            return PushPayload(
                recipientUserId = recipientUserId,
                msgId = msgId,
                cid = cid,
                seq = seq,
                conversationType = conversationType,
                groupId = groupId,
                title = title,
                senderName = senderName,
                preview = preview,
                mentioned = data["mentioned"] == "true",
                ts = ts,
            )
        }

        private fun nonNegativeLong(value: String?): Long? =
            value?.toLongOrNull()?.takeIf { it >= 0 }

        private fun requiredText(value: String?, maxLength: Int): String? =
            value?.takeIf { it.isNotBlank() && it.length <= maxLength }
    }
}
