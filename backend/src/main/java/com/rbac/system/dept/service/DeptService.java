package com.rbac.system.dept.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.rbac.common.exception.BusinessException;
import com.rbac.system.dept.dto.DeptSaveRequest;
import com.rbac.system.dept.entity.SysDept;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.dept.vo.DeptVO;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 部门管理服务：部门树 CRUD。存在子部门或用户时不允许删除。
 */
@Service
public class DeptService {

    private final SysDeptMapper deptMapper;
    private final SysUserMapper userMapper;

    public DeptService(SysDeptMapper deptMapper, SysUserMapper userMapper) {
        this.deptMapper = deptMapper;
        this.userMapper = userMapper;
    }

    public List<DeptVO> tree() {
        List<SysDept> all = deptMapper.selectList(Wrappers.<SysDept>lambdaQuery()
                .orderByAsc(SysDept::getSortOrder));
        return DeptVO.buildTree(all);
    }

    public SysDept getById(Long id) {
        SysDept dept = deptMapper.selectById(id);
        if (dept == null) {
            throw new BusinessException("部门不存在");
        }
        return dept;
    }

    public Long create(DeptSaveRequest req) {
        SysDept dept = new SysDept();
        apply(dept, req);
        deptMapper.insert(dept);
        return dept.getId();
    }

    public void update(Long id, DeptSaveRequest req) {
        getById(id);
        if (req.getParentId() != null && req.getParentId().equals(id)) {
            throw new BusinessException("上级部门不能是自身");
        }
        SysDept dept = new SysDept();
        apply(dept, req);
        dept.setId(id);
        deptMapper.updateById(dept);
    }

    public void delete(Long id) {
        getById(id);
        long children = deptMapper.selectCount(Wrappers.<SysDept>lambdaQuery().eq(SysDept::getParentId, id));
        if (children > 0) {
            throw new BusinessException("存在子部门，无法删除");
        }
        long users = userMapper.selectCount(Wrappers.<SysUser>lambdaQuery().eq(SysUser::getDeptId, id));
        if (users > 0) {
            throw new BusinessException("部门下存在用户，无法删除");
        }
        deptMapper.deleteById(id);
    }

    public void updateStatus(Long id, String status) {
        getById(id);
        SysDept update = new SysDept();
        update.setId(id);
        update.setStatus(status);
        deptMapper.updateById(update);
    }

    private void apply(SysDept dept, DeptSaveRequest req) {
        dept.setParentId(req.getParentId() == null ? 0L : req.getParentId());
        dept.setDeptName(req.getDeptName());
        dept.setLeaderUserId(req.getLeaderUserId());
        dept.setPhone(req.getPhone());
        dept.setEmail(req.getEmail());
        dept.setSortOrder(req.getSortOrder() == null ? 0 : req.getSortOrder());
        dept.setStatus(req.getStatus() == null ? "ENABLED" : req.getStatus());
    }
}
