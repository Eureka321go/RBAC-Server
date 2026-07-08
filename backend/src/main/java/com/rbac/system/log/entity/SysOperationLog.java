package com.rbac.system.log.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("sys_operation_log")
public class SysOperationLog {

    private Long id;
    private String title;
    private String businessType;
    private String method;
    private String requestUri;
    private String requestMethod;
    private Long operatorId;
    private String operator;
    private Long deptId;
    private String params;
    private String status;
    private String errorMsg;
    private Long costMs;
    private String ip;
    private LocalDateTime operateAt;
}
