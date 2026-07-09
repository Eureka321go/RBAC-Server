package com.rbac.system.log.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.rbac.common.domain.PageResult;
import com.rbac.system.log.dto.LoginLogQuery;
import com.rbac.system.log.dto.OperationLogQuery;
import com.rbac.system.log.entity.SysLoginLog;
import com.rbac.system.log.entity.SysOperationLog;
import com.rbac.system.log.mapper.SysLoginLogMapper;
import com.rbac.system.log.mapper.SysOperationLogMapper;
import com.rbac.system.log.vo.LoginLogVO;
import com.rbac.system.log.vo.OperationLogVO;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;

/**
 * 日志服务：登录日志与操作日志的写入与分页查询。写入异步，避免拖慢主流程。
 */
@Service
public class LogService {

    private final SysLoginLogMapper loginLogMapper;
    private final SysOperationLogMapper operationLogMapper;

    public LogService(SysLoginLogMapper loginLogMapper, SysOperationLogMapper operationLogMapper) {
        this.loginLogMapper = loginLogMapper;
        this.operationLogMapper = operationLogMapper;
    }

    @Async
    public void recordLogin(String username, boolean success, String message, String ip, String userAgent) {
        SysLoginLog log = new SysLoginLog();
        log.setUsername(username);
        log.setStatus(success ? "SUCCESS" : "FAILURE");
        log.setMessage(message);
        log.setIp(ip);
        log.setUserAgent(truncate(userAgent, 512));
        log.setLoginAt(LocalDateTime.now());
        loginLogMapper.insert(log);
    }

    @Async
    public void recordOperation(SysOperationLog log) {
        log.setParams(truncate(log.getParams(), 2000));
        log.setErrorMsg(truncate(log.getErrorMsg(), 2000));
        log.setOperateAt(LocalDateTime.now());
        operationLogMapper.insert(log);
    }

    public PageResult<LoginLogVO> pageLoginLogs(LoginLogQuery query) {
        IPage<SysLoginLog> page = loginLogMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<SysLoginLog>lambdaQuery()
                        .like(StringUtils.hasText(query.getUsername()), SysLoginLog::getUsername, query.getUsername())
                        .eq(StringUtils.hasText(query.getStatus()), SysLoginLog::getStatus, query.getStatus())
                        .orderByDesc(SysLoginLog::getId));
        return PageResult.from(page, LoginLogVO::from);
    }

    public PageResult<OperationLogVO> pageOperationLogs(OperationLogQuery query) {
        IPage<SysOperationLog> page = operationLogMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<SysOperationLog>lambdaQuery()
                        .like(StringUtils.hasText(query.getTitle()), SysOperationLog::getTitle, query.getTitle())
                        .like(StringUtils.hasText(query.getOperator()), SysOperationLog::getOperator, query.getOperator())
                        .eq(StringUtils.hasText(query.getStatus()), SysOperationLog::getStatus, query.getStatus())
                        .orderByDesc(SysOperationLog::getId));
        return PageResult.from(page, OperationLogVO::from);
    }

    private String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() > max ? value.substring(0, max) : value;
    }
}
