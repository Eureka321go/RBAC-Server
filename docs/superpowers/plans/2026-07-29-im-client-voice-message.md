# IM 客户端语音消息 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Android 与 iOS 客户端实现按住录音、真实振幅波形、直传发送、单实例播放和本地未听状态的语音消息闭环。

**Architecture:** SDK Core 定义语音端口、录音状态机、波形算法和 SQLite 状态；SDK RN 用 Nitro Sound 与 react-native-permissions 实现原生录播和权限；移动端用独立录音组件与全局播放协调器接入聊天页。AUDIO 继续复用现有媒体上传、断点恢复、ACK/PUSH 结算、下载缓存和撤回链路，后端仅增强 AUDIO 元数据校验与摘要文案。

**Tech Stack:** React Native 0.86、TypeScript 5.8、Zustand、op-sqlite、react-native-nitro-sound 0.2.15、react-native-nitro-audio-manager 0.3.5、react-native-nitro-modules 0.36.1、react-native-permissions 5.6.1、Spring Boot、MongoDB、MinIO/S3。

## Global Constraints

- 同时支持 Android minSdk 24 与 iOS 15.1；Nitro Sound 要求 RN >=0.79、Android minSdk >=24、iOS >=13，当前项目满足。
- 单条语音最短 1 秒、最长 60 秒；达到 60 秒自动结束且只发送一次。
- 录音目标格式固定为 AAC-LC、16 kHz、32 kbps、单声道、`.m4a`、`audio/mp4`。
- 波形来自原生 metering：100ms 一次，夹取 `-60dB～0dB`，最终固定 48 个 `0～100` 整数。
- AUDIO 消息体只发送 `objectKey/filename/mime/size/duration/waveform`；本地 URI、原始样本、上传和播放状态禁止上行。
- 播放器全局单实例；完整播放才写本地已听状态；已听状态不上传且不改变会话未读数。
- 本期不做转文字、倍速、拖动定位、自动连播、听筒切换、锁定录音、后台录音和跨设备已听同步。
- 按项目既有约定，不新增或代跑 Jest、JUnit、E2E 等自动化测试；每项使用类型检查、编译检查、`git diff --check` 和最终用户手测验收。
- Git 提交标题使用中文，只做本地提交，不 push。
- 保留并不提交用户现有的 `ImConversationMember.java` 与 `ConversationService.java` 注释改动。

---

## 文件结构

新增文件及单一职责：

- `im-client/packages/im-sdk-core/src/voice/voiceTypes.ts`：语音权限、录音、播放端口与公共类型。
- `im-client/packages/im-sdk-core/src/voice/voiceWaveform.ts`：分贝归一化、48 点重采样和下行元数据解析。
- `im-client/packages/im-sdk-core/src/voice/voiceRecordingController.ts`：防重复结束的录音状态机。
- `im-client/packages/im-sdk-core/src/voice/voiceHeardStore.ts`：本地已听状态 SQLite 读写。
- `im-client/packages/im-sdk-rn/src/adapters/rnVoicePermission.ts`：双平台麦克风权限与系统设置入口。
- `im-client/packages/im-sdk-rn/src/adapters/rnVoiceAudioSession.ts`：音频焦点、系统中断与耳机/蓝牙路由变化适配。
- `im-client/packages/im-sdk-rn/src/adapters/rnVoiceRecorder.ts`：Nitro Sound 录音和 metering 适配。
- `im-client/packages/im-sdk-rn/src/adapters/rnVoicePlayer.ts`：Nitro Sound 播放、暂停、继续和完成事件适配。
- `im-client/packages/app-mobile/src/voice/useVoiceRecording.ts`：页面录音会话、60 秒截止和媒体入队。
- `im-client/packages/app-mobile/src/voice/voicePlaybackCoordinator.ts`：全局单实例播放、下载、进度和已听结算。
- `im-client/packages/app-mobile/src/components/VoiceComposerControl.tsx`：键盘/语音切换与 PanResponder 手势。
- `im-client/packages/app-mobile/src/components/VoiceRecordingOverlay.tsx`：实时录音浮层。
- `im-client/packages/app-mobile/src/components/VoiceMessageContent.tsx`：语音气泡、波形、时长、未听点与加载状态。

主要修改文件：

- `im-client/package-lock.json`、`packages/app-mobile/package.json`、`packages/im-sdk-rn/package.json`：原生依赖与 peer 约束。
- `packages/app-mobile/android/app/src/main/AndroidManifest.xml`、`ios/Podfile`、`ios/AppMobile/Info.plist`：麦克风权限和 iOS handler。
- `packages/im-sdk-core/src/index.ts`：导出语音契约。
- `packages/im-sdk-core/src/store/migrations.ts`、`src/store/messageStore.ts`：媒体元数据列与已听表。
- `packages/im-sdk-core/src/media/mediaTypes.ts`、`mediaUploadStore.ts`、`mediaUploadService.ts`、`chat/chatService.ts`：AUDIO 上传任务与发送。
- `packages/im-sdk-rn/src/createSdk.ts`、`src/index.ts`：装配并暴露语音能力。
- `packages/app-mobile/src/screens/ChatScreen.tsx`、`src/store.ts`：录音、播放、退出清理与错误文案。
- `backend/src/main/java/com/rbac/im/service/MediaService.java`、`MessageAppender.java`：AUDIO 展示元数据校验和 `[语音]` 摘要。
- `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`：更新完成状态与手测清单。

---

### Task 1: 安装音频与权限依赖并完成原生声明

**Files:**
- Modify: `im-client/packages/app-mobile/package.json`
- Modify: `im-client/packages/im-sdk-rn/package.json`
- Modify: `im-client/package-lock.json`
- Modify: `im-client/packages/app-mobile/android/app/src/main/AndroidManifest.xml`
- Modify: `im-client/packages/app-mobile/ios/Podfile`
- Modify: `im-client/packages/app-mobile/ios/AppMobile/Info.plist`

**Interfaces:**
- Consumes: React Native 0.86 New Architecture、Android minSdk 24、iOS 15.1。
- Produces: `react-native-nitro-sound@0.2.15`、`react-native-nitro-audio-manager@0.3.5`、`react-native-nitro-modules@0.36.1`、`react-native-permissions@5.6.1` 可由 SDK RN 导入；两端具备麦克风声明。

- [ ] **Step 1: 在 npm workspace 安装固定版本依赖**

从 `im-client` 目录执行：

```bash
npm install react-native-nitro-sound@0.2.15 react-native-nitro-audio-manager@0.3.5 react-native-nitro-modules@0.36.1 react-native-permissions@5.6.1 --workspace packages/app-mobile
```

