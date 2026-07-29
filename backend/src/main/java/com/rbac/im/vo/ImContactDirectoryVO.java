package com.rbac.im.vo;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

@Data
@AllArgsConstructor
public class ImContactDirectoryVO {
    private List<ImContactDepartmentVO> departments;
    private List<ImContactMemberVO> members;
}
