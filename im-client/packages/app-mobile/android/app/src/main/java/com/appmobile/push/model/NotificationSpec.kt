package com.appmobile.push.model

data class NotificationSpec(
    val notificationId: Int,
    val channelId: String,
    val title: String,
    val body: String,
    val groupKey: String,
)