确认 `packages/app-mobile/package.json` 出现四个直接依赖，`package-lock.json` 锁定 Sound 0.2.15、Audio Manager 0.3.5、Nitro Modules 0.36.1 与 permissions 5.6.1。

- [ ] **Step 2: 给 SDK RN 声明原生 peerDependencies**

在 `packages/im-sdk-rn/package.json` 的 `peerDependencies` 增加：

```json
{
  "react-native-nitro-audio-manager": ">=0.3.5 <0.4",
  "react-native-nitro-modules": "0.36.1",
  "react-native-nitro-sound": ">=0.2.15 <0.3",
  "react-native-permissions": ">=5.6 <6"
}
```

- [ ] **Step 3: 声明 Android 麦克风权限**

在 `<application>` 之前加入：

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

不要加入 Android 13+ 不需要的外部存储权限；录音文件只落应用私有目录。

- [ ] **Step 4: 配置 iOS Microphone permission handler**

把 Podfile 顶部的单一 `require` 改为可复用函数，并只启用 Microphone：

```ruby
def node_require(script)
  require Pod::Executable.execute_command('node', ['-p',
    "require.resolve(
      '#{script}',
      {paths: [process.argv[1]]},
    )", __dir__]).strip
end

node_require('react-native/scripts/react_native_pods.rb')
node_require('react-native-permissions/scripts/setup.rb')

platform :ios, min_ios_version_supported
prepare_react_native_project!

setup_permissions([
  'Microphone',
])
```

- [ ] **Step 5: 增加 iOS 中文用途说明**

在 `Info.plist` 的相机与相册说明附近加入：

```xml
<key>NSMicrophoneUsageDescription</key>
<string>用于录制并发送聊天语音</string>
```

- [ ] **Step 6: 检查依赖与原生差异**

```bash
npm ls react-native-nitro-sound react-native-nitro-audio-manager react-native-nitro-modules react-native-permissions
git diff --check
git diff -- packages/app-mobile/package.json packages/im-sdk-rn/package.json packages/app-mobile/android/app/src/main/AndroidManifest.xml packages/app-mobile/ios/Podfile packages/app-mobile/ios/AppMobile/Info.plist
```

预期：npm 树无 `invalid`；Manifest 只有录音权限；Podfile 只启用 Microphone handler；Info.plist 有非空中文说明。

- [ ] **Step 7: 本地提交依赖与原生配置**

```bash
git add im-client/package-lock.json im-client/packages/app-mobile/package.json im-client/packages/im-sdk-rn/package.json im-client/packages/app-mobile/android/app/src/main/AndroidManifest.xml im-client/packages/app-mobile/ios/Podfile im-client/packages/app-mobile/ios/AppMobile/Info.plist
git commit -m "构建(IM客户端)：接入语音录播原生依赖"
```

---

### Task 2: 定义语音端口、波形算法和录音状态机

**Files:**
- Create: `im-client/packages/im-sdk-core/src/voice/voiceTypes.ts`
- Create: `im-client/packages/im-sdk-core/src/voice/voiceWaveform.ts`
- Create: `im-client/packages/im-sdk-core/src/voice/voiceRecordingController.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`

**Interfaces:**
- Consumes: `PickedMedia`。
- Produces: `VoicePermissionPort`、`VoiceAudioSessionPort`、`VoiceRecorderPort`、`VoicePlayerPort`、`VoiceRecordingController`、`buildVoiceWaveform(samples)`、`parseVoiceMetadata(body)`。

- [ ] **Step 1: 写入平台无关语音类型**

创建 `voiceTypes.ts`：

```ts
import type { PickedMedia } from '../ports/index';

export type VoicePermissionStatus = 'unavailable' | 'denied' | 'blocked' | 'granted';

export interface VoiceRecordingProgress {
  durationMs: number;
  meteringDb: number | null;
}

export interface RecordedVoice extends PickedMedia {
  durationMs: number;
}

export interface VoicePermissionPort {
  check(): Promise<VoicePermissionStatus>;
  request(): Promise<VoicePermissionStatus>;
  openSettings(): Promise<void>;
}

export interface VoiceAudioSessionPort {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  onPauseRequested(handler: () => void): () => void;
  dispose(): Promise<void>;
}

export interface VoiceRecorderPort {
  start(onProgress: (progress: VoiceRecordingProgress) => void): Promise<void>;
  stop(): Promise<RecordedVoice>;
  cancel(): Promise<void>;
  remove(uri: string): Promise<void>;
}

export interface VoicePlaybackProgress {
  positionMs: number;
  durationMs: number;
}

export interface VoicePlayerPort {
  play(
    uri: string,
    onProgress: (progress: VoicePlaybackProgress) => void,
    onComplete: () => void,
  ): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export interface VoiceMetadata {
  duration: number;
  waveform: number[];
}
```

在 `src/index.ts` 导出三个新 voice 文件；现有 `PickedMedia` 仍从 `ports/index.ts` 引用，不把 Nitro Sound 类型引入公共契约。

- [ ] **Step 2: 实现真实振幅归一化与 48 点重采样**

创建 `voiceWaveform.ts`，定义以下确定规则：

```ts
import type { VoiceMetadata } from './voiceTypes';

export const VOICE_WAVEFORM_POINTS = 48;
export const VOICE_MIN_DB = -60;
export const VOICE_MAX_DB = 0;

export function normalizeMeteringDb(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const db = Math.max(VOICE_MIN_DB, Math.min(VOICE_MAX_DB, value));
  return Math.pow(10, db / 20);
}

export function buildVoiceWaveform(samples: readonly number[]): number[] {
  const valid = samples.filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (valid.length === 0) throw new Error('VOICE_METERING_MISSING');
  const peaks = Array.from({ length: VOICE_WAVEFORM_POINTS }, (_, index) => {
    const from = Math.floor(index * valid.length / VOICE_WAVEFORM_POINTS);
    const to = Math.max(from + 1, Math.ceil((index + 1) * valid.length / VOICE_WAVEFORM_POINTS));
    let peak = valid[Math.min(from, valid.length - 1)] ?? 0;
    for (let cursor = from; cursor < Math.min(to, valid.length); cursor += 1) {
      peak = Math.max(peak, valid[cursor]);
    }
    return peak;
  });
  return peaks.map((peak, index) => {
    const previous = peaks[Math.max(0, index - 1)];
    const next = peaks[Math.min(peaks.length - 1, index + 1)];
    return Math.round(Math.max(0, Math.min(1, previous * 0.2 + peak * 0.6 + next * 0.2)) * 100);
  });
}

export function parseVoiceMetadata(body: Record<string, unknown> | null): VoiceMetadata | null {
  const duration = body?.duration;
  const waveform = body?.waveform;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > 60) {
    return null;
  }
  if (!Array.isArray(waveform) || waveform.length !== VOICE_WAVEFORM_POINTS) return null;
  if (!waveform.every((value) => typeof value === 'number'
    && Number.isInteger(value) && value >= 0 && value <= 100)) return null;
  return { duration, waveform: [...waveform] };
}

export const FALLBACK_VOICE_WAVEFORM = Array.from(
  { length: VOICE_WAVEFORM_POINTS },
  (_, index) => 28 + (index % 4) * 8,
);
```

