package com.rbac.system.config.vo;

import com.rbac.system.config.entity.SysConfig;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class ConfigVO {

    private Long id;
    private String configName;
    private String configKey;
    private String configValue;
    private String configType;
    private Boolean builtin;
    private Boolean sensitive;
    private String remark;
    private LocalDateTime createdAt;

    /** 列表脱敏：敏感参数值不返回明文。 */
    public static ConfigVO from(SysConfig c) {
        ConfigVO vo = new ConfigVO();
        vo.setId(c.getId());
        vo.setConfigName(c.getConfigName());
        vo.setConfigKey(c.getConfigKey());
        boolean sensitive = c.getSensitive() != null && c.getSensitive() == 1;
        vo.setConfigValue(sensitive ? "******" : c.getConfigValue());
        vo.setConfigType(c.getConfigType());
        vo.setBuiltin(c.getBuiltin() != null && c.getBuiltin() == 1);
        vo.setSensitive(sensitive);
        vo.setRemark(c.getRemark());
        vo.setCreatedAt(c.getCreatedAt());
        return vo;
    }
}
