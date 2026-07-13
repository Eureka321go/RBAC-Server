package com.rbac.workflow.instance;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.security.model.LoginUser;
import com.rbac.system.user.mapper.SysUserMapper;
import com.rbac.workflow.engine.WorkflowEngine;
import com.rbac.workflow.instance.entity.WfProcessInstance;
import com.rbac.workflow.instance.mapper.WfProcessCcMapper;
import com.rbac.workflow.instance.mapper.WfProcessInstanceMapper;
import com.rbac.workflow.instance.service.InstanceService;
import com.rbac.workflow.task.mapper.WfProcessRecordMapper;
import com.rbac.workflow.task.mapper.WfProcessTaskMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InstanceServiceTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void detailAllowsUserCopiedOnTheInstance() {
        WfProcessInstanceMapper instanceMapper = mock(WfProcessInstanceMapper.class);
        WfProcessRecordMapper recordMapper = mock(WfProcessRecordMapper.class);
        WfProcessTaskMapper taskMapper = mock(WfProcessTaskMapper.class);
        WfProcessCcMapper ccMapper = mock(WfProcessCcMapper.class);
        SysUserMapper userMapper = mock(SysUserMapper.class);
        WfProcessInstance instance = instance(7L, 1L);

        when(instanceMapper.selectById(7L)).thenReturn(instance);
        when(taskMapper.selectCount(any())).thenReturn(0L);
        when(ccMapper.selectCount(any())).thenReturn(1L);
        when(recordMapper.selectList(any())).thenReturn(List.of());
        when(taskMapper.selectList(any())).thenReturn(List.of());
        when(userMapper.selectBatchIds(any())).thenReturn(List.of());
        authenticate(9L);

        InstanceService service = new InstanceService(
                mock(WorkflowEngine.class), instanceMapper, recordMapper, taskMapper,
                ccMapper, userMapper, new ObjectMapper());

        assertThat(service.detail(7L).getId()).isEqualTo(7L);
    }

    private void authenticate(Long userId) {
        LoginUser user = new LoginUser();
        user.setUserId(userId);
        user.setUsername("cc-user");
        user.setRoleCodes(List.of());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    private WfProcessInstance instance(Long id, Long initiatorId) {
        WfProcessInstance instance = new WfProcessInstance();
        instance.setId(id);
        instance.setInitiatorId(initiatorId);
        instance.setProcessKey("leave");
        instance.setTitle("Leave request");
        instance.setInstanceStatus("RUNNING");
        return instance;
    }
}