- [ ] **Step 3: 实现一次性结束的录音状态机**

创建 `voiceRecordingController.ts`：

```ts
import type { RecordedVoice, VoiceRecorderPort, VoiceRecordingProgress } from './voiceTypes';

export type VoiceRecordingState = 'idle' | 'starting' | 'recording' | 'finishing';

export class VoiceRecordingController {
  private state: VoiceRecordingState = 'idle';
  private operation = 0;

  constructor(private readonly recorder: VoiceRecorderPort) {}

  getState(): VoiceRecordingState {
    return this.state;
  }

  async start(onProgress: (progress: VoiceRecordingProgress) => void): Promise<void> {
    if (this.state !== 'idle') throw new Error('VOICE_RECORDING_BUSY');
    const operation = ++this.operation;
    this.state = 'starting';
    try {
      await this.recorder.start((progress) => {
        if (this.operation === operation && this.state === 'recording') onProgress(progress);
      });
      if (this.operation !== operation) {
        await this.recorder.cancel().catch(() => {});
        return;
      }
      this.state = 'recording';
    } catch (cause) {
      if (this.operation === operation) this.state = 'idle';
      throw cause;
    }
  }

  async finish(): Promise<RecordedVoice | null> {
    if (this.state !== 'recording') return null;
    const operation = this.operation;
    this.state = 'finishing';
    try {
      return await this.recorder.stop();
    } finally {
      if (this.operation === operation) this.state = 'idle';
    }
  }

  async cancel(): Promise<void> {
    if (this.state === 'idle') return;
    this.operation += 1;
    this.state = 'idle';
    await this.recorder.cancel().catch(() => {});
  }
}
```

- [ ] **Step 4: 执行 Core 类型检查和差异检查**

```bash
npx tsc -p packages/im-sdk-core --noEmit
git diff --check
git diff -- packages/im-sdk-core/src/voice packages/im-sdk-core/src/index.ts
```

预期：类型检查退出码 0；Core 中没有 React Native 或 Nitro Sound import。

- [ ] **Step 5: 本地提交语音 Core 契约**

```bash
git add im-client/packages/im-sdk-core/src/voice im-client/packages/im-sdk-core/src/index.ts
git commit -m "功能(IM SDK)：定义语音录播与波形契约"
```

---

### Task 3: 扩展 AUDIO 上传任务并持久化本地已听状态

**Files:**
- Create: `im-client/packages/im-sdk-core/src/voice/voiceHeardStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/store/migrations.ts`
- Modify: `im-client/packages/im-sdk-core/src/store/messageStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/media/mediaTypes.ts`
- Modify: `im-client/packages/im-sdk-core/src/media/mediaUploadStore.ts`
- Modify: `im-client/packages/im-sdk-core/src/media/mediaUploadService.ts`
- Modify: `im-client/packages/im-sdk-core/src/chat/chatService.ts`
- Modify: `im-client/packages/im-sdk-core/src/index.ts`

**Interfaces:**
- Consumes: `VoiceMetadata`、`parseVoiceMetadata`、现有 `MediaUploadService.enqueue`。
- Produces: `MediaMessageType = 'IMAGE' | 'AUDIO' | 'FILE'`；`enqueue(cid, type, source, metadata?)`；`VoiceHeardStore.isHeard/markHeard`。

- [ ] **Step 1: 增加不可变迁移项**

在 `MIGRATIONS` 尾部追加，禁止修改既有迁移索引：

```ts
`ALTER TABLE media_upload_task ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`,
`CREATE TABLE voice_heard (
   account_id INTEGER NOT NULL,
   cid TEXT NOT NULL,
   seq INTEGER NOT NULL,
   heard_at INTEGER NOT NULL,
   PRIMARY KEY (account_id, cid, seq)
 )`,
`CREATE INDEX idx_voice_heard_account_cid ON voice_heard (account_id, cid)`,
```

在 `MessageStore.activateAccount` 的账号切换清理中加入：

```ts
await tx.exec(`DELETE FROM voice_heard`);
```

- [ ] **Step 2: 实现已听状态 Store**

创建 `voiceHeardStore.ts`：

```ts
import type { Database } from '../ports/index';

export class VoiceHeardStore {
  constructor(private readonly db: Database) {}

  async isHeard(accountId: number, cid: string, seq: number): Promise<boolean> {
    const rows = await this.db.query<{ heard_at: number }>(
      `SELECT heard_at FROM voice_heard WHERE account_id = ? AND cid = ? AND seq = ?`,
      [accountId, cid, seq],
    );
    return rows.length > 0;
  }

  async markHeard(accountId: number, cid: string, seq: number): Promise<void> {
    await this.db.exec(
      `INSERT INTO voice_heard (account_id, cid, seq, heard_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, cid, seq) DO UPDATE SET heard_at = excluded.heard_at`,
      [accountId, cid, seq, Date.now()],
    );
  }

  async listHeardSeqs(accountId: number, cid: string): Promise<Set<number>> {
    const rows = await this.db.query<{ seq: number }>(
      `SELECT seq FROM voice_heard WHERE account_id = ? AND cid = ?`,
      [accountId, cid],
    );
    return new Set(rows.map((row) => row.seq));
  }
}
```

- [ ] **Step 3: 给媒体任务增加 metadata**

在 `MediaUploadTask` 增加：

```ts
metadata: Record<string, unknown>;
```

把类型扩展为：

```ts
export type MediaMessageType = 'IMAGE' | 'AUDIO' | 'FILE';
```

`mediaTaskToChatMessage` 的 `body` 合并 `...task.metadata`。`MediaUploadStore` 的 `COLUMNS` 加 `metadata_json`，`toTask` 对 JSON 异常降级 `{}`，insert 使用 `JSON.stringify(task.metadata)`。

- [ ] **Step 4: 扩展媒体入队和消息体构造**

在 `MediaUploadService` 增加：

```ts
const AUDIO_MAX_SIZE = 20 * 1024 * 1024;
```

把 `enqueue` 签名改为：

```ts
async enqueue(
  cid: string,
  type: MediaMessageType,
  source: PickedMedia,
  metadata: Record<string, unknown> = {},
): Promise<string>
```

