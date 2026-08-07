package com.rayim.eureka32.app.push.bridge

/** 仅允许上传 FCM 返回的、格式受限的注册令牌。 */
internal object FcmInstallationRegistration {
    private const val MAX_TOKEN_LENGTH = 2048

    fun targetValue(token: String?): String? =
        token?.takeIf { it.isNotBlank() && it.length <= MAX_TOKEN_LENGTH }
}
