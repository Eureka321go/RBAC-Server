# IM 后端 MVP · 里程碑 8：消息撤回 设计

- 日期：2026-07-27
- 分支：`feat/im`（长期集成干线，见总设计「集成分支」约定）
- 上游里程碑：里程碑 7 链接卡片已完成（HEAD `045c049`）
- 总设计：`docs/superpowers/specs/2026-07-22-im-chat-mvp-design.md` 的「消息撤回」「分阶段实施里程碑 · 8」

## 目标

实现 `recall(cid, targetSeq)`：

- **本人或群管理员**在**撤回时间窗**内撤回一条消息；
- 原消息在 MongoDB 标记 `recalled=true` 且**正文清空**（保留占位文档与 seq）；
- 生成一条 **RECALL 控制消息**（新 seq，`body.targetSeq=原seq`）走正常扇出；
- 离线端上线 `pull` 时同样收到 RECALL，多端一致；
- pull 读取被撤回消息时**绝不回原文**（闭合里程碑 4 遗留 FU-2）。

不做：富媒体对象即时删除（仅逻辑撤回，MinIO 对象 GC 留 follow-up）；消息编辑。

## 决策（用户已定 2026-07-27）

1. **权限范围**：单聊仅本人可撤；群聊本人或 OWNER/ADMIN 可撤。
2. **时间窗**：对所有人一视同仁，含群管理员（`now - targetMsg.ts > window` 即拒）。
3. **入口链路**：复用 Kafka `im-inbound`（key=cid），`InboundMessageConsumer` 按 `op` 分支；不新增 REST 端点。理由：与现有发消息架构一致、同分区有序、CLI/压测客户端无需新协议。

## 协议

- 新增 op = `RECALL`。复用现有 `Envelope`（`protocol/Envelope.java`），无需新增字段：
  - 上行：`{ op:"RECALL", cid, senderId:操作者, body:{ targetSeq:<原seq> } }`
  - 控制消息（下行 PUSH / pull 回显）：`{ op/type:"RECALL", cid, senderId:操作者, seq:<新seq>, body:{ targetSeq:<原seq> } }`
- 客户端据 RECALL 控制消息把本地 `targetSeq` 那条渲染为「XXX 撤回了一条消息」。

## 校验顺序（任一失败 → `dispatchToUser` 定向回操作者 ERROR，reason 见下）

1. **成员校验**：`conversationService.isMember(cid, 操作者)` 为假 → `NOT_MEMBER`（复用现有 pushError 语义）。
2. **目标存在**：`repo.findByCidAndSeq(cid, targetSeq)` 空 → `RECALL_TARGET_NOT_FOUND`。
3. **类型可撤**：目标 `type ∈ {SYSTEM, RECALL}` → `NOT_RECALLABLE`（不能撤系统消息 / 撤回消息本身）。
4. **幂等**：目标已 `recalled==true` → **静默返回**（不报错、不重复扇出）。扛 Kafka at-least-once 重投与用户重复点击。
5. **权限**：`操作者 == 原消息 senderId` → 通过；否则若为群会话（`ConversationService.groupIdFromCid(cid) != null`）且 `groupService.isGroupManager(groupId, 操作者)` → 通过；否则 → `RECALL_NO_PERMISSION`。单聊非本人一律拒。
6. **时间窗**：`System.currentTimeMillis() - targetMsg.ts > recallWindowSeconds*1000` → `RECALL_WINDOW_EXPIRED`。对所有人（含管理员）生效。

## 执行（校验全过）

1. **清正文 + 标记**：新增 `ImMessageRepositoryCustom.markRecalled(cid, seq)`，原子 `$set { recalled:true, body:{} }`（点路径 set，不整档覆盖，与 `updateLink` 同风格）。
2. **扇出控制消息**：`messageAppender.append(cid, 操作者Id, "RECALL", Map.of("targetSeq", targetSeq), null)` → 分配新 seq + `updateSummary` + 正常 `dispatch`。
   - `MessageAppender.preview` 补 `RECALL` 分支 → 会话摘要显示 `"[撤回了一条消息]"`。

> 顺序说明：先幂等判断（步骤 4）挡重投，再 markRecalled，最后 append 控制消息。极端崩溃窗（markRecalled 成功但 append 前进程崩）会导致重投被幂等挡掉、控制消息丢失，概率极低，与现有发送路径同等 MVP 姿态，列 follow-up，不在本期兜底。

