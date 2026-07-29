package com.rbac.security.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.io.Serializable;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 登录用户上下文。既作为 Spring Security 的 {@link UserDetails}，
 * 也作为 Redis 会话缓存对象（Jackson 序列化）。
 * 如何定义和给用户打上这些“权限标签”？
 */
@Data
@NoArgsConstructor
public class LoginUser implements UserDetails, Serializable {

    private Long userId;
    private String username;
    private String nickname;
    private String avatar;
    private Long deptId;
    private String deptName;
    private List<String> roleCodes;
    /** 按钮/接口权限标识集合，作为 Spring Security authorities。 */
    private Set<String> permissions = new HashSet<>();
    /** 合并后的数据范围。 */
    private String dataScope;

    @JsonIgnore
    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        if (permissions == null) {
            return List.of();
        }
        return permissions.stream().map(SimpleGrantedAuthority::new).collect(Collectors.toList());
    }

    /** 密码在会话缓存中不保存，仅用于登录校验时临时使用。 */
    @JsonIgnore
    @Override
    public String getPassword() {
        return null;
    }

    @Override
    public String getUsername() {
        return username;
    }

    @JsonIgnore
    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @JsonIgnore
    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @JsonIgnore
    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @JsonIgnore
    @Override
    public boolean isEnabled() {
        return true;
    }
}
