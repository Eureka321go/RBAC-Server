package com.rbac.system.menu;

import com.rbac.system.menu.mapper.SysMenuMapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.mapping.SqlSource;
import org.apache.ibatis.scripting.defaults.RawSqlSource;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThatCode;

class SysMenuMapperTest {

    @Test
    void annotatedSelectStatementsCanBeParsedByMyBatis() {
        Configuration configuration = new Configuration();

        assertThatCode(() -> Arrays.stream(SysMenuMapper.class.getDeclaredMethods())
                .map(Method::getDeclaredAnnotations)
                .flatMap(Arrays::stream)
                .filter(Select.class::isInstance)
                .map(Select.class::cast)
                .map(select -> String.join(" ", select.value()))
                .forEach(sql -> {
                    SqlSource source = new RawSqlSource(configuration, sql, Object.class);
                    if (!(source.getBoundSql(new Object()).getSql().isBlank())) {
                        return;
                    }
                    throw new IllegalStateException("SQL must not be blank");
                })).doesNotThrowAnyException();
    }
}
