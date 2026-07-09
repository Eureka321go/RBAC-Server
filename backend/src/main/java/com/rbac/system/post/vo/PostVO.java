package com.rbac.system.post.vo;

import com.rbac.system.post.entity.SysPost;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class PostVO {

    private Long id;
    private String postName;
    private String postCode;
    private Integer sortOrder;
    private String status;
    private String remark;
    private LocalDateTime createdAt;

    public static PostVO from(SysPost p) {
        PostVO vo = new PostVO();
        vo.setId(p.getId());
        vo.setPostName(p.getPostName());
        vo.setPostCode(p.getPostCode());
        vo.setSortOrder(p.getSortOrder());
        vo.setStatus(p.getStatus());
        vo.setRemark(p.getRemark());
        vo.setCreatedAt(p.getCreatedAt());
        return vo;
    }
}
