package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.im.service.ImContactService;
import com.rbac.im.vo.ImContactDirectoryVO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 登录用户可用的完整 IM 通讯录，不依赖后台用户/部门管理权限。 */
@RestController
@RequestMapping("/im/contacts")
public class ImContactController {

    private final ImContactService contactService;

    public ImContactController(ImContactService contactService) {
        this.contactService = contactService;
    }

    @GetMapping
    public Result<ImContactDirectoryVO> directory() {
        return Result.success(contactService.directory());
    }
}
