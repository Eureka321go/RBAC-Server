package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.InetAddress;
import java.net.UnknownHostException;

import static org.assertj.core.api.Assertions.assertThat;

class PrivateAddressCheckerTest {

    @ParameterizedTest
    @ValueSource(strings = {
            "127.0.0.1", "127.5.5.5",          // 回环
            "10.0.0.1", "10.255.255.255",       // 私网 A
            "172.16.0.1", "172.31.255.255",     // 私网 B
            "192.168.1.1",                      // 私网 C
            "169.254.169.254",                  // 链路本地 / 云元数据
            "100.64.0.1",                       // CGNAT
            "192.0.0.1",                        // IETF 协议分配
            "198.18.0.1",                       // benchmark
            "224.0.0.1",                        // 组播
            "240.0.0.1",                        // 保留
            "0.0.0.0", "0.1.2.3"                // 0/8
    })
    void dangerous_ipv4(String ip) throws UnknownHostException {
        assertThat(PrivateAddressChecker.isDangerous(InetAddress.getByName(ip)))
                .as(ip).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = { "8.8.8.8", "1.1.1.1", "93.184.216.34" })
    void safe_public_ipv4(String ip) throws UnknownHostException {
        assertThat(PrivateAddressChecker.isDangerous(InetAddress.getByName(ip)))
                .as(ip).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "::1",                        // 回환
            "::",                         // 未指定
            "fe80::1",                    // 链路本地
            "fc00::1", "fd00::1",         // ULA
            "ff02::1",                    // 组播
            "::ffff:169.254.169.254",     // IPv4-mapped 元数据
            "::ffff:10.0.0.1",            // IPv4-mapped 私网
            "64:ff9b::a9fe:a9fe"          // NAT64 内嵌 169.254.169.254
    })
    void dangerous_ipv6(String ip) throws UnknownHostException {
        assertThat(PrivateAddressChecker.isDangerous(InetAddress.getByName(ip)))
                .as(ip).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = { "2001:4860:4860::8888", "2606:4700:4700::1111" })
    void safe_public_ipv6(String ip) throws UnknownHostException {
        assertThat(PrivateAddressChecker.isDangerous(InetAddress.getByName(ip)))
                .as(ip).isFalse();
    }
}
