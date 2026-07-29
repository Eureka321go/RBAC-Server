package com.rbac.im.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.rbac.im.vo.ImContactDepartmentVO;
import com.rbac.im.vo.ImContactDirectoryVO;
import com.rbac.im.vo.ImContactMemberVO;
import com.rbac.system.dept.entity.SysDept;
import com.rbac.system.dept.mapper.SysDeptMapper;
import com.rbac.system.user.entity.SysUser;
import com.rbac.system.user.mapper.SysUserMapper;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;

/** IM 终端通讯录：只暴露聊天选人所需的启用部门与成员。 */
@Service
public class ImContactService {

    private final SysDeptMapper deptMapper;
    private final SysUserMapper userMapper;

    public ImContactService(SysDeptMapper deptMapper, SysUserMapper userMapper) {
        this.deptMapper = deptMapper;
        this.userMapper = userMapper;
    }

    public ImContactDirectoryVO directory() {
        List<ImContactDepartmentVO> departments = deptMapper.selectList(
                        Wrappers.<SysDept>lambdaQuery()
                                .eq(SysDept::getStatus, "ENABLED")
                                .orderByAsc(SysDept::getSortOrder, SysDept::getId))
                .stream()
                .map(dept -> new ImContactDepartmentVO(
                        dept.getId(),
                        dept.getParentId(),
                        dept.getDeptName(),
                        dept.getSortOrder()))
                .toList();

        List<ImContactMemberVO> members = userMapper.selectList(
                        Wrappers.<SysUser>lambdaQuery()
                                .eq(SysUser::getStatus, "ENABLED"))
                .stream()
                .map(user -> new ImContactMemberVO(
                        user.getId(),
                        user.getDeptId(),
                        user.getUsername(),
                        displayName(user),
                        user.getAvatar()))
                .sorted(Comparator
                        .comparing(ImContactMemberVO::getDisplayName, String.CASE_INSENSITIVE_ORDER)
                        .thenComparing(ImContactMemberVO::getUserId))
                .toList();

        return new ImContactDirectoryVO(departments, members);
    }

    static String displayName(SysUser user) {
        if (user.getNickname() != null && !user.getNickname().isBlank()) {
            return user.getNickname().trim();
        }
        return user.getUsername() == null ? "" : user.getUsername().trim();
    }
}
