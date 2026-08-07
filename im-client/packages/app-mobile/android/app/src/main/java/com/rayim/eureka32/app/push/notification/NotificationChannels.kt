package com.rayim.eureka32.app.push.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

object NotificationChannels {
    // Android 8+ 不允许应用提高已创建渠道的重要性。使用新 ID 让已安装用户
    // 也能获得高优先级横幅；旧 messages 渠道保留在系统设置中供历史通知使用。
    const val MESSAGES = "messages_high"
    const val MENTIONS = "mentions"
    const val MESSAGE_GROUP = "im_messages"

    fun create(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(MESSAGES, "消息", NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(MENTIONS, "提及我的消息", NotificationManager.IMPORTANCE_HIGH),
            ),
        )
    }
}
