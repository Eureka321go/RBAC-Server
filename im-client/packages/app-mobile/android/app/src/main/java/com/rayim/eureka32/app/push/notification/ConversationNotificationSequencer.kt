package com.rayim.eureka32.app.push.notification

class ConversationNotificationSequencer(
    private val store: ConversationNotificationStore,
) {
    fun update(
        cid: String,
        line: String,
        publish: (ConversationSummary) -> Unit,
    ) {
        synchronized(OPERATION_LOCK) {
            publish(store.append(cid, line))
        }
    }

    fun clear(cid: String, cancel: () -> Unit) {
        synchronized(OPERATION_LOCK) {
            cancel()
            store.clear(cid)
        }
    }

    companion object {
        private val OPERATION_LOCK = Any()
    }
}
