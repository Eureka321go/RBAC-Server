package com.rbac.common.config;

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import com.rbac.common.util.SecurityUtils;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * 审计字段自动填充：新增填 createdBy/createdAt/updatedBy/updatedAt，
 * 更新填 updatedBy/updatedAt。
 */
@Component
public class AuditMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        // 同一次插入共用一个时间值，避免四个审计字段之间出现细微时间差。
        LocalDateTime now = LocalDateTime.now();

        // 未登录的系统任务可能拿不到用户 ID，此时保留为 null，交给数据库字段约束决定是否允许。
        Long userId = SecurityUtils.getUserIdOrNull();

        // 属性名使用实体中的 Java 字段名，而不是数据库中的下划线字段名。
        // strictInsertFill 只处理声明了 FieldFill.INSERT 或 INSERT_UPDATE 的字段。
        strictInsertFill(metaObject, "createdAt", LocalDateTime.class, now);
        strictInsertFill(metaObject, "updatedAt", LocalDateTime.class, now);
        strictInsertFill(metaObject, "createdBy", Long.class, userId);
        strictInsertFill(metaObject, "updatedBy", Long.class, userId);
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        // 更新时仅刷新修改信息，创建人和创建时间必须保持不变。
        // strictUpdateFill 只处理声明了 FieldFill.UPDATE 或 INSERT_UPDATE 的字段。
        strictUpdateFill(metaObject, "updatedAt", LocalDateTime.class, LocalDateTime.now());
        strictUpdateFill(metaObject, "updatedBy", Long.class, SecurityUtils.getUserIdOrNull());
    }
}
