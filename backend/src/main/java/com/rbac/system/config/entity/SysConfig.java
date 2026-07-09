package com.rbac.system.config.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("sys_config")
public class SysConfig extends BaseEntity {

    private String configName;
    private String configKey;
    private String configValue;
    private String configType;
    private Integer builtin;
    /** sensitive 是 MySQL 保留字，需加反引号，否则 MP 生成的 SQL 报语法错误。 */
    @TableField("`sensitive`")
    private Integer sensitive;
    private String remark;
}
