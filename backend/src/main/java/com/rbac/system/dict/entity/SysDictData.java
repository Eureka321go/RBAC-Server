package com.rbac.system.dict.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("sys_dict_data")
public class SysDictData extends BaseEntity {

    private Long dictTypeId;
    private String label;
    private String value;
    private Integer sortOrder;
    private Integer defaultFlag;
    private String status;
    private String remark;
}
