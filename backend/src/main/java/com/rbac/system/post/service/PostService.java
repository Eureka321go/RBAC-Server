package com.rbac.system.post.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.rbac.common.domain.PageResult;
import com.rbac.common.exception.BusinessException;
import com.rbac.system.post.dto.PostQuery;
import com.rbac.system.post.dto.PostSaveRequest;
import com.rbac.system.post.entity.SysPost;
import com.rbac.system.post.mapper.SysPostMapper;
import com.rbac.system.post.vo.PostVO;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 岗位管理服务：岗位分页 CRUD。岗位编码唯一。
 */
@Service
public class PostService {

    private final SysPostMapper postMapper;

    public PostService(SysPostMapper postMapper) {
        this.postMapper = postMapper;
    }

    public PageResult<PostVO> page(PostQuery query) {
        IPage<SysPost> page = postMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<SysPost>lambdaQuery()
                        .like(StringUtils.hasText(query.getPostName()), SysPost::getPostName, query.getPostName())
                        .like(StringUtils.hasText(query.getPostCode()), SysPost::getPostCode, query.getPostCode())
                        .eq(StringUtils.hasText(query.getStatus()), SysPost::getStatus, query.getStatus())
                        .orderByAsc(SysPost::getSortOrder));
        return PageResult.from(page, PostVO::from);
    }

    public List<PostVO> listAllEnabled() {
        return postMapper.selectList(Wrappers.<SysPost>lambdaQuery()
                        .eq(SysPost::getStatus, "ENABLED").orderByAsc(SysPost::getSortOrder))
                .stream().map(PostVO::from).toList();
    }

    public SysPost getById(Long id) {
        SysPost post = postMapper.selectById(id);
        if (post == null) {
            throw new BusinessException("岗位不存在");
        }
        return post;
    }

    public Long create(PostSaveRequest req) {
        ensureCodeUnique(req.getPostCode(), null);
        SysPost post = new SysPost();
        apply(post, req);
        postMapper.insert(post);
        return post.getId();
    }

    public void update(Long id, PostSaveRequest req) {
        getById(id);
        ensureCodeUnique(req.getPostCode(), id);
        SysPost post = new SysPost();
        apply(post, req);
        post.setId(id);
        postMapper.updateById(post);
    }

    public void delete(Long id) {
        getById(id);
        postMapper.deleteById(id);
    }

    public void updateStatus(Long id, String status) {
        getById(id);
        SysPost update = new SysPost();
        update.setId(id);
        update.setStatus(status);
        postMapper.updateById(update);
    }

    private void apply(SysPost post, PostSaveRequest req) {
        post.setPostName(req.getPostName());
        post.setPostCode(req.getPostCode());
        post.setSortOrder(req.getSortOrder() == null ? 0 : req.getSortOrder());
        post.setStatus(req.getStatus() == null ? "ENABLED" : req.getStatus());
        post.setRemark(req.getRemark());
    }

    private void ensureCodeUnique(String postCode, Long excludeId) {
        long count = postMapper.selectCount(Wrappers.<SysPost>lambdaQuery()
                .eq(SysPost::getPostCode, postCode)
                .ne(excludeId != null, SysPost::getId, excludeId));
        if (count > 0) {
            throw new BusinessException("岗位编码已存在");
        }
    }
}
