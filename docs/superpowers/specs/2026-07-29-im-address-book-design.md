# IM 完整通讯录与部门层级选择设计

> 状态：已通过头脑风暴评审（2026-07-29）。
> 上游：`docs/superpowers/specs/2026-07-29-im-client-m4-group-chat-design.md`。

## 一、目标

为 IM 客户端提供不依赖后台管理权限的完整企业通讯录，并用部门层级选择器统一支持发起单聊、创建群聊和添加群成员。同时修复群 SYSTEM 消息只显示“用户 #ID”的问题。

## 二、接口契约

新增 `GET /api/im/contacts`，只要求用户已登录，不挂 `system:user:list` 或 `system:dept:list` 权限。

响应 `data`：

```json
{
  "departments": [
    { "id": 1, "parentId": 0, "name": "研发部", "sortOrder": 10 }
  ],
  "members": [
    {
      "userId": 2,
      "deptId": 1,
      "username": "alice",
      "displayName": "Alice",
      "avatar": null
    }
  ]
}
```

接口只返回状态为 `ENABLED` 且未逻辑删除的部门和用户。通讯录是 IM 终端用户能力，不受后台管理的数据范围过滤；不返回手机号、邮箱、角色、岗位等敏感或无关字段。

部门和成员保持扁平数组，前端根据 `parentId` 组树、根据 `deptId` 挂载成员。无有效部门的成员归入前端虚拟节点“未分配部门”。

## 三、后端结构

新增 `ImContactController`、`ImContactService` 和最小 VO：

- `ImContactDirectoryVO`
- `ImContactDepartmentVO`
- `ImContactMemberVO`

Service 分别批量查询启用部门和启用用户，按部门 `sortOrder/id`、成员展示名/id 排序。展示名优先昵称，其次用户名。

群成员接口 `ImGroupMemberVO` 增加 `displayName`，由服务端批量补齐，避免移动端再次依赖系统用户管理接口。

## 四、部门层级选择器

移动端新增可复用的部门通讯录选择器：

- 首屏展示根部门、未分配部门和根级直属成员。
- 点击部门进入下一级；面包屑可返回任意上级。
- 当前层展示直属子部门和直属成员。
- 部门行显示包含所有后代部门的可选人数。
- 支持对当前部门全部后代成员一键全选/取消。
- 当前账号由前端排除；已在群内的成员显示为禁用。
- 接口失败时保留手工输入 userId 的兜底。

发起单聊使用同一目录但保持单选；建群与添加群成员使用多选。

## 五、SYSTEM 消息姓名

后端生成群 SYSTEM 消息时，在原有 `operatorId/targetIds` 外固化：

- `operatorName`
- `targetNames`（顺序与 `targetIds` 对齐）

这样成员离群后，历史消息仍保留当时可读姓名。客户端渲染优先级：

1. 消息体固化姓名；
2. 当前通讯录的 ID→姓名映射；
3. `用户 #ID` 脏数据兜底。

旧的本地 SYSTEM 消息没有姓名字段，进入群聊时使用通讯录映射补齐当前仍存在的用户姓名。

## 六、错误与一致性

- 通讯录请求失败不清空当前页面已有数据，并允许重试。
- 部门父节点缺失或形成异常关系时，将该部门作为根节点展示，前端遍历必须防循环。
- 成员 `deptId` 不存在时进入“未分配部门”。
- 选择结果始终按 userId 去重，提交前排除当前用户和禁用成员。
- 后端仍对建群、加人和群角色进行最终权限与成员校验。

## 七、验证

按用户约定不新增或运行自动化测试。只执行：

- 后端 `-Dmaven.test.skip=true` 编译打包；
- `im-sdk-core` TypeScript 类型检查；
- `app-mobile` TypeScript 类型检查；
- core 平台依赖与 `git diff --check` 检查。

手工验收覆盖多级部门、未分配成员、全选/取消、禁用已有成员、单聊、建群、加人、接口失败兜底，以及新旧 SYSTEM 消息姓名展示。
