package com.rbac.system.dict.vo;

import com.rbac.system.dict.entity.SysDictType;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class DictTypeVO {

    private Long id;
    private String dictName;
    private String dictCode;
    private String status;
    private String remark;
    private LocalDateTime createdAt;

    public static DictTypeVO from(SysDictType t) {
        DictTypeVO vo = new DictTypeVO();
        vo.setId(t.getId());
        vo.setDictName(t.getDictName());
        vo.setDictCode(t.getDictCode());
        vo.setStatus(t.getStatus());
        vo.setRemark(t.getRemark());
        vo.setCreatedAt(t.getCreatedAt());
        return vo;
    }
}
