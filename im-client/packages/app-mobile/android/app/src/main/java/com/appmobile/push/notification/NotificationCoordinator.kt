package com.appmobile.push.notification

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.appmobile.MainActivity
import com.appmobile.R
import com.appmobile.push.model.NotificationSpecFactory
import com.appmobile.push.model.PushPayload

class NotificationCoordinator(
    private val context: Context,
    store: ConversationNotificationStore = ConversationNotificationStore.create(context),
    private val specFactory: NotificationSpecFactory = NotificationSpecFactory(),
    private val sequencer: ConversationNotificationSequencer =
        ConversationNotificationSequencer(store),
) {
    fun show(payload: PushPayload) {
        val manager = NotificationManagerCompat.from(context)
        if (!notificationsAllowed(manager)) return

        val spec = specFactory.create(payload)
        sequencer.update(payload.cid, spec.body) { conversation ->
            val style = NotificationCompat.InboxStyle()
            conversation.lines.forEach(style::addLine)
            style.setSummaryText("${conversation.totalCount} 条新消息")

            val notification = NotificationCompat.Builder(context, spec.channelId)
                .setSmallIcon(R.drawable.ic_stat_message)
                .setContentTitle(spec.title)
                .setContentText(spec.body)
                .setStyle(style)
                .setGroup(spec.groupKey)
                .setNumber(conversation.totalCount)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(contentIntent(payload, spec.notificationId))
                .build()
            manager.notify(spec.notificationId, notification)
        }
    }

    fun clearConversation(cid: String) {
        sequencer.clear(cid) {
            NotificationManagerCompat.from(context).cancel(cid.hashCode() and Int.MAX_VALUE)
        }
    }

    private fun notificationsAllowed(manager: NotificationManagerCompat): Boolean {
        if (!manager.areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun contentIntent(payload: PushPayload, notificationId: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_SOURCE, SOURCE_NOTIFICATION)
            putExtra(EXTRA_RECIPIENT_USER_ID, payload.recipientUserId)
            putExtra(EXTRA_CID, payload.cid)
            putExtra(EXTRA_CONVERSATION_TYPE, payload.conversationType)
            payload.groupId?.let { putExtra(EXTRA_GROUP_ID, it) }
            putExtra(EXTRA_TITLE, payload.title)
        }
        return PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val EXTRA_SOURCE = "source"
        const val SOURCE_NOTIFICATION = "im_notification"
        const val EXTRA_RECIPIENT_USER_ID = "recipientUserId"
        const val EXTRA_CID = "cid"
        const val EXTRA_CONVERSATION_TYPE = "conversationType"
        const val EXTRA_GROUP_ID = "groupId"
        const val EXTRA_TITLE = "title"
    }
}
