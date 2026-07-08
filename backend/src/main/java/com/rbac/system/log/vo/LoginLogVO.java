package com.rbac.system.log.vo;

import com.rbac.system.log.entity.SysLoginLog;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class LoginLogVO {

    private Long id;
    private String username;
    private String status;
    private String message;
    private String ip;
    private String userAgent;
    private LocalDateTime loginAt;

    public static LoginLogVO from(SysLoginLog l) {
        LoginLogVO vo = new LoginLogVO();
        vo.setId(l.getId());
        vo.setUsername(l.getUsername());
        vo.setStatus(l.getStatus());
        vo.setMessage(l.getMessage());
        vo.setIp(l.getIp());
        vo.setUserAgent(l.getUserAgent());
        vo.setLoginAt(l.getLoginAt());
        return vo;
    }
}