入队前构造白名单元数据，AUDIO 只保留解析后的 `duration/waveform`，IMAGE/FILE 固定为空对象：

```ts
const voiceMetadata = type === 'AUDIO' ? parseVoiceMetadata(metadata) : null;
if (type === 'AUDIO' && voiceMetadata == null) {
  throw new Error('VOICE_METADATA_INVALID');
}
const safeMetadata: Record<string, unknown> = voiceMetadata == null
  ? {}
  : { duration: voiceMetadata.duration, waveform: [...voiceMetadata.waveform] };
```

任务记录只写入白名单副本：

```ts
metadata: safeMetadata,
```

`mediaBody(task)` 先展开白名单元数据，再写权威对象字段，确保对象引用永远不能被覆盖：

```ts
return {
  ...task.metadata,
  objectKey: task.objectKey,
  filename: task.filename,
  mime: task.mime,
  size: task.size,
  ...(task.type === 'IMAGE' ? { width: task.width, height: task.height } : {}),
};
```

`task.metadata` 来源只能是上述白名单；不得允许调用方 metadata 覆盖对象引用，也不得保存 `localUri/progress/uploadTaskId`。

大小校验改成明确分支：

```ts
const maxSize = type === 'IMAGE'
  ? IMAGE_MAX_SIZE
  : type === 'AUDIO'
    ? AUDIO_MAX_SIZE
    : FILE_MAX_SIZE;
```

- [ ] **Step 5: 允许 ChatService 发送 AUDIO**

把 `sendMedia` 的 type 改为 `MediaMessageType` import，不再写死 `'IMAGE' | 'FILE'`。保持重发、ACK/PUSH 定时器和清理行为不变。

- [ ] **Step 6: 导出并检查 Core**

在 `src/index.ts` 导出 `voiceHeardStore`，执行：

```bash
npx tsc -p packages/im-sdk-core --noEmit
git diff --check
git diff -- packages/im-sdk-core/src/store packages/im-sdk-core/src/media packages/im-sdk-core/src/chat/chatService.ts packages/im-sdk-core/src/voice/voiceHeardStore.ts
```

预期：类型检查退出码 0；旧 IMAGE/FILE 任务读取 `metadata_json='{}'`；AUDIO 恢复任务仍带时长与波形。

- [ ] **Step 7: 本地提交 AUDIO 持久化链路**

```bash
git add im-client/packages/im-sdk-core/src/store/migrations.ts im-client/packages/im-sdk-core/src/store/messageStore.ts im-client/packages/im-sdk-core/src/media im-client/packages/im-sdk-core/src/chat/chatService.ts im-client/packages/im-sdk-core/src/voice/voiceHeardStore.ts im-client/packages/im-sdk-core/src/index.ts
git commit -m "功能(IM SDK)：持久化语音上传与已听状态"
```

---

### Task 4: 校验后端 AUDIO 元数据并生成中文摘要

**Files:**
- Modify: `backend/src/main/java/com/rbac/im/service/MediaService.java`
- Modify: `backend/src/main/java/com/rbac/im/service/MessageAppender.java`

**Interfaces:**
- Consumes: AUDIO body 的 `duration` 与 `waveform`。
- Produces: 非法元数据抛 `MediaValidationException("INVALID_AUDIO_METADATA")`；会话摘要显示 `[语音]`。

- [ ] **Step 1: 在媒体发送校验中检查语音展示元数据**

在 `validateForSend` 完成对象 HEAD 校验后调用：

```java
if ("AUDIO".equals(type)) {
    validateAudioMetadata(body);
}
```

新增私有方法：

```java
private void validateAudioMetadata(Map<String, Object> body) {
    Object durationValue = body.get("duration");
    if (!(durationValue instanceof Number duration)
            || duration.doubleValue() != Math.rint(duration.doubleValue())
            || duration.intValue() < 1
            || duration.intValue() > 60) {
        throw new MediaValidationException("INVALID_AUDIO_METADATA");
    }
    Object waveformValue = body.get("waveform");
    if (!(waveformValue instanceof List<?> waveform) || waveform.size() != 48) {
        throw new MediaValidationException("INVALID_AUDIO_METADATA");
    }
    for (Object value : waveform) {
        if (!(value instanceof Number sample)
                || sample.doubleValue() != Math.rint(sample.doubleValue())
                || sample.intValue() < 0
                || sample.intValue() > 100) {
            throw new MediaValidationException("INVALID_AUDIO_METADATA");
        }
    }
}
```

复用 `java.util.List` 现有 import，不接受字符串数字、浮点波形、超长数组或超范围值。

- [ ] **Step 2: 本地化 AUDIO 会话摘要**

在 `MessageAppender.preview` 的 SYSTEM/RECALL 分支附近加入：

```java
if ("AUDIO".equals(type)) {
    return "[语音]";
}
```

- [ ] **Step 3: 跳过测试构建并审查范围**

```bash
mvn -f backend/pom.xml -Dmaven.test.skip=true package
git diff --check
git diff -- backend/src/main/java/com/rbac/im/service/MediaService.java backend/src/main/java/com/rbac/im/service/MessageAppender.java
```

预期：Maven 构建成功；差异不包含 `ImConversationMember.java` 与 `ConversationService.java`。

- [ ] **Step 4: 只提交本任务两个后端文件**

```bash
git add backend/src/main/java/com/rbac/im/service/MediaService.java backend/src/main/java/com/rbac/im/service/MessageAppender.java
git commit -m "功能(IM后端)：校验语音消息展示元数据"
```

---

### Task 5: 实现 React Native 权限、录音和播放适配器

**Files:**
- Create: `im-client/packages/im-sdk-rn/src/adapters/rnVoicePermission.ts`
- Create: `im-client/packages/im-sdk-rn/src/adapters/rnVoiceAudioSession.ts`
- Create: `im-client/packages/im-sdk-rn/src/adapters/rnVoiceRecorder.ts`
- Create: `im-client/packages/im-sdk-rn/src/adapters/rnVoicePlayer.ts`
- Modify: `im-client/packages/im-sdk-rn/src/createSdk.ts`
- Modify: `im-client/packages/im-sdk-rn/src/index.ts`

**Interfaces:**
- Consumes: Task 2 的四个端口；Nitro Sound `createSound/startRecorder/addRecordBackListener/startPlayer/addPlayBackListener/addPlaybackEndListener`；Nitro Audio Manager `configureAudio/activate/deactivate/addListener`。
- Produces: `sdk.voice.permission`、`sdk.voice.audioSession`、`sdk.voice.recording`、`sdk.voice.player`、`sdk.voice.heard`。

- [ ] **Step 1: 实现双平台麦克风权限适配器**

