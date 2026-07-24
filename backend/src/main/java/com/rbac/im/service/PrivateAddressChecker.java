package com.rbac.im.service;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;

/**
 * 判定 IP 是否落在禁止抓取的危险段。防 SSRF：回环/私网/链路本地(含云元数据 169.254.169.254)/
 * 组播/保留/CGNAT/ULA/IPv4-mapped/NAT64 一律 true。纯函数，无 IO。
 */
public final class PrivateAddressChecker {

    private PrivateAddressChecker() {}

    public static boolean isDangerous(InetAddress addr) {
        if (addr == null) return true;
        // JDK 内置标志兜底：AnyLocal(0.0.0.0/::)、Loopback(127/::1)、
        // LinkLocal(169.254/fe80)、SiteLocal(10/172.16/192.168)、Multicast(224/ff00)
        if (addr.isAnyLocalAddress() || addr.isLoopbackAddress() || addr.isLinkLocalAddress()
                || addr.isSiteLocalAddress() || addr.isMulticastAddress()) {
            return true;
        }
        byte[] b = addr.getAddress();
        if (addr instanceof Inet4Address) {
            return dangerousV4(b);
        }
        if (addr instanceof Inet6Address) {
            // IPv4-mapped ::ffff:0:0/96 → 拆内嵌 v4 再判
            if (isV4Mapped(b)) {
                return dangerousV4(last4(b));
            }
            // NAT64 64:ff9b::/96 → 拆内嵌 v4 再判
            if (b[0] == 0x00 && b[1] == 0x64 && b[2] == (byte) 0xff && b[3] == (byte) 0x9b
                    && allZero(b, 4, 12)) {
                return dangerousV4(last4(b));
            }
            // ULA fc00::/7
            if ((b[0] & 0xFE) == 0xFC) {
                return true;
            }
        }
        return false;
    }

    /** 覆盖 JDK 标志未含的 v4 段（标志已含 127/10/172.16/192.168/169.254/224/4/0.0.0.0）。 */
    private static boolean dangerousV4(byte[] b) {
        int b0 = b[0] & 0xFF, b1 = b[1] & 0xFF;
        if (b0 == 0) return true;                              // 0/8
        if (b0 == 127) return true;                            // 回环
        if (b0 == 10) return true;                             // 私网 A
        if (b0 == 172 && b1 >= 16 && b1 <= 31) return true;    // 私网 B
        if (b0 == 192 && b1 == 168) return true;               // 私网 C
        if (b0 == 169 && b1 == 254) return true;               // 链路本地/元数据
        if (b0 == 100 && b1 >= 64 && b1 <= 127) return true;   // CGNAT 100.64/10
        if (b0 == 192 && b1 == 0 && (b[2] & 0xFF) == 0) return true; // 192.0.0/24
        if (b0 == 198 && (b1 == 18 || b1 == 19)) return true;  // 198.18/15 benchmark
        if (b0 >= 224) return true;                            // 224/4 组播 + 240/4 保留
        return false;
    }

    /** ::ffff:0:0/96 → 前 10 字节 0，第 11、12 字节 0xff */
    private static boolean isV4Mapped(byte[] b) {
        return allZero(b, 0, 10) && (b[10] & 0xFF) == 0xff && (b[11] & 0xFF) == 0xff;
    }

    private static byte[] last4(byte[] b) {
        return new byte[]{ b[12], b[13], b[14], b[15] };
    }

    private static boolean allZero(byte[] b, int from, int to) {
        for (int i = from; i < to; i++) if (b[i] != 0) return false;
        return true;
    }
}
