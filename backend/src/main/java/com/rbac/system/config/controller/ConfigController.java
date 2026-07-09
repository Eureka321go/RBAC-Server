package com.rbac.system.config.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.system.config.dto.ConfigQuery;
import com.rbac.system.config.dto.ConfigSaveRequest;
import com.rbac.system.config.service.ConfigService;
import com.rbac.system.config.vo.ConfigVO;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/system/configs")
public class ConfigController {

    private final ConfigService configService;

    public ConfigController(ConfigService configService) {
        this.configService = configService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('system:config:list')")
    public Result<PageResult<ConfigVO>> page(ConfigQuery query) {
        return Result.success(configService.page(query));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('system:config:list')")
    public Result<ConfigVO> detail(@PathVariable Long id) {
        return Result.success(ConfigVO.from(configService.getById(id)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:config:add')")
    public Result<Long> create(@Valid @RequestBody ConfigSaveRequest request) {
        return Result.success(configService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:config:edit')")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody ConfigSaveRequest request) {
        configService.update(id, request);
        return Result.success();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:config:delete')")
    public Result<Void> delete(@PathVariable Long id) {
        configService.delete(id);
        return Result.success();
    }
}