创建 `rnVoicePermission.ts`：

```ts
import { Platform } from 'react-native';
import {
  check,
  openSettings,
  PERMISSIONS,
  request,
  RESULTS,
  type PermissionStatus,
} from 'react-native-permissions';
import type { VoicePermissionPort, VoicePermissionStatus } from '@im/sdk-core';

const microphonePermission = Platform.OS === 'ios'
  ? PERMISSIONS.IOS.MICROPHONE
  : PERMISSIONS.ANDROID.RECORD_AUDIO;

function normalize(status: PermissionStatus): VoicePermissionStatus {
  if (status === RESULTS.GRANTED || status === RESULTS.LIMITED) return 'granted';
  if (status === RESULTS.BLOCKED) return 'blocked';
  if (status === RESULTS.UNAVAILABLE) return 'unavailable';
  return 'denied';
}

export class RnVoicePermission implements VoicePermissionPort {
  async check(): Promise<VoicePermissionStatus> {
    return normalize(await check(microphonePermission));
  }

  async request(): Promise<VoicePermissionStatus> {
    return normalize(await request(microphonePermission));
  }

  openSettings(): Promise<void> {
    return openSettings('application');
  }
}
```

- [ ] **Step 2: 实现音频焦点、系统中断和路由变化适配器**

创建 `rnVoiceAudioSession.ts`。初始化时配置 iOS PlayAndRecord/默认扬声器/蓝牙和 Android 临时独占语音焦点：

```ts
import type { VoiceAudioSessionPort } from '@im/sdk-core';
import {
  activate,
  addListener,
  AudioContentTypes,
  AudioFocusGainTypes,
  AudioSessionCategory,
  AudioSessionCategoryOptions,
  AudioSessionMode,
  AudioUsages,
  configureAudio,
  deactivate,
} from 'react-native-nitro-audio-manager';

export class RnVoiceAudioSession implements VoiceAudioSessionPort {
  private readonly handlers = new Set<() => void>();
  private readonly subscriptions: Array<() => void>;
  private configured = false;

  constructor() {
    this.subscriptions = [
      addListener('audioInterruption', (event) => {
        if (event.type === 'began') this.notifyPause();
      }),
      addListener('routeChange', (event) => {
        if (event.reason === 'OldDeviceUnavailable') this.notifyPause();
      }),
    ];
  }

  async activate(): Promise<void> {
    if (!this.configured) {
      configureAudio({
        ios: {
          category: AudioSessionCategory.PlayAndRecord,
          mode: AudioSessionMode.Default,
          categoryOptions: [
            AudioSessionCategoryOptions.AllowBluetoothHFP,
            AudioSessionCategoryOptions.AllowBluetoothA2DP,
            AudioSessionCategoryOptions.DefaultToSpeaker,
          ],
          prefersInterruptionOnRouteDisconnect: true,
          prefersEchoCancelledInput: false,
        },
        android: {
          focusGain: AudioFocusGainTypes.GainTransientAllowPause,
          usage: AudioUsages.Media,
          contentType: AudioContentTypes.Speech,
          willPauseWhenDucked: true,
          acceptsDelayedFocusGain: false,
        },
      });
      this.configured = true;
      return;
    }
    return activate();
  }

  deactivate(): Promise<void> {
    return deactivate({ restorePreviousSessionOnDeactivation: true });
  }

  onPauseRequested(handler: () => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async dispose(): Promise<void> {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.handlers.clear();
    await this.deactivate().catch(() => {});
  }

  private notifyPause(): void {
    [...this.handlers].forEach((handler) => handler());
  }
}
```

系统中断 ended 事件不得自动恢复；只有用户重新点击或按住才重新 activate。

- [ ] **Step 3: 实现 Nitro Sound 录音器**

创建 `rnVoiceRecorder.ts`。使用独立 `createSound()` 实例，设置 0.1 秒订阅，配置 MPEG_4/AAC/MIC 与公共参数。音频 session 由上层在 start 前 activate、停止后 deactivate：

```ts
const AUDIO_SET: AudioSet = {
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  AVEncodingOptionIOS: 'aac',
  AVFormatIDKeyIOS: 'aac',
  AVNumberOfChannelsKeyIOS: 1,
  AVSampleRateKeyIOS: 16000,
  AudioSamplingRate: 16000,
  AudioEncodingBitRate: 32000,
  AudioChannels: 1,
};
```

类必须保存 `path`、最后 `durationMs` 与当前 operation。`start` 先装 listener，再执行 `startRecorder(undefined, AUDIO_SET, true)`；listener 传出：

```ts
onProgress({
  durationMs: Math.max(0, event.currentPosition),
  meteringDb: typeof event.currentMetering === 'number' ? event.currentMetering : null,
});
```

`stop` 调 `stopRecorder`、移除 listener、用 `FileSystem.stat(path)` 读取大小并返回：

```ts
{
  uri: path,
  filename: `voice-${Date.now()}.m4a`,
  mime: 'audio/mp4',
  size: stat.size,
  durationMs,
}
```

`cancel` 即使 start 尚未完成也递增 operation；录音真正启动后发现 token 过期必须立即 stop 并删除返回路径。`remove` 使用 `FileSystem.exists/unlink`，所有 listener 在成功、失败、取消路径都移除。

- [ ] **Step 4: 实现 Nitro Sound 单实例播放器端口**

创建 `rnVoicePlayer.ts`，使用另一个 `createSound()` 实例。每次 `play` 先 `stop` 清理旧 listener，再安装进度与完成 listener：

```ts
this.sound.addPlayBackListener((event) => {
  onProgress({ positionMs: event.currentPosition, durationMs: event.duration });
});
this.sound.addPlaybackEndListener(() => {
  this.clearListeners();
  onComplete();
});
await this.sound.startPlayer(uri);
```

`pause/resume/stop` 分别调用 Nitro 对应方法；`stop` 和 `dispose` 必须移除两个 listener。用 operation token 忽略已经停止的旧完成回调。

- [ ] **Step 5: 在 createSdk 装配语音能力**

创建共享实例：

```ts
const voicePermission = new RnVoicePermission();
const voiceAudioSession = new RnVoiceAudioSession();
const voiceRecorder = new RnVoiceRecorder();
const voiceRecording = new VoiceRecordingController(voiceRecorder);
const voicePlayer = new RnVoicePlayer();
const voiceHeard = new VoiceHeardStore(db);
```

SDK 返回值增加：

```ts
voice: {
  permission: voicePermission,
  audioSession: voiceAudioSession,
  recorder: voiceRecorder,
  recording: voiceRecording,
  player: voicePlayer,
  heard: voiceHeard,
},
```

