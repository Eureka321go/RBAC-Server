package com.appmobile.push

import com.appmobile.push.ImPushMessageLogic.Action
import com.appmobile.push.bridge.PushEventQueue
import com.appmobile.push.model.PushPayload
import com.appmobile.push.notification.NotificationCoordinator
import com.appmobile.push.store.PushStateStore
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class ImFirebaseMessagingService : FirebaseMessagingService() {
    private val state: PushStateStore by lazy { PushStateStore.create(applicationContext) }
    private val logic: ImPushMessageLogic by lazy { ImPushMessageLogic(state) }
    private val coordinator: NotificationCoordinator by lazy {
        NotificationCoordinator(applicationContext)
    }
    private val eventQueue: PushEventQueue by lazy { PushEventQueue(applicationContext) }

    override fun onMessageReceived(message: RemoteMessage) {
        val payload = PushPayload.parse(message.data) ?: return
        when (logic.handle(payload, state.activeUserId(), AppVisibilityTracker.isForeground).action) {
            Action.EMIT_FOREGROUND_SYNC -> eventQueue.enqueueForegroundMessage(payload.cid)
            Action.SHOW_NOTIFICATION -> coordinator.show(payload)
            Action.DROP_ACCOUNT_MISMATCH,
            Action.DROP_DUPLICATE,
            -> Unit
        }
    }

    override fun onDeletedMessages() {
        eventQueue.markSyncAllRequired()
    }
}
