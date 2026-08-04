package com.rayim.eureka32.app.push.bridge

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.rayim.eureka32.app.push.notification.NotificationCoordinator
import com.rayim.eureka32.app.push.store.PushStateStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.firebase.FirebaseApp
import com.google.firebase.installations.FirebaseInstallations
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

class PushNotificationModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    private val stateStore = PushStateStore.create(reactContext)
    private val eventQueue = PushEventQueue(reactContext)
    private val notificationCoordinator = NotificationCoordinator(reactContext)
    private val readyListenerCounts = mutableMapOf<String, Int>()
    private var listenerCount = 0

    private val eventSink = PushEventQueue.EventSink { eventName, payload ->
        synchronized(readyListenerCounts) {
            if ((readyListenerCounts[eventName] ?: 0) <= 0 || listenerCount <= 0) {
                return@EventSink false
            }
        }
        if (!reactApplicationContext.hasActiveReactInstance()) return@EventSink false
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, Arguments.makeNativeMap(payload))
            true
        } catch (_: RuntimeException) {
            false
        }
    }

    override fun getName(): String = NAME

    override fun initialize() {
        super.initialize()
        PushEventQueue.registerEventSink(eventSink)
    }

    override fun invalidate() {
        PushEventQueue.unregisterEventSink(eventSink)
        synchronized(readyListenerCounts) {
            readyListenerCounts.clear()
            listenerCount = 0
        }
        super.invalidate()
    }

    @ReactMethod
    fun getRegistrationTarget(promise: Promise) {
        val result = SinglePromise(promise)
        try {
            if (FirebaseApp.getApps(reactApplicationContext).isEmpty()) {
                result.resolve(null)
                return
            }
            FirebaseInstallations.getInstance().id
                .addOnSuccessListener { fid ->
                    result.resolve(
                        runCatching {
                            fid.takeIf { it.isNotBlank() && it.length <= MAX_FID_LENGTH }
                                ?.let(::registrationMap)
                        }.getOrNull(),
                    )
                }
                .addOnFailureListener { result.resolve(null) }
        } catch (_: RuntimeException) {
            result.resolve(null)
        }
    }

    @ReactMethod
    fun setActiveUserId(userId: Double, promise: Promise) {
        runCatching {
            if (userId.isFinite() && userId % 1.0 == 0.0 &&
                userId >= 0.0 && userId <= PushOpenEvent.MAX_SAFE_JS_INTEGER.toDouble()
            ) {
                stateStore.setActiveUserId(userId.toLong())
            } else {
                stateStore.clearActiveUserId()
            }
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun clearActiveUserId(promise: Promise) {
        runCatching { stateStore.clearActiveUserId() }
        promise.resolve(null)
    }

    @ReactMethod
    fun areNotificationsEnabled(promise: Promise) {
        val enabled = runCatching {
            val managerEnabled = NotificationManagerCompat.from(reactApplicationContext)
                .areNotificationsEnabled()
            val permissionGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(
                    reactApplicationContext,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED
            managerEnabled && permissionGranted
        }.getOrDefault(false)
        promise.resolve(enabled)
    }

    @ReactMethod
    fun getInitialOpenEvent(promise: Promise) {
        promise.resolve(runCatching { eventQueue.consumeOpen()?.toWritableMap() }.getOrNull())
    }

    @ReactMethod
    fun clearConversationNotification(cid: String, promise: Promise) {
        runCatching {
            if (cid.isNotBlank() && cid.length <= 64) {
                notificationCoordinator.clearConversation(cid)
            }
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        if (eventName !in SUPPORTED_EVENTS) return
        synchronized(readyListenerCounts) {
            listenerCount += 1
        }
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        if (!count.isFinite() || count <= 0.0) return
        synchronized(readyListenerCounts) {
            listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
            if (listenerCount == 0) readyListenerCounts.clear()
        }
    }

    /** Called by the typed JS adapter after NativeEventEmitter installed its JS listener. */
    @ReactMethod
    fun listenerReady(eventName: String) {
        if (eventName !in SUPPORTED_EVENTS) return
        synchronized(readyListenerCounts) {
            readyListenerCounts[eventName] = (readyListenerCounts[eventName] ?: 0) + 1
        }
        eventQueue.drain(eventName)
    }

    /** Keeps event-specific readiness accurate because RN removeListeners omits the event name. */
    @ReactMethod
    fun listenerRemoved(eventName: String) {
        if (eventName !in SUPPORTED_EVENTS) return
        synchronized(readyListenerCounts) {
            val remaining = (readyListenerCounts[eventName] ?: 0) - 1
            if (remaining > 0) readyListenerCounts[eventName] = remaining
            else readyListenerCounts.remove(eventName)
        }
    }

    private fun registrationMap(fid: String): WritableMap = Arguments.createMap().apply {
        putString("targetType", "FID")
        putString("targetValue", fid)
        putString("targetFingerprint", sha256Hex(fid))
        putString("appVersion", appVersion())
    }

    private fun appVersion(): String = runCatching {
        reactApplicationContext.packageManager
            .getPackageInfo(reactApplicationContext.packageName, 0)
            .versionName
            ?: "unknown"
    }.getOrDefault("unknown")

    private fun sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private fun PushOpenEvent.toWritableMap(): WritableMap = Arguments.createMap().apply {
        putDouble("recipientUserId", recipientUserId.toDouble())
        putString("cid", cid)
        putString("conversationType", conversationType)
        groupId?.let { putDouble("groupId", it.toDouble()) }
        putString("title", title)
    }

    private class SinglePromise(private val promise: Promise) {
        private val completed = AtomicBoolean(false)

        fun resolve(value: Any?) {
            if (completed.compareAndSet(false, true)) promise.resolve(value)
        }
    }

    companion object {
        const val NAME = "PushNotification"
        private const val MAX_FID_LENGTH = 4096
        private val SUPPORTED_EVENTS = setOf(
            PushEventQueue.EVENT_FOREGROUND,
            PushEventQueue.EVENT_OPENED,
            PushEventQueue.EVENT_SYNC_ALL,
        )
    }
}
