package com.rbac.common.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * RBAC 自定义配置（前缀 {@code rbac}）的类型安全绑定。
 *
 * <p>取代原先散落在 {@code JwtTokenProvider}、{@code UserService} 的 {@code @Value}：
 * 一组相关配置收成一个 POJO，启动时统一做 JSR-303 校验（{@code @Validated}），
 * 缺失或非法即 fail-fast，避免"跑起来才发现密钥太短"。
 *
 * <p>启用方式见启动类 {@code @ConfigurationPropertiesScan}。
 */
@Validated
@ConfigurationProperties(prefix = "rbac")
public class RbacProperties {

    /** JWT 相关配置（{@code rbac.jwt.*}）。 */
    @Valid
    private final Jwt jwt = new Jwt();

    /** 安全相关配置（{@code rbac.security.*}）。 */
    @Valid
    private final Security security = new Security();

    public Jwt getJwt() {
        return jwt;
    }

    public Security getSecurity() {
        return security;
    }

    /** {@code rbac.jwt.*} */
    public static class Jwt {

        /**
         * 签名密钥。HMAC-SHA256 要求密钥长度 ≥ 256 bit（≥ 32 字节），
         * 故这里约束 {@code @Size(min = 32)}。生产环境务必用环境变量覆盖。
         */
        @NotBlank
        @Size(min = 32, message = "JWT 密钥长度至少 32 字节（HMAC-SHA256 需 ≥256bit）")
        private String secret;

        /** Access Token 有效期（秒）。 */
        @Positive
        private long accessTtl;

        /** Refresh Token 有效期（秒）。 */
        @Positive
        private long refreshTtl;

        public String getSecret() {
            return secret;
        }

        public void setSecret(String secret) {
            this.secret = secret;
        }

        public long getAccessTtl() {
            return accessTtl;
        }

        public void setAccessTtl(long accessTtl) {
            this.accessTtl = accessTtl;
        }

        public long getRefreshTtl() {
            return refreshTtl;
        }

        public void setRefreshTtl(long refreshTtl) {
            this.refreshTtl = refreshTtl;
        }
    }

    /** {@code rbac.security.*} */
    public static class Security {

        /** 新建用户时的默认密码（明文，落库前会加密）。 */
        @NotBlank
        private String defaultPassword;

        public String getDefaultPassword() {
            return defaultPassword;
        }

        public void setDefaultPassword(String defaultPassword) {
            this.defaultPassword = defaultPassword;
        }
    }
}