在 `src/index.ts` 导出四个适配器。

- [ ] **Step 6: 类型检查并确认第三方类型没有泄漏到 Core**

```bash
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
git diff --check
rg -n "react-native-nitro-sound|react-native-permissions" packages/im-sdk-core
```

预期：两个类型检查退出码 0；最后一条搜索无结果。

- [ ] **Step 7: 本地提交 RN 音频适配器**

```bash
git add im-client/packages/im-sdk-rn/src/adapters/rnVoicePermission.ts im-client/packages/im-sdk-rn/src/adapters/rnVoiceAudioSession.ts im-client/packages/im-sdk-rn/src/adapters/rnVoiceRecorder.ts im-client/packages/im-sdk-rn/src/adapters/rnVoicePlayer.ts im-client/packages/im-sdk-rn/src/createSdk.ts im-client/packages/im-sdk-rn/src/index.ts
git commit -m "功能(IM客户端)：接入原生语音录制与播放"
```

---

### Task 6: 实现录音会话 Hook、按住手势和实时浮层

**Files:**
- Create: `im-client/packages/app-mobile/src/voice/useVoiceRecording.ts`
- Create: `im-client/packages/app-mobile/src/components/VoiceComposerControl.tsx`
- Create: `im-client/packages/app-mobile/src/components/VoiceRecordingOverlay.tsx`

**Interfaces:**
- Consumes: `sdk.voice.permission`、`sdk.voice.audioSession`、`sdk.voice.recording`、`sdk.voice.recorder.remove`、`sdk.media.enqueue`、`buildVoiceWaveform`。
- Produces: `useVoiceRecording({ cid, onEnqueued, onError })`；`VoiceComposerControl` 的开始/取消区/结束事件；只读录音 UI 状态。

- [ ] **Step 1: 实现页面录音会话 Hook**

`useVoiceRecording.ts` 对外返回：

```ts
export interface VoiceRecordingUiState {
  active: boolean;
  starting: boolean;
  cancelling: boolean;
  durationMs: number;
  liveLevels: number[];
}

export interface UseVoiceRecordingResult {
  state: VoiceRecordingUiState;
  ensurePermission(): Promise<'granted' | 'blocked' | 'denied'>;
  start(): Promise<void>;
  setCancelling(value: boolean): void;
  finish(cancelled: boolean): Promise<void>;
  cancel(): Promise<void>;
}
```

`start` 清空样本，先停止全局播放协调器，调用 `sdk.voice.audioSession.activate()`，再调用 recording controller。进度回调把 `normalizeMeteringDb` 的有效值追加到 ref，并只保留浮层最近 24 个值；`durationMs >= 60000` 时用一次性 ref 调 `finish(false)`。

`finish` 必须满足：

```ts
const recorded = await sdk.voice.recording.finish();
try {
  if (recorded == null) return;
  if (cancelled) return;
  if (recorded.durationMs < 1000) throw new Error('VOICE_TOO_SHORT');
  const waveform = buildVoiceWaveform(samplesRef.current);
  await sdk.media.enqueue(cid, 'AUDIO', recorded, {
    duration: Math.min(60, Math.ceil(recorded.durationMs / 1000)),
    waveform,
  });
  onEnqueued();
} finally {
  if (recorded != null) await sdk.voice.recorder.remove(recorded.uri).catch(() => {});
  await sdk.voice.audioSession.deactivate().catch(() => {});
}
```

当 `cancelled` 为 true 时也必须在 finally 删除停止后生成的临时文件。启动或停止抛错、显式 `cancel()` 和 Hook 卸载路径也必须 deactivate。Hook 订阅 `audioSession.onPauseRequested`，收到系统中断或旧输出设备断开时调用 `cancel()`，且中断结束不自动恢复。所有异步结果用 mounted/operation ref 防止写回旧页面。

- [ ] **Step 2: 实现键盘/语音切换和 PanResponder**

`VoiceComposerControl.tsx` 接收：

```ts
interface Props {
  voiceMode: boolean;
  disabled: boolean;
  active: boolean;
  onToggleMode(): void;
  onStart(): Promise<void>;
  onCancellingChange(value: boolean): void;
  onFinish(cancelled: boolean): Promise<void>;
}
```

用 `PanResponder.create`：grant 调 `onStart`；move 使用 `gesture.dy <= -80` 更新取消区；release/terminate 读取 ref 并调用 `onFinish(cancelled)`。语音模式显示占满输入区的圆角按钮“按住说话”，非语音模式只渲染切换图标并由 ChatScreen 保留原 TextInput。

切换到语音模式前由 ChatScreen 调 `ensurePermission`。`blocked` 弹出含“前往设置”的 Alert；`denied` 显示横幅；只有 granted 才切换，避免权限弹窗出现在按住手势中。

- [ ] **Step 3: 实现不抢触摸的录音浮层**

`VoiceRecordingOverlay.tsx` 根节点使用：

```tsx
<View pointerEvents="none" style={StyleSheet.absoluteFill}>
```

active 时居中显示深色卡片、`Math.min(60, Math.ceil(durationMs / 1000))s`、最近 24 个真实振幅柱。cancelling 时卡片改为 `COLORS.danger`，文案“松开取消”；普通状态文案“上滑取消，松开发送”。starting 时显示 ActivityIndicator 和“正在启动录音”。

- [ ] **Step 4: 类型检查与静态手势审查**

```bash
npx tsc -p packages/app-mobile --noEmit
git diff --check
git diff -- packages/app-mobile/src/voice/useVoiceRecording.ts packages/app-mobile/src/components/VoiceComposerControl.tsx packages/app-mobile/src/components/VoiceRecordingOverlay.tsx
```

人工检查：60 秒路径和 release 共用同一个一次性 finish gate；cancelled/过短/失败都删除原生临时文件；浮层 `pointerEvents="none"` 不夺走 PanResponder。

- [ ] **Step 5: 本地提交录音交互模块**

```bash
git add im-client/packages/app-mobile/src/voice/useVoiceRecording.ts im-client/packages/app-mobile/src/components/VoiceComposerControl.tsx im-client/packages/app-mobile/src/components/VoiceRecordingOverlay.tsx
git commit -m "功能(IM客户端)：实现按住录音与振幅浮层"
```

---

### Task 7: 实现全局播放协调器与语音气泡

**Files:**
- Create: `im-client/packages/app-mobile/src/voice/voicePlaybackCoordinator.ts`
- Create: `im-client/packages/app-mobile/src/components/VoiceMessageContent.tsx`

