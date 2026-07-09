package com.rbac.system.log.aspect;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.common.util.SecurityUtils;
import com.rbac.security.model.LoginUser;
import com.rbac.system.log.annotation.Log;
import com.rbac.system.log.entity.SysOperationLog;
import com.rbac.system.log.service.LogService;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 操作日志切面：拦截标注 {@link Log} 的方法，记录操作模块、耗时、结果、操作人与部门。
 * 参数序列化失败或超长时做降级/截断，避免影响主流程。
 */
@Aspect
@Component
public class OperationLogAspect {

    private final LogService logService;
    private final ObjectMapper objectMapper;

    public OperationLogAspect(LogService logService, ObjectMapper objectMapper) {
        this.logService = logService;
        this.objectMapper = objectMapper;
    }

    @Around("@annotation(logAnno)")
    public Object around(ProceedingJoinPoint point, Log logAnno) throws Throwable {
        long start = System.currentTimeMillis();
        SysOperationLog log = new SysOperationLog();
        log.setTitle(logAnno.title());
        log.setBusinessType(logAnno.businessType());
        MethodSignature signature = (MethodSignature) point.getSignature();
        log.setMethod(signature.getDeclaringTypeName() + "." + signature.getName());
        fillRequest(log);
        fillOperator(log);
        log.setParams(safeParams(point.getArgs()));

        try {
            Object result = point.proceed();
            log.setStatus("SUCCESS");
            return result;
        } catch (Throwable ex) {
            log.setStatus("FAILURE");
            log.setErrorMsg(ex.getMessage());
            throw ex;
        } finally {
            log.setCostMs(System.currentTimeMillis() - start);
            try {
                logService.recordOperation(log);
            } catch (Exception ignored) {
                // 日志写入失败不影响业务
            }
        }
    }

    private void fillRequest(SysOperationLog log) {
        HttpServletRequest request = currentRequest();
        if (request != null) {
            log.setRequestUri(request.getRequestURI());
            log.setRequestMethod(request.getMethod());
            log.setIp(request.getRemoteAddr());
        }
    }

    private void fillOperator(SysOperationLog log) {
        LoginUser user = SecurityUtils.getLoginUserOrNull();
        if (user != null) {
            log.setOperatorId(user.getUserId());
            log.setOperator(user.getUsername());
            log.setDeptId(user.getDeptId());
        }
    }

    private String safeParams(Object[] args) {
        try {
            return objectMapper.writeValueAsString(args);
        } catch (Exception e) {
            return "[参数序列化失败]";
        }
    }

    private HttpServletRequest currentRequest() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
            return attrs.getRequest();
        }
        return null;
    }
}
