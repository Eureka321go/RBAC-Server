package com.rbac.im.controller;

import com.rbac.common.Result;
import com.rbac.common.util.SecurityUtils;
import com.rbac.im.dto.PresignRequest;
import com.rbac.im.dto.MultipartInitRequest;
import com.rbac.im.dto.DownloadPresignRequest;
import com.rbac.im.service.MediaService;
import com.rbac.im.service.MultipartMediaService;
import com.rbac.im.vo.DownloadPresignResult;
import com.rbac.im.vo.MultipartInitResult;
import com.rbac.im.vo.MultipartStatusResult;
import com.rbac.im.vo.PresignResult;
import com.rbac.im.vo.UploadPartPresignResult;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** IM 富媒体上传：预签名直传。 */
@RestController
@RequestMapping("/im/upload")
public class ImUploadController {

    private final MediaService mediaService;
    private final MultipartMediaService multipartMediaService;

    public ImUploadController(MediaService mediaService, MultipartMediaService multipartMediaService) {
        this.mediaService = mediaService;
        this.multipartMediaService = multipartMediaService;
    }

    @PostMapping("/presign")
    public Result<PresignResult> presign(@RequestBody PresignRequest req) {
        return Result.success(mediaService.presign(
                SecurityUtils.getUserId(), req.getCid(), req.getType(),
                req.getFilename(), req.getMime(), req.getSize()));
    }

    @PostMapping("/multipart/init")
    public Result<MultipartInitResult> initMultipart(@RequestBody MultipartInitRequest req) {
        return Result.success(multipartMediaService.init(
                SecurityUtils.getUserId(), req.getCid(), req.getType(),
                req.getFilename(), req.getMime(), req.getSize()));
    }

    @GetMapping("/multipart/{taskId}")
    public Result<MultipartStatusResult> multipartStatus(@PathVariable String taskId) {
        return Result.success(multipartMediaService.status(SecurityUtils.getUserId(), taskId));
    }

    @PostMapping("/multipart/{taskId}/parts/{partNumber}/presign")
    public Result<UploadPartPresignResult> presignPart(
            @PathVariable String taskId, @PathVariable int partNumber) {
        return Result.success(multipartMediaService.presignPart(
                SecurityUtils.getUserId(), taskId, partNumber));
    }

    @PostMapping("/multipart/{taskId}/complete")
    public Result<MultipartStatusResult> completeMultipart(@PathVariable String taskId) {
        return Result.success(multipartMediaService.complete(SecurityUtils.getUserId(), taskId));
    }

    @DeleteMapping("/multipart/{taskId}")
    public Result<Void> abortMultipart(@PathVariable String taskId) {
        multipartMediaService.abort(SecurityUtils.getUserId(), taskId);
        return Result.success();
    }

    @PostMapping("/download/presign")
    public Result<DownloadPresignResult> presignDownload(@RequestBody DownloadPresignRequest req) {
        return Result.success(mediaService.presignDownload(
                SecurityUtils.getUserId(), req.getCid(), req.getObjectKey()));
    }
}