**Interfaces:**
- Consumes: `sdk.voice.audioSession`、`sdk.voice.player`、`sdk.voice.heard`、`sdk.media.downloadToCache`、`parseVoiceMetadata`。
- Produces: 全局 `voicePlaybackCoordinator`、`subscribe/getSnapshot/toggle/stop/pause`；`VoiceMessageContent`。

- [ ] **Step 1: 实现可订阅的单实例播放协调器**

定义状态：

```ts
export interface VoicePlaybackSnapshot {
  key: string | null;
  status: 'idle' | 'downloading' | 'playing' | 'paused';
  progress: number;
  error: string | null;
}
```

消息 key 使用 `seq != null ? `${cid}:${seq}` : `${cid}:local:${clientMsgId}``。`toggle` 规则：

1. 相同 key + playing -> `player.pause()` 并置 paused。
2. 相同 key + paused -> 先 `audioSession.activate()`，再 `player.resume()` 并置 playing。
3. 不同 key -> `stop()`，解析 `localUri`；没有本地路径则验证 objectKey/filename 并调用 `sdk.media.downloadToCache`。
4. 下载时置 downloading；完成后再次验证 operation token，先 `audioSession.activate()`，再调用 `player.play`。
5. progress 回调夹取 `positionMs / durationMs` 到 0～1。
6. complete 回调归零并 deactivate；若 `seq/senderId/accountId` 表明是接收消息，则 `markHeard(accountId,cid,seq)`，完成后调用本次 toggle 传入的 `onHeard()` 刷新未听点。

`toggle` 接收 `{ message, accountId, mine, onHeard }`；接收消息且 `message.seq != null` 时才结算已听。`stop()` 递增 operation，调用 player.stop 和 audioSession.deactivate，状态回 idle。`pause()` 只在 playing 时生效，暂停后 deactivate。协调器在构造时订阅 `audioSession.onPauseRequested` 并调用 `pause()`，不在 interruption ended 后恢复。使用 `Set<() => void>` 管理 UI 订阅者并导出单例。

- [ ] **Step 2: 实现语音波形气泡**

`VoiceMessageContent` props：

```ts
interface Props {
  message: ChatMessage;
  accountId: number;
  mine: boolean;
  heard: boolean;
  onHeard(): void;
  onError(message: string): void;
}
```

用 `useSyncExternalStore` 订阅协调器；元数据采用：

```ts
const metadata = parseVoiceMetadata(message.body);
const duration = metadata?.duration ?? 1;
const waveform = metadata?.waveform ?? FALLBACK_VOICE_WAVEFORM;
```

气泡宽度为 `Math.min(250, 116 + duration * 2)`；48 个柱高按 `6 + value / 100 * 22`；active key 下 `index / 48 < progress` 的柱使用 `COLORS.primary`，其余使用 `COLORS.textSecondary`。左侧显示 play/pause/loading 图标，右侧显示 `${duration}''`；非己方且未听时在右上显示 `COLORS.danger` 圆点。

点击调用 coordinator.toggle；完成后的 coordinator 通知触发 `onHeard` 重新加载该会话已听集合。上传中的本地气泡禁用播放，但仍显示波形、时长与现有外层上传进度/取消按钮。

- [ ] **Step 3: 类型检查和生命周期检查**

```bash
npx tsc -p packages/app-mobile --noEmit
git diff --check
git diff -- packages/app-mobile/src/voice/voicePlaybackCoordinator.ts packages/app-mobile/src/components/VoiceMessageContent.tsx
```

人工检查：切换 key 必先 stop；过期下载/播放回调有 operation token；只有 playback end 标记已听；暂停、错误或切换不标记。

- [ ] **Step 4: 本地提交播放模块**

```bash
git add im-client/packages/app-mobile/src/voice/voicePlaybackCoordinator.ts im-client/packages/app-mobile/src/components/VoiceMessageContent.tsx
git commit -m "功能(IM客户端)：实现语音波形播放与未听状态"
```

---

### Task 8: 将录音与播放接入聊天页和账号生命周期

**Files:**
- Modify: `im-client/packages/app-mobile/src/screens/ChatScreen.tsx`
- Modify: `im-client/packages/app-mobile/src/store.ts`
- Modify: `im-client/packages/app-mobile/src/ui/theme.ts`

**Interfaces:**
- Consumes: Tasks 6–7 的 Hook、组件和协调器。
- Produces: 单聊/群聊完整录音发送与播放 UI；退出/后台/撤回安全清理。

- [ ] **Step 1: 在 ChatScreen 装配录音状态**

增加 `voiceMode` 与 `heardVoiceSeqs` 状态，并创建 Hook：

```ts
const voiceRecording = useVoiceRecording({
  cid,
  onEnqueued: safeReload,
  onError: (reason) => showBanner(voiceErrorText(reason)),
});
```

加载消息时并行读取：

```ts
sdk.voice.heard.listHeardSeqs(myId, cid)
```

`myId == null` 时使用空 Set。收到 message 事件、播放完成通知和页面重新聚焦后刷新；写入新 Set，禁止原地 mutate。

- [ ] **Step 2: 增加稳定中文错误映射**

新增：

```ts
function voiceErrorText(reason?: string): string {
  switch (reason) {
    case 'VOICE_PERMISSION_DENIED': return '请允许应用使用麦克风后再录音';
    case 'VOICE_PERMISSION_BLOCKED': return '麦克风权限已关闭，请前往系统设置开启';
    case 'VOICE_PERMISSION_UNAVAILABLE': return '当前设备无法使用麦克风';
    case 'VOICE_TOO_SHORT': return '说话时间太短';
    case 'VOICE_METERING_MISSING': return '没有检测到有效声音，请重试';
    case 'VOICE_RECORDING_BUSY': return '正在处理上一段录音，请稍候';
    case 'VOICE_RECORDING_FAILED': return '录音失败，请稍后重试';
    case 'VOICE_METADATA_INVALID': return '语音信息不完整，无法发送';
    case 'VOICE_PLAYBACK_FAILED': return '语音播放失败，请重试';
    default: return mediaErrorText(reason);
  }
}
```

权限 blocked 时使用 React Native `Alert.alert`，确认按钮调用 `sdk.voice.permission.openSettings()`。

- [ ] **Step 3: 替换输入区为文字/语音双模式**

保留附件按钮。附件按钮之后渲染 `VoiceComposerControl` 的模式切换入口；`voiceMode=false` 时保持现有 TextInput + send，`voiceMode=true` 时用“按住说话”控件替代二者。切换不修改 `draft`，因此文字草稿自然保留。

录音 active/starting 时禁用附件入口、模式切换、文字发送和二次录音。页面根节点末尾渲染：

```tsx
<VoiceRecordingOverlay {...voiceRecording.state} />
```

- [ ] **Step 4: 渲染 AUDIO 消息并保持撤回长按**

