package com.rbac.system.dict.controller;

import com.rbac.common.Result;
import com.rbac.common.domain.PageResult;
import com.rbac.system.dict.dto.DictDataSaveRequest;
import com.rbac.system.dict.dto.DictTypeQuery;
import com.rbac.system.dict.dto.DictTypeSaveRequest;
import com.rbac.system.dict.service.DictService;
import com.rbac.system.dict.vo.DictDataVO;
import com.rbac.system.dict.vo.DictTypeVO;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/system")
public class DictController {

    private final DictService dictService;

    public DictController(DictService dictService) {
        this.dictService = dictService;
    }

    // ------- 字典类型 -------

    @GetMapping("/dict-types")
    @PreAuthorize("hasAuthority('system:dict:list')")
    public Result<PageResult<DictTypeVO>> pageType(DictTypeQuery query) {
        return Result.success(dictService.pageType(query));
    }

    @GetMapping("/dict-types/options")
    @PreAuthorize("hasAuthority('system:dict:list')")
    public Result<List<DictTypeVO>> typeOptions() {
        return Result.success(dictService.listAllTypes());
    }

    @PostMapping("/dict-types")
    @PreAuthorize("hasAuthority('system:dict:add')")
    public Result<Long> createType(@Valid @RequestBody DictTypeSaveRequest request) {
        return Result.success(dictService.createType(request));
    }

    @PutMapping("/dict-types/{id}")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    public Result<Void> updateType(@PathVariable Long id, @Valid @RequestBody DictTypeSaveRequest request) {
        dictService.updateType(id, request);
        return Result.success();
    }

    @DeleteMapping("/dict-types/{id}")
    @PreAuthorize("hasAuthority('system:dict:delete')")
    public Result<Void> deleteType(@PathVariable Long id) {
        dictService.deleteType(id);
        return Result.success();
    }

    // ------- 字典数据 -------

    @GetMapping("/dict-data")
    @PreAuthorize("hasAuthority('system:dict:list')")
    public Result<List<DictDataVO>> listData(@RequestParam Long dictTypeId) {
        return Result.success(dictService.listData(dictTypeId));
    }

    /** 按字典编码取启用数据项，供各业务下拉使用（登录后即可读）。 */
    @GetMapping("/dict-data/code/{dictCode}")
    public Result<List<DictDataVO>> listDataByCode(@PathVariable String dictCode) {
        return Result.success(dictService.listDataByCode(dictCode));
    }

    @PostMapping("/dict-data")
    @PreAuthorize("hasAuthority('system:dict:add')")
    public Result<Long> createData(@Valid @RequestBody DictDataSaveRequest request) {
        return Result.success(dictService.createData(request));
    }

    @PutMapping("/dict-data/{id}")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    public Result<Void> updateData(@PathVariable Long id, @Valid @RequestBody DictDataSaveRequest request) {
        dictService.updateData(id, request);
        return Result.success();
    }

    @DeleteMapping("/dict-data/{id}")
    @PreAuthorize("hasAuthority('system:dict:delete')")
    public Result<Void> deleteData(@PathVariable Long id) {
        dictService.deleteData(id);
        return Result.success();
    }
}
