package com.rbac.system.post.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.common.domain.StatusUpdateRequest;
import com.rbac.system.post.dto.PostQuery;
import com.rbac.system.post.dto.PostSaveRequest;
import com.rbac.system.post.service.PostService;
import com.rbac.system.post.vo.PostVO;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/system/posts")
public class PostController {

    private final PostService postService;

    public PostController(PostService postService) {
        this.postService = postService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('system:post:list')")
    public Result<PageResult<PostVO>> page(PostQuery query) {
        return Result.success(postService.page(query));
    }

    /** 全部启用岗位，供用户分配岗位下拉使用。 */
    @GetMapping("/options")
    @PreAuthorize("hasAuthority('system:post:list')")
    public Result<List<PostVO>> options() {
        return Result.success(postService.listAllEnabled());
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('system:post:list')")
    public Result<PostVO> detail(@PathVariable Long id) {
        return Result.success(PostVO.from(postService.getById(id)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:post:add')")
    public Result<Long> create(@Valid @RequestBody PostSaveRequest request) {
        return Result.success(postService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:post:edit')")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody PostSaveRequest request) {
        postService.update(id, request);
        return Result.success();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:post:delete')")
    public Result<Void> delete(@PathVariable Long id) {
        postService.delete(id);
        return Result.success();
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAuthority('system:post:edit')")
    public Result<Void> updateStatus(@PathVariable Long id, @Valid @RequestBody StatusUpdateRequest request) {
        postService.updateStatus(id, request.getStatus());
        return Result.success();
    }
}
