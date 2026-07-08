package com.rbac.system.log.vo;

import com.rbac.system.log.entity.SysOperationLog;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class OperationLogVO {

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

    public static OperationLogVO from(SysOperationLog l) {
        OperationLogVO vo = new OperationLogVO();
        vo.setId(l.getId());
        vo.setTitle(l.getTitle());
        vo.setBusinessType(l.getBusinessType());
        vo.setMethod(l.getMethod());
        vo.setRequestUri(l.getRequestUri());
        vo.setRequestMethod(l.getRequestMethod());
        vo.setOperatorId(l.getOperatorId());
        vo.setOperator(l.getOperator());
        vo.setDeptId(l.getDeptId());
        vo.setParams(l.getParams());
        vo.setStatus(l.getStatus());
        vo.setErrorMsg(l.getErrorMsg());
        vo.setCostMs(l.getCostMs());
        vo.setIp(l.getIp());
        vo.setOperateAt(l.getOperateAt());
        return vo;
    }
}
