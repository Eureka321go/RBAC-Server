package com.rbac.workflow.definition;

import com.rbac.workflow.definition.entity.WfProcessDefinition;
import com.rbac.workflow.definition.mapper.WfProcessDefinitionMapper;
import com.rbac.workflow.definition.service.DefinitionOptionService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DefinitionOptionServiceTest {

    @Test
    void listEnabledKeepsOnlyLatestVersionForEachProcessKey() {
        WfProcessDefinitionMapper mapper = mock(WfProcessDefinitionMapper.class);
        when(mapper.selectList(any())).thenReturn(List.of(
                definition(3L, "leave", "请假审批", 2),
                definition(1L, "leave", "请假审批", 1),
                definition(2L, "expense", "报销审批", 1)
        ));

        var options = new DefinitionOptionService(mapper).listEnabled();

        assertThat(options).extracting("processKey").containsExactly("leave", "expense");
        assertThat(options.getFirst().getVersion()).isEqualTo(2);
    }

    private WfProcessDefinition definition(Long id, String key, String name, int version) {
        WfProcessDefinition definition = new WfProcessDefinition();
        definition.setId(id);
        definition.setProcessKey(key);
        definition.setName(name);
        definition.setCategory("general");
        definition.setFormKey(key);
        definition.setVersion(version);
        definition.setStatus("ENABLED");
        return definition;
    }
}
