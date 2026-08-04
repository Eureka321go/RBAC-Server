package com.rayim.eureka32.app

import android.content.Intent
import android.os.Bundle
import com.appmobile.push.bridge.PushEventQueue
import com.appmobile.push.bridge.PushOpenEvent
import com.appmobile.push.notification.NotificationCoordinator
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * react-native-screens 要求：传 null 而非 savedInstanceState，
   * 避免 Fragment 状态被系统恢复导致的崩溃。
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    acceptNotificationIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    acceptNotificationIntent(intent)
  }

  private fun acceptNotificationIntent(intent: Intent?) {
    if (intent?.component?.packageName != packageName) return
    val extras = intent.extras ?: return
    if (extras.keySet().any { it !in ALLOWED_NOTIFICATION_EXTRAS }) return
    if (extras.get(NotificationCoordinator.EXTRA_SOURCE) !is String ||
        intent.getStringExtra(NotificationCoordinator.EXTRA_SOURCE) !=
        NotificationCoordinator.SOURCE_NOTIFICATION
    ) return

    val recipient = extras.get(NotificationCoordinator.EXTRA_RECIPIENT_USER_ID) as? Long ?: return
    if (recipient !in 0..PushOpenEvent.MAX_SAFE_JS_INTEGER) return
    val cid = (extras.get(NotificationCoordinator.EXTRA_CID) as? String)
      ?.takeIf { it.isNotBlank() && it.length <= 64 } ?: return
    val type = (extras.get(NotificationCoordinator.EXTRA_CONVERSATION_TYPE) as? String)
      ?.takeIf { it == "SINGLE" || it == "GROUP" } ?: return
    val title = (extras.get(NotificationCoordinator.EXTRA_TITLE) as? String)
      ?.takeIf { it.isNotBlank() && it.length <= 128 } ?: return
    val groupId = when (type) {
      "GROUP" -> (extras.get(NotificationCoordinator.EXTRA_GROUP_ID) as? Long)
        ?.takeIf { it in 0..PushOpenEvent.MAX_SAFE_JS_INTEGER } ?: return
      else -> {
        if (extras.containsKey(NotificationCoordinator.EXTRA_GROUP_ID)) return
        null
      }
    }

    PushEventQueue(applicationContext).enqueue(
      PushOpenEvent(recipient, cid, type, groupId, title),
    )
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "AppMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  companion object {
    private val ALLOWED_NOTIFICATION_EXTRAS = setOf(
      NotificationCoordinator.EXTRA_SOURCE,
      NotificationCoordinator.EXTRA_RECIPIENT_USER_ID,
      NotificationCoordinator.EXTRA_CID,
      NotificationCoordinator.EXTRA_CONVERSATION_TYPE,
      NotificationCoordinator.EXTRA_GROUP_ID,
      NotificationCoordinator.EXTRA_TITLE,
    )
  }
}
