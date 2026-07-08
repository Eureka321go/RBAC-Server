package com.rbac.system.config.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.rbac.common.domain.PageResult;
import com.rbac.common.exception.BusinessException;
import com.rbac.system.config.dto.ConfigQuery;
import com.rbac.system.config.dto.ConfigSaveRequest;
import com.rbac.system.config.entity.SysConfig;
import com.rbac.system.config.mapper.SysConfigMapper;
import com.rbac.system.config.vo.ConfigVO;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 参数配置服务：参数分页 CRUD、按 key 取值。内置参数键不可修改、不可删除；敏感值列表脱敏。
 */
@Service
public class ConfigService {

    private final SysConfigMapper configMapper;

    public ConfigService(SysConfigMapper configMapper) {
        this.configMapper = configMapper;
    }

    public PageResult<ConfigVO> page(ConfigQuery query) {
        IPage<SysConfig> page = configMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<SysConfig>lambdaQuery()
                        .like(StringUtils.hasText(query.getConfigName()), SysConfig::getConfigName, query.getConfigName())
                        .like(StringUtils.hasText(query.getConfigKey()), SysConfig::getConfigKey, query.getConfigKey())
                        .orderByDesc(SysConfig::getId));
        return PageResult.from(page, ConfigVO::from);
    }

    public SysConfig getById(Long id) {
        SysConfig config = configMapper.selectById(id);
        if (config == null) {
            throw new BusinessException("config.notFound");
        }
        return config;
    }

    /** 按参数键取原始值，未配置返回默认值。供业务读取（如初始密码）。 */
    public String getValue(String key, String defaultValue) {
        SysConfig config = configMapper.selectOne(Wrappers.<SysConfig>lambdaQuery()
                .eq(SysConfig::getConfigKey, key).last("limit 1"));
        return config == null || config.getConfigValue() == null ? defaultValue : config.getConfigValue();
    }

    public Long create(ConfigSaveRequest req) {
        ensureKeyUnique(req.getConfigKey(), null);
        SysConfig config = new SysConfig();
        config.setBuiltin(0);
        apply(config, req);
        configMapper.insert(config);
        return config.getId();
    }

    public void update(Long id, ConfigSaveRequest req) {
        SysConfig existing = getById(id);
        boolean builtin = existing.getBuiltin() != null && existing.getBuiltin() == 1;
        if (builtin && !existing.getConfigKey().equals(req.getConfigKey())) {
            throw new BusinessException("config.builtinKeyImmutable");
        }
        ensureKeyUnique(req.getConfigKey(), id);
        SysConfig config = new SysConfig();
        config.setId(id);
        apply(config, req);
        configMapper.updateById(config);
    }

    public void delete(Long id) {
        SysConfig config = getById(id);
        if (config.getBuiltin() != null && config.getBuiltin() == 1) {
            throw new BusinessException("config.builtinUndeletable");
        }
        configMapper.deleteById(id);
    }

    private void apply(SysConfig config, ConfigSaveRequest req) {
        config.setConfigName(req.getConfigName());
        config.setConfigKey(req.getConfigKey());
        config.setConfigValue(req.getConfigValue());
        config.setConfigType(req.getConfigType() == null ? "STRING" : req.getConfigType());
        config.setSensitive(req.getSensitive() != null && req.getSensitive() ? 1 : 0);
        config.setRemark(req.getRemark());
    }

    private void ensureKeyUnique(String key, Long excludeId) {
        long count = configMapper.selectCount(Wrappers.<SysConfig>lambdaQuery()
                .eq(SysConfig::getConfigKey, key)
                .ne(excludeId != null, SysConfig::getId, excludeId));
        if (count > 0) {
            throw new BusinessException("config.keyExists");
        }
    }
}
