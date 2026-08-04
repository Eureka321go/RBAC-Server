package com.rayim.eureka32.app.push

import android.app.Activity
import android.app.Application
import android.os.Bundle

object AppVisibilityTracker : Application.ActivityLifecycleCallbacks {
    @Volatile
    var isForeground: Boolean = false
        private set

    private var resumedActivities = 0

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

    override fun onActivityStarted(activity: Activity) = Unit

    override fun onActivityResumed(activity: Activity) {
        resumedActivities += 1
        isForeground = true
    }

    override fun onActivityPaused(activity: Activity) {
        resumedActivities = (resumedActivities - 1).coerceAtLeast(0)
        isForeground = resumedActivities > 0
    }

    override fun onActivityStopped(activity: Activity) = Unit

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    override fun onActivityDestroyed(activity: Activity) = Unit

    /** Test-only reset for local unit tests that exercise this process-wide tracker. */
    @Synchronized
    internal fun resetForTests() {
        resumedActivities = 0
        isForeground = false
    }
}
