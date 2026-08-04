package com.appmobile.push

import com.appmobile.push.model.PushPayload
import com.appmobile.push.store.PushStateStore
import java.time.Clock

class ImPushMessageLogic(
    private val state: PushStateStore,
    private val clock: Clock = Clock.systemUTC(),
) {
    enum class Action {
        EMIT_FOREGROUND_SYNC,
        SHOW_NOTIFICATION,
        DROP_ACCOUNT_MISMATCH,
        DROP_DUPLICATE,
    }

    data class HandlingResult(
        val action: Action,
        val payload: PushPayload,
    )

    fun handle(
        payload: PushPayload,
        activeUser: Long?,
        foreground: Boolean,
    ): HandlingResult {
        if (activeUser == null || activeUser != payload.recipientUserId) {
            return HandlingResult(Action.DROP_ACCOUNT_MISMATCH, payload)
        }
        if (!state.markIfNew(payload.msgId, clock.millis())) {
            return HandlingResult(Action.DROP_DUPLICATE, payload)
        }
        val action = if (foreground) {
            Action.EMIT_FOREGROUND_SYNC
        } else {
            Action.SHOW_NOTIFICATION
        }
        return HandlingResult(action, payload)
    }
}
