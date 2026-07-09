package com.rbac.system.dict.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.rbac.common.domain.PageResult;
import com.rbac.common.exception.BusinessException;
import com.rbac.system.dict.dto.DictDataSaveRequest;
import com.rbac.system.dict.dto.DictTypeQuery;
import com.rbac.system.dict.dto.DictTypeSaveRequest;
import com.rbac.system.dict.entity.SysDictData;
import com.rbac.system.dict.entity.SysDictType;
import com.rbac.system.dict.mapper.SysDictDataMapper;
import com.rbac.system.dict.mapper.SysDictTypeMapper;
import com.rbac.system.dict.vo.DictDataVO;
import com.rbac.system.dict.vo.DictTypeVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 字典管理服务：字典类型分页 CRUD + 字典数据 CRUD。
 * 删除类型会级联删除其下数据项；支持按字典编码查启用数据项。
 */
@Service
public class DictService {

    private final SysDictTypeMapper typeMapper;
    private final SysDictDataMapper dataMapper;

    public DictService(SysDictTypeMapper typeMapper, SysDictDataMapper dataMapper) {
        this.typeMapper = typeMapper;
        this.dataMapper = dataMapper;
    }

    // ------- 字典类型 -------

    public PageResult<DictTypeVO> pageType(DictTypeQuery query) {
        IPage<SysDictType> page = typeMapper.selectPage(
                Page.of(query.current(), query.size()),
                Wrappers.<SysDictType>lambdaQuery()
                        .like(StringUtils.hasText(query.getDictName()), SysDictType::getDictName, query.getDictName())
                        .like(StringUtils.hasText(query.getDictCode()), SysDictType::getDictCode, query.getDictCode())
                        .eq(StringUtils.hasText(query.getStatus()), SysDictType::getStatus, query.getStatus())
                        .orderByDesc(SysDictType::getId));
        return PageResult.from(page, DictTypeVO::from);
    }

    public List<DictTypeVO> listAllTypes() {
        return typeMapper.selectList(Wrappers.<SysDictType>lambdaQuery()
                        .eq(SysDictType::getStatus, "ENABLED").orderByDesc(SysDictType::getId))
                .stream().map(DictTypeVO::from).toList();
    }

    public SysDictType getType(Long id) {
        SysDictType type = typeMapper.selectById(id);
        if (type == null) {
            throw new BusinessException("dict.typeNotFound");
        }
        return type;
    }

    public Long createType(DictTypeSaveRequest req) {
        ensureCodeUnique(req.getDictCode(), null);
        SysDictType type = new SysDictType();
        applyType(type, req);
        typeMapper.insert(type);
        return type.getId();
    }

    public void updateType(Long id, DictTypeSaveRequest req) {
        getType(id);
        ensureCodeUnique(req.getDictCode(), id);
        SysDictType type = new SysDictType();
        type.setId(id);
        applyType(type, req);
        typeMapper.updateById(type);
    }

    @Transactional
    public void deleteType(Long id) {
        getType(id);
        typeMapper.deleteById(id);
        dataMapper.delete(Wrappers.<SysDictData>lambdaQuery().eq(SysDictData::getDictTypeId, id));
    }

    // ------- 字典数据 -------

    /** 按字典类型 ID 查数据项（管理页用，含禁用）。 */
    public List<DictDataVO> listData(Long dictTypeId) {
        return dataMapper.selectList(Wrappers.<SysDictData>lambdaQuery()
                        .eq(SysDictData::getDictTypeId, dictTypeId)
                        .orderByAsc(SysDictData::getSortOrder))
                .stream().map(DictDataVO::from).toList();
    }

    /** 按字典编码查启用数据项（业务下拉用）。 */
    public List<DictDataVO> listDataByCode(String dictCode) {
        SysDictType type = typeMapper.selectOne(Wrappers.<SysDictType>lambdaQuery()
                .eq(SysDictType::getDictCode, dictCode).last("limit 1"));
        if (type == null) {
            return List.of();
        }
        return dataMapper.selectList(Wrappers.<SysDictData>lambdaQuery()
                        .eq(SysDictData::getDictTypeId, type.getId())
                        .eq(SysDictData::getStatus, "ENABLED")
                        .orderByAsc(SysDictData::getSortOrder))
                .stream().map(DictDataVO::from).toList();
    }

    public SysDictData getData(Long id) {
        SysDictData data = dataMapper.selectById(id);
        if (data == null) {
            throw new BusinessException("dict.dataNotFound");
        }
        return data;
    }

    public Long createData(DictDataSaveRequest req) {
        getType(req.getDictTypeId());
        SysDictData data = new SysDictData();
        applyData(data, req);
        dataMapper.insert(data);
        return data.getId();
    }

    public void updateData(Long id, DictDataSaveRequest req) {
        getData(id);
        SysDictData data = new SysDictData();
        data.setId(id);
        applyData(data, req);
        dataMapper.updateById(data);
    }

    public void deleteData(Long id) {
        getData(id);
        dataMapper.deleteById(id);
    }

    private void applyType(SysDictType type, DictTypeSaveRequest req) {
        type.setDictName(req.getDictName());
        type.setDictCode(req.getDictCode());
        type.setStatus(req.getStatus() == null ? "ENABLED" : req.getStatus());
        type.setRemark(req.getRemark());
    }

    private void applyData(SysDictData data, DictDataSaveRequest req) {
        data.setDictTypeId(req.getDictTypeId());
        data.setLabel(req.getLabel());
        data.setValue(req.getValue());
        data.setSortOrder(req.getSortOrder() == null ? 0 : req.getSortOrder());
        data.setDefaultFlag(req.getDefaultFlag() != null && req.getDefaultFlag() ? 1 : 0);
        data.setStatus(req.getStatus() == null ? "ENABLED" : req.getStatus());
        data.setRemark(req.getRemark());
    }

    private void ensureCodeUnique(String dictCode, Long excludeId) {
        long count = typeMapper.selectCount(Wrappers.<SysDictType>lambdaQuery()
                .eq(SysDictType::getDictCode, dictCode)
                .ne(excludeId != null, SysDictType::getId, excludeId));
        if (count > 0) {
            throw new BusinessException("dict.codeExists");
        }
    }
}