在气泡内容分支中优先处理 AUDIO：

```tsx
{item.type === 'AUDIO' && myId != null ? (
  <VoiceMessageContent
    message={item}
    accountId={myId}
    mine={mine}
    heard={item.seq != null && heardVoiceSeqs.has(item.seq)}
    onHeard={reloadHeardVoiceSeqs}
    onError={showBanner}
  />
) : item.type === 'IMAGE' || item.type === 'FILE' ? (
  <MediaMessageContent />
) : (
  <MentionText body={item.body} />
)}
```

实际实现保留 `MediaMessageContent` 的现有完整 props。AUDIO 外层 Pressable 继续承担 350ms 长按撤回；语音内部点击播放不得触发长按动作。

- [ ] **Step 5: 处理页面、后台、撤回和账号退出生命周期**

ChatScreen blur 时调：

```ts
void voiceRecording.cancel();
void voicePlaybackCoordinator.pause();
```

ChatScreen unmount 时调用 `voiceRecording.cancel()` 与 `voicePlaybackCoordinator.stop()`。订阅 `AppState`：进入非 active 状态时取消录音并暂停播放。渲染数据更新时，如果 coordinator 当前 key 对应的消息已经 `recalled=true`，调用 `stop()`。

在 `useAppStore.logout` 最前面加入：

```ts
await sdk.voice.recording.cancel().catch(() => {});
await sdk.voice.player.stop().catch(() => {});
```

`store.ts` 不导入 app 层播放协调器，避免 `store -> coordinator -> sdk -> store` 循环；ChatScreen 卸载负责把协调器快照归零，store 只负责兜底停止原生端口。

- [ ] **Step 6: 补充语音视觉 token**

仅在 `ui/theme.ts` 增加语义色，禁止修改既有消息气泡颜色：

```ts
voiceWavePlayed: '#2F6BEE',
voiceWaveIdle: '#94A3B8',
voiceUnread: '#DC2F2F',
recordingOverlay: 'rgba(15, 23, 42, 0.88)',
```

- [ ] **Step 7: 类型检查与聊天页差异审查**

```bash
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
git diff --check
git diff -- packages/app-mobile/src/screens/ChatScreen.tsx packages/app-mobile/src/store.ts packages/app-mobile/src/ui/theme.ts
```

预期：类型检查退出码 0；文字草稿逻辑、附件选择、@ 提及、撤回和图片/文件 props 未被破坏。

- [ ] **Step 8: 本地提交聊天页集成**

```bash
git add im-client/packages/app-mobile/src/screens/ChatScreen.tsx im-client/packages/app-mobile/src/store.ts im-client/packages/app-mobile/src/ui/theme.ts
git commit -m "功能(IM客户端)：接入语音录制发送与播放交互"
```

---

### Task 9: 完成双平台静态验证与交接文档

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md`

**Interfaces:**
- Consumes: Tasks 1–8 的完整功能。
- Produces: 可由用户执行的 Android/iOS 手测清单和更新后的下一开发目标。

- [ ] **Step 1: 安装 iOS Pods 并验证原生依赖解析**

在具备 iOS 工具链的机器执行：

```bash
cd im-client/packages/app-mobile/ios
bundle exec pod install
```

预期：NitroSound、NitroModules、RNPermissions 与 Permission-Microphone 成功解析。若本机缺少可用 CocoaPods 环境，只记录未执行原因，不修改锁文件规避错误。

- [ ] **Step 2: 执行完整静态与跳过测试构建检查**

```bash
cd im-client
npx tsc -p packages/im-sdk-core --noEmit
npx tsc -p packages/app-mobile --noEmit
cd ..
mvn -f backend/pom.xml -Dmaven.test.skip=true package
mvn -f im-gateway/pom.xml -Dmaven.test.skip=true package
git diff --check
```

再执行安全检查：

```bash
rg -n "console\.log|api_key|secret|sk-" im-client/packages/im-sdk-core/src im-client/packages/im-sdk-rn/src im-client/packages/app-mobile/src
cd im-client
npm audit --omit=dev --workspace packages/app-mobile
```

允许保留交接文档已经记录的 React Native CLI 间接依赖 moderate 告警；禁止使用 `npm audit fix --force` 做范围外升级。

- [ ] **Step 3: 审查全部功能差异与用户改动隔离**

```bash
git status --short
git diff --stat 69e8f2b..HEAD
git diff --check
git log --oneline -10
```

逐文件确认：没有本地 URI 上行、AUDIO metadata 恢复完整、播放器 listener 无泄漏、账号切换隔离、后端注释改动未进入任何提交。

- [ ] **Step 4: 更新交接文档**

把“语音消息”标为代码完成、等待用户手测；记录依赖版本、录音格式、48 点波形、SQLite 已听表、20 MiB 上限、当前验证命令与结果。下一项开发目标改为链接卡片。

加入用户手测清单：

1. Android/iOS 首次授权、拒绝、永久拒绝和从设置恢复。
2. 按住录音、上滑取消、移回恢复、松开发送、低于 1 秒提示。
3. 60 秒自动发送一次，之后松手不重复。
4. 安静/正常/大声录音的实时与消息波形差异。
5. 单聊、群聊、实时接收和离线恢复。
6. 上传进度、断网重试、杀应用后恢复、取消和源文件丢失。
7. 播放、暂停、继续、切换另一条、完成归零。
8. 缓存复用、临时 URL 刷新、下载或解码失败后重试。
9. 未听点只在完整播放后消失，切换账号不串号。
10. 播放时开始录音、退后台、耳机断开、系统打断和撤回。
11. 两分钟内撤回语音，双端停止播放并显示撤回占位。
12. 键盘/语音切换后文字草稿保持。

- [ ] **Step 5: 本地提交交接文档**

```bash
git add docs/superpowers/plans/2026-07-29-im-client-HANDOFF.md
git commit -m "文档(IM客户端)：记录语音消息开发状态"
```

---

## 计划自检

- 规格覆盖：录音手势、权限、60 秒边界、真实振幅、AUDIO 元数据、断点上传、播放协调、未听状态、生命周期、撤回和手测均有对应任务。
- 类型一致：`VoiceMetadata.duration/waveform`、`MediaUploadTask.metadata`、`sdk.voice.permission/recording/player/heard` 在生产方与消费方命名一致。
- 范围控制：不引入后台录音、听筒、倍速、转文字、拖动定位或跨设备已听同步。
- 用户改动隔离：所有后端提交均使用显式文件路径，不暂存 `ImConversationMember.java` 和 `ConversationService.java`。
- 验证约定：没有新增或运行自动化测试步骤；静态检查、跳过测试构建、安全扫描和用户手测边界明确。
