package com.rayim.eureka32.app.push

import android.app.Activity
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AppVisibilityTrackerTest {
    private val firstActivity = Activity()
    private val secondActivity = Activity()

    @Before
    fun resetTracker() {
        AppVisibilityTracker.resetForTests()
    }

    @After
    fun resetTrackerAfterTest() {
        AppVisibilityTracker.resetForTests()
    }

    @Test
    fun staysForegroundUntilEveryResumedActivityIsPaused() {
        AppVisibilityTracker.onActivityResumed(firstActivity)
        AppVisibilityTracker.onActivityResumed(secondActivity)

        AppVisibilityTracker.onActivityPaused(firstActivity)
        assertTrue(AppVisibilityTracker.isForeground)

        AppVisibilityTracker.onActivityPaused(secondActivity)
        assertFalse(AppVisibilityTracker.isForeground)
    }
}
