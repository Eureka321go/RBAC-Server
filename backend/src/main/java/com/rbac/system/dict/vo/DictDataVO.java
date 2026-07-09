package com.rbac.system.dict.vo;

import com.rbac.system.dict.entity.SysDictData;
import lombok.Data;

@Data
public class DictDataVO {

    private Long id;
    private Long dictTypeId;
    private String label;
    private String value;
    private Integer sortOrder;
    private Boolean defaultFlag;
    private String status;
    private String remark;

    public static DictDataVO from(SysDictData d) {
        DictDataVO vo = new DictDataVO();
        vo.setId(d.getId());
        vo.setDictTypeId(d.getDictTypeId());
        vo.setLabel(d.getLabel());
        vo.setValue(d.getValue());
        vo.setSortOrder(d.getSortOrder());
        vo.setDefaultFlag(d.getDefaultFlag() != null && d.getDefaultFlag() == 1);
        vo.setStatus(d.getStatus());
        vo.setRemark(d.getRemark());
        return vo;
    }
}
