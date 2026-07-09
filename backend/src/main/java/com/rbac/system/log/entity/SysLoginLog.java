package com.rbac.system.log.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("sys_login_log")
public class SysLoginLog {

    private Long id;
    private String username;
    private String status;
    private String message;
    private String ip;
    private String userAgent;
    private LocalDateTime loginAt;
}
