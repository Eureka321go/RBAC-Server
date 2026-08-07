package com.rayim.eureka32.app.push.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FcmInstallationRegistrationTest {
    @Test
    fun returnsNonBlankToken() {
        assertEquals(
            "token-123",
            FcmInstallationRegistration.targetValue("token-123"),
        )
    }

    @Test
    fun rejectsBlankAndOversizedTokens() {
        assertNull(FcmInstallationRegistration.targetValue(""))
        assertNull(FcmInstallationRegistration.targetValue("x".repeat(2049)))
    }
}
