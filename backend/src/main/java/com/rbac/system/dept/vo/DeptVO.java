package com.rbac.system.dept.vo;

import com.rbac.system.dept.entity.SysDept;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Data
public class DeptVO {

    private Long id;
    private Long parentId;
    private String deptName;
    private Long leaderUserId;
    private String phone;
    private String email;
    private Integer sortOrder;
    private String status;
    private LocalDateTime createdAt;
    private List<DeptVO> children = new ArrayList<>();

    public static DeptVO from(SysDept d) {
        DeptVO vo = new DeptVO();
        vo.setId(d.getId());
        vo.setParentId(d.getParentId());
        vo.setDeptName(d.getDeptName());
        vo.setLeaderUserId(d.getLeaderUserId());
        vo.setPhone(d.getPhone());
        vo.setEmail(d.getEmail());
        vo.setSortOrder(d.getSortOrder());
        vo.setStatus(d.getStatus());
        vo.setCreatedAt(d.getCreatedAt());
        return vo;
    }

    public static List<DeptVO> buildTree(List<SysDept> depts) {
        List<DeptVO> all = depts.stream().map(DeptVO::from).collect(Collectors.toList());
        Map<Long, DeptVO> byId = all.stream().collect(Collectors.toMap(DeptVO::getId, v -> v));
        List<DeptVO> roots = new ArrayList<>();
        for (DeptVO node : all) {
            DeptVO parent = node.getParentId() == null ? null : byId.get(node.getParentId());
            if (parent != null) {
                parent.getChildren().add(node);
            } else {
                roots.add(node);
            }
        }
        sort(roots);
        return roots;
    }

    private static void sort(List<DeptVO> nodes) {
        nodes.sort(Comparator.comparing(v -> v.getSortOrder() == null ? 0 : v.getSortOrder()));
        nodes.forEach(n -> sort(n.getChildren()));
    }
}