## 读一致性（闭合 FU-2）

- `MessageQueryService.toVo`：当 `m.recalled==true` → `vo.setBody(Map.of())` 置空，**不经 enricher 回显原 body**。防御式：即便 Mongo 中 body 未清干净，pull 也不泄漏被撤回正文。
- pull 命中 RECALL 控制消息（`type=RECALL, body.targetSeq`）→ 原样透传（enricher 对非媒体类型不改 body），客户端据此渲染撤回占位。

## 新增 / 改动清单

| 文件 | 改动 |
|------|------|
| `service/RecallService.java` | **新增**：校验（6 步）+ 执行编排；`@Value("${rbac.im.recall-window-seconds:120}")` |
| `service/InboundMessageConsumer.java` | `onMessage` 按 `op` 分支：`"RECALL"` → `recallService.recall(env)`；否则现有 append 路径 |
| `service/MessageQueryService.java` | `toVo`：`recalled` 消息 body 置空 |
| `service/MessageAppender.java` | `preview` 补 `RECALL` 分支 |
| `service/GroupService.java` | 暴露 `public boolean isGroupManager(long groupId, long userId)`（role∈{OWNER,ADMIN}，成员不存在 → false） |
| `doc/ImMessageRepository.java` | 新增派生方法 `Optional<ImMessage> findByCidAndSeq(String cid, Long seq)` |
| `doc/ImMessageRepositoryCustom.java` + `Impl` | 新增 `markRecalled(String cid, long seq)` 原子 `$set recalled+body` |

- `protocol/Envelope.java`：无需改（body 承载 targetSeq）。
- `vo/ImMessageVO.java` / `doc/ImMessage.java`：已含 `recalled` 字段，无需改。
- `application.yml`：`rbac.im.recall-window-seconds: 120` 已存在，无需改。

## 群管理员判定

`GroupService` 已有 role 加载与 `requireManage(op)`（OWNER/ADMIN 门禁）。本期新增 `public boolean isGroupManager(long groupId, long userId)` 供 RecallService 调用；RecallService 用 `ConversationService.groupIdFromCid(cid)` 区分单聊 / 群聊（单聊 groupId 为 null → 只走本人分支）。

## 测试（TDD）

- **RecallServiceTest**（mock repo / appender / conversationService / groupService）：
  - 本人撤回成功：markRecalled + append(RECALL, targetSeq) 各一次；
  - 群管理员撤成员成功；
  - 单聊非本人拒（NO_PERMISSION，不 markRecalled、不 append）；
  - 群普通成员撤他人拒（NO_PERMISSION）；
  - 超时间窗拒（WINDOW_EXPIRED）；含管理员超窗也拒；
  - 目标不存在拒（TARGET_NOT_FOUND）；
  - 撤 SYSTEM / RECALL 类型拒（NOT_RECALLABLE）；
  - 已撤回幂等静默（既不报错也不重复 append/markRecalled）；
  - 非成员拒（NOT_MEMBER）。
- **InboundMessageConsumerTest**：op=RECALL → 分发 recallService.recall；op=SEND（或 null/TEXT）→ 仍走 append（无回归）。
- **MessageQueryServiceTest**：recalled 消息 toVo body 为空；RECALL 控制消息 body.targetSeq 透传。
- **ImMessageRepositoryImplTest**：markRecalled ArgumentCaptor 断言 Query(cid+seq) 与 Update($set recalled=true, body={})。
- **端到端（可选，沿里程碑 5 `MutedSendE2ETest` 风格）**：发消息 → recall → pull 得原消息 recalled+body 空 + 一条 RECALL 控制消息。

## 已知 / follow-up

- Kafka at-least-once 崩溃窗（markRecalled 成功但控制消息未 append 即崩）→ 重投被幂等挡、控制消息丢失。极小概率，与现有发送路径同等 MVP 姿态，不本期兜底。
- 富媒体撤回不即时删 MinIO 对象（总设计已明确），留 GC 任务 follow-up。
- 撤回控制消息 senderId=操作者；客户端如需区分「本人撤回」「管理员撤回了成员消息」，可据 senderId 与被撤消息原 senderId 比较（本期不额外落 operatorId 字段）。
