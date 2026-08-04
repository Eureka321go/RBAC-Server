package com.rayim.eureka32.app.push.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

object NotificationChannels {
    const val MESSAGES = "messages"
    const val MENTIONS = "mentions"
    const val MESSAGE_GROUP = "im_messages"

    fun create(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(MESSAGES, "消息", NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(MENTIONS, "提及我的消息", NotificationManager.IMPORTANCE_HIGH),
            ),
        )
    }
}
