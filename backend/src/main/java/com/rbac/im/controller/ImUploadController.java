package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.dto.PresignRequest;
import com.rbac.im.service.MediaService;
import com.rbac.im.vo.PresignResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** IM 富媒体上传：预签名直传。 */
@RestController
@RequestMapping("/im/upload")
public class ImUploadController {

    private final MediaService mediaService;

    public ImUploadController(MediaService mediaService) {
        this.mediaService = mediaService;
    }

    @PostMapping("/presign")
    public Result<PresignResult> presign(@RequestBody PresignRequest req) {
        return Result.success(mediaService.presign(
                SecurityUtils.getUserId(), req.getCid(), req.getType(),
                req.getFilename(), req.getMime(), req.getSize()));
    }
}
