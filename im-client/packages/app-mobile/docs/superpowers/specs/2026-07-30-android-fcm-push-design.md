# Android FCM Message Push Design

## Objective

Add Android message notifications to the existing React Native IM client and Spring Boot IM backend. The first release supports devices with Google Play services through Firebase Cloud Messaging (FCM). The foreground application continues to use WebSocket delivery; a backgrounded or process-terminated application shows a native Android notification containing the sender and a safe message preview.

This design extends the existing message pipeline without making FCM authoritative and without allowing FCM latency or failure to block message persistence, acknowledgement, WebSocket delivery, or later incremental synchronization.

## Confirmed Product Rules

- The first release supports FCM only. Huawei, Xiaomi, OPPO, vivo, and other vendor channels are out of scope.
- The client and server may both change.
- The foreground application does not show a system notification. It continues to render messages through the existing WebSocket and SQLite synchronization path.
- A backgrounded application or an application process restarted by FCM shows a native notification.
- A notification shows sender and message-preview details.
- Normal conversations produce notifications.
- A muted conversation suppresses ordinary notifications, but `@me` and `@all` notifications still appear.
- A sender's own other devices do not receive a notification for that sender's message.
- A notification tap opens the corresponding conversation and then synchronizes authoritative data through the existing SDK.

## Current Architecture

`MessageAppender` assigns a per-conversation sequence, persists the message in MongoDB, updates the MySQL conversation summary, and calls `OutboundDispatcher`. The dispatcher looks up active device routes in Redis and publishes `im-outbound` packets to Kafka. `im-gateway` consumes those packets and sends WebSocket `PUSH` envelopes to active channels.

The React Native client persists messages and conversations in SQLite through `@im/sdk-rn` and `@im/sdk-core`. It already has a stable installation `deviceId`, authentication recovery, WebSocket reconnect, incremental synchronization, conversation mute state, and validated `@me`/`@all` message metadata. Android currently has no Firebase dependency, notification permission, channel, service, or notification-tap routing.

Redis WebSocket presence is deliberately not used to decide whether to send an FCM message. A background Socket may remain registered until its TTL expires, while Android may suspend JavaScript timers. Depending on that route would create a missed-notification window.

## Chosen Architecture

Each accepted user message has two independent downstream paths after it obtains its authoritative `msgId`, `cid`, `seq`, and timestamp:

1. The existing real-time path publishes to `im-outbound`, reaches active WebSocket devices, and enters the existing SDK/SQLite flow.
2. A new notification path publishes a compact `PushCandidate` to an `im-push` Kafka topic. A separate consumer resolves eligible recipients and registered installations, builds per-installation FCM data messages, and invokes Firebase Admin SDK.

The FCM consumer is asynchronous with respect to message acceptance. A slow or unavailable FCM service cannot delay the message's ACK, persistence, WebSocket delivery, or future REST synchronization. Kafka provides at-least-once processing; the Android client uses `msgId` to remove user-visible duplicates.

The implementation keeps the push producer in the backend and does not add a new deployment for the first release. The consumer has its own listener concurrency, bounded retry policy, and dead-letter topic so it cannot starve the existing `im-logic` consumer.

## Server Components

### Appended message result

`MessageAppender.append` currently returns only `seq`, while `msgId` and timestamp are generated internally. It will return an `AppendedMessage` value containing `msgId`, `seq`, and `ts`. Existing WebSocket dispatch remains unchanged.

After `InboundMessageConsumer` completes mention validation, append, and `mention_seq` advancement, it publishes a `PushCandidate`. Publishing after mention advancement makes the candidate's recipient classification consistent with the durable mention state.

The first release produces candidates for user-visible user messages: `TEXT`, `IMAGE`, `AUDIO`, and `FILE`. `READ`, `RECALL`, link-card enrichment, error frames, and administrative control frames do not create new-message notifications. Adding selected `SYSTEM` notifications later requires an explicit product rule rather than implicitly notifying for every system event.

### Push candidate

The internal Kafka record contains only data needed to determine and render a notification:

- schema version;
- `msgId`, `cid`, `seq`, sender ID, message type, and timestamp;
- a precomputed safe preview rather than an entire media or message body;
- validated mention target IDs;
- conversation type and group ID when applicable.

The record never contains an access token, refresh token, signed media URL, upload metadata, or Firebase credential. The candidate topic is treated as sensitive because its preview contains message text.

### Recipient policy

`PushRecipientResolver` loads current conversation membership and applies these rules in order:

1. Exclude the sender by user ID, which excludes all of the sender's devices.
2. Exclude deleted or non-member recipients.
3. Include an unmuted recipient.
4. For a muted recipient, include only when the validated mention target set contains that recipient.
5. Load only active, fresh Android FCM registrations for each included recipient.

The worker evaluates current mute state at consumption time. A mute change racing with an already accepted message may resolve according to whichever operation commits first; no cross-database total ordering is promised.

### FCM fan-out

`FcmPushSender` uses Firebase Admin SDK and sends high-priority Android data messages. Targets are sent with `sendEach` in batches of at most 500 because each payload includes an installation's current recipient binding. Results are correlated by input order.

Transient failures use bounded exponential retries with jitter. Exhausted transient failures go to `im-push.DLT`. Permanent invalid/unregistered-target responses disable that registration immediately. Message delivery remains successful even if every FCM send fails.

Push integration is guarded by `rbac.im.push.enabled`. Local development and tests default to disabled unless Firebase credentials are configured. Production enables it explicitly.

## Registration Data Model

Add a Flyway migration for `im_push_registration` with these logical fields:

| Field | Purpose |
| --- | --- |
| `id` | Surrogate primary key |
| `user_id` | Authenticated account currently bound to the installation |
| `device_id` | Existing stable client installation ID used by WebSocket routing |
| `platform` | `ANDROID` in this release |
| `provider` | `FCM` |
| `target_type` | `FID` by default; `TOKEN` only for compatibility during Firebase migration |
| `target_value` | Sensitive FCM target value; excluded from logs and API responses |
| `enabled` | Whether the target is eligible for sends |
| `last_seen_at` | Last successful client refresh of the registration |
| audit fields | Existing project creation/update/deletion conventions |

Use a unique key on `(user_id, device_id, provider)` for idempotent registration and a unique key on `(provider, target_value)` so an FCM target has one current account binding. Re-registering an installation atomically moves the target to the authenticated account and enables it. Server code never accepts `user_id` from the request body.

The database account used by unrelated services must not have read access to this table. Target values are redacted from exceptions, structured logs, traces, and metrics. If the deployment already has an application-level KMS/envelope-encryption facility, `target_value` should use it; introducing a new key-management subsystem is not required solely for this release.

Firebase is transitioning programmatic targeting toward Firebase Installation IDs (FIDs). A new installation uses FID, while `target_type` allows a controlled compatibility path for registration tokens without another schema migration. See [Firebase registration-management guidance](https://firebase.google.com/docs/cloud-messaging/manage-tokens) and [Firebase Admin send guidance](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk).

## Registration API

All endpoints use the existing authenticated `/api` base and derive the user from Spring Security.

### Upsert registration

`PUT /im/push/registrations/{deviceId}`

```json
{
  "platform": "ANDROID",
  "provider": "FCM",
  "targetType": "FID",
  "targetValue": "firebase-installation-id",
  "appVersion": "1.0"
}
```

The endpoint validates bounded field lengths, known enum values, and the path `deviceId`. It returns `204 No Content` and behaves idempotently. The same target submitted by a newly authenticated account replaces its previous account binding so queued data cannot keep registering an old account.

### Delete registration

`DELETE /im/push/registrations/{deviceId}`

The endpoint disables or removes only the authenticated user's matching registration and returns `204 No Content` when it is already absent. It cannot delete another user's registration by guessing a `deviceId`.

### Client refresh cadence

The client upserts after notification permission is available and after each successful login or restored session. It refreshes the registration when the Firebase installation value changes and at most once per seven days while actively used. This keeps `last_seen_at` current without uploading on every foreground transition.

If Android notification permission is denied or notifications are disabled in system settings, the client does not create a new registration and disables an existing one on its next foreground check. Denial never blocks login, WebSocket messaging, or synchronization.

Logout uses this local order:

1. Clear the native current-account binding so a late old-account push is immediately rejected.
2. Best-effort delete the server registration while the access token is still available.
3. Stop media and WebSocket activity and complete the existing authentication logout.

A failed best-effort delete is safe because account binding in every payload is checked natively and the next registration atomically changes ownership.

## FCM Data Contract

FCM carries a versioned data payload, not an Android notification payload. This gives native code consistent channel, grouping, foreground-suppression, duplicate-detection, and tap-routing behavior.

```json
{
  "version": "1",
  "event": "NEW_MESSAGE",
  "recipientUserId": "42",
  "msgId": "abc123",
  "cid": "g_100",
  "seq": "86",
  "conversationType": "GROUP",
  "groupId": "100",
  "title": "研发群",
  "senderName": "张三",
  "preview": "今晚八点发布",
  "mentioned": "true",
  "ts": "1785400000000"
}
```

FCM data values are strings. The complete payload stays well below FCM's 4096-byte instant-message limit. `preview` is server-generated, has line breaks collapsed, and is capped by Unicode code points so it cannot split a surrogate pair. Text uses a short sanitized excerpt. Media uses stable labels such as `[图片]`, `[语音]`, and `[文件]`; it never exposes object keys or signed URLs.

Single-chat notifications use the sender as title and the preview as body. Group notifications use the group name as title and `senderName：preview` as body. The server uses authoritative current names when creating the candidate; notification text is only a hint and is not persisted as authoritative local message data.

Messages use Android high priority with a 24-hour TTL and are non-collapsible because individual chat messages are user-visible. FCM does not guarantee delivery order, so `seq` is diagnostic and synchronization input rather than a reason to apply payloads directly. See [FCM priority guidance](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-priority) and [collapsible-message guidance](https://firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types).

## Android Native Components

### Firebase integration

Use the Google Services Gradle plugin, Firebase Android BoM, Firebase Messaging, and Firebase Installations main modules. Do not add deprecated Firebase KTX artifacts. Firebase configuration uses `android/app/google-services.json`; it contains project identifiers rather than a server credential, but each environment must supply the correct file through the project's established configuration/deployment process.

The package/application ID must be finalized before registering the Android application in Firebase. Debug and production variants must not silently share a production sender identity unless that is an explicit environment choice. See [Firebase Android setup](https://firebase.google.com/docs/android/setup).

### Native bridge

A focused React Native native module exposes:

- the stable Firebase installation target and target type;
- current notification-permission/enablement state;
- current account binding setters and clearers;
- queued notification-open and foreground-push events.

The SDK's existing installation `deviceId` must become accessible to the application so registration and WebSocket routing use the same identifier. It remains generated and stored by `@im/sdk-rn`; the push feature does not introduce a second app installation ID.

### Firebase messaging service

`ImFirebaseMessagingService` validates every data message before acting:

1. Require supported `version` and `event` values.
2. Require bounded and syntactically valid `msgId`, `cid`, `seq`, title, sender, and preview fields.
3. Compare `recipientUserId` with the native current-account binding. Drop when absent or different.
4. Check the persistent bounded `msgId` duplicate set. Drop known IDs.
5. If an application activity is resumed, enqueue a lightweight foreground event for JavaScript and do not show a system notification.
6. Otherwise, create or update the conversation notification.

Foreground JavaScript treats the event only as a synchronization hint and calls the existing conversation synchronization path. The SDK's `cid`/`seq` constraints and SQLite uniqueness still perform authoritative deduplication. FCM payload content never enters the message store directly.

Android may start the service in a new process after normal process termination. The service therefore cannot depend on React state, Zustand, an initialized JavaScript bundle, or an open SQLite database to display a notification. It uses native persistent account binding and duplicate metadata. Android does not deliver ordinary FCM messages while the user has explicitly force-stopped the application; this limitation is documented rather than worked around.

### Notification coordinator

Create channels once from `MainApplication`:

- `messages`: default importance for ordinary messages;
- `mentions`: high importance for `@me` and `@all` messages.

Channel IDs are stable because Android users control their settings after creation. The coordinator checks `POST_NOTIFICATIONS` and `NotificationManagerCompat.areNotificationsEnabled()` before posting.

Each `cid` maps to a stable notification ID. A bounded native record retains only recent display summaries needed for `InboxStyle`; consecutive messages update one conversation notification and its count. All conversation notifications use a common group key and an optional group summary when multiple conversations are active. Opening a conversation clears that conversation's notification.

Notifications use `VISIBILITY_PRIVATE` so Android's lock-screen privacy setting remains authoritative. They use an explicit immutable `PendingIntent` targeting the existing single-task `MainActivity`; no exported custom deep-link intent filter is required.

### Notification permission

Declare `POST_NOTIFICATIONS`. On Android 13 and later, show a short in-app explanation after the first successful login and then request permission. Do not request on cold startup before authentication. Dismissal or denial leaves the application usable and exposes a later route to Android notification settings rather than repeatedly prompting. Android 13 starts new installations with notifications off until permission is granted; see [Android notification permission guidance](https://developer.android.com/develop/ui/compose/notifications/notification-permission).

### Navigation on tap

`MainActivity.onCreate` and `onNewIntent` forward validated notification extras to the native module. A top-level navigation coordinator queues the most recent open request until all three conditions hold:

1. application boot is complete;
2. the intended recipient account is authenticated;
3. the navigation container is ready.

It then opens `Chat` with `cid`, conversation type, optional group ID, a safe fallback title, and `syncOnOpen: true`. The Chat screen synchronizes through the existing API. If the user is logged out, the request remains pending through login only for the matching account. If membership was removed or the conversation no longer exists, synchronization reports the existing recoverable error and navigation returns to the conversation list instead of trusting stale payload data.

## Delivery and Failure Semantics

- FCM is an attention mechanism, not a message transport of record.
- WebSocket and REST/SQLite synchronization remain authoritative.
- Kafka retry can repeat a candidate, so native `msgId` deduplication is mandatory.
- FCM may delay, reorder, expire, or drop messages. A tap always synchronizes from the server.
- `FirebaseMessagingService.onDeletedMessages` schedules a full SDK synchronization for the next safe foreground opportunity. FCM may call this when too many messages were pending; see [Android message-receipt behavior](https://firebase.google.com/docs/cloud-messaging/android/receive-messages).
- The native duplicate store is bounded by count and age. It prevents repeated alerts without becoming an unbounded message database.
- Invalid payloads are dropped and counted without logging their raw contents.
- A missing Firebase configuration disables push and emits a clear health/configuration signal; it never prevents the backend or app from starting in development.
- Dead-letter records retain only the compact candidate and failure classification and follow the same retention/access policy as other message-bearing Kafka topics.

## Security and Privacy

- Firebase Admin credentials are supplied through Application Default Credentials, workload identity, or a secret-mounted environment configuration. They are never committed, embedded in the APK, placed in `application.yml`, or logged.
- The Android APK contains only client Firebase configuration. It never contains a service-account private key.
- Registration endpoints require normal authentication, derive user identity server-side, validate all input, and cannot mutate another user's row by `deviceId` alone.
- FCM target values and raw payloads are redacted from logs, traces, metrics labels, exception messages, and admin screens.
- FCM payloads contain the minimum preview required by the confirmed product choice. They contain no credentials, signed URLs, quote snapshots, full media metadata, or hidden message properties.
- `recipientUserId` prevents a queued old-account notification from appearing after account switching on the same installation.
- Explicit immutable pending intents and strict native parsing prevent mutable-intent injection and malformed navigation parameters.
- Opening a notification never bypasses server authorization or conversation membership checks.

## Observability

Record low-cardinality counters and timers for:

- candidates published and consumed;
- recipients excluded as sender, muted, or unregistered;
- targets attempted, accepted by FCM, permanently invalid, transiently failed, retried, and dead-lettered;
- candidate-to-FCM acceptance latency;
- client payload-invalid, account-mismatch, duplicate-suppressed, foreground-suppressed, displayed, and opened events where local telemetry policy permits.

Metrics and structured logs identify a message only by `msgId` and coarse failure code. They never include preview, sender name, FCM target, access token, or Firebase credential. FCM acceptance means that Firebase accepted the request, not that a device displayed it.

## Testing

### Backend unit tests

- Device registration upsert, account rebinding, authenticated delete, enum/length validation, and freshness filtering.
- Recipient exclusion for sender, deleted member, muted ordinary message, muted mention, and unmuted mention.
- Preview generation for text, newlines, Unicode truncation, image, audio, and file.
- Candidate generation only after append and mention advancement.
- FCM batch partitioning at 500 targets, input/result correlation, invalid-target disablement, transient retry classification, and payload redaction.

### Backend integration tests

- Authenticated MockMvc registration lifecycle against the Flyway schema.
- Kafka candidate consumption with a fake `PushSender` for success, retry, permanent failure, duplicate consumption, and dead-letter exhaustion.
- An end-to-end message test proving that FCM failure does not change message persistence, WebSocket dispatch, or sync visibility.

Firebase Admin SDK is wrapped behind an interface; automated tests never contact real FCM or require production credentials.

### Android and React Native tests

- Native payload validation, account mismatch, duplicate detection, foreground suppression, permission denial, channel selection, stable per-conversation IDs, and immutable intents.
- `onCreate` and `onNewIntent` cold/warm notification-open handling.
- JavaScript pending-navigation behavior before boot, before authentication, before navigation readiness, after matching login, and after mismatched login.
- Foreground push hints trigger synchronization without inserting payload data directly.
- Existing login, logout, WebSocket, conversation, and Chat navigation tests continue to pass.

### Manual device matrix

Use physical or Google Play-enabled emulator devices on Android 12 and Android 13 or later. Verify permission allowed, denied, and later disabled; foreground, background, screen locked, normal process swipe-away, cold notification tap, and documented force-stop behavior. Cover single chat, group chat, muted ordinary messages, muted mentions, multiple rapid messages, multiple conversations, multiple devices, account switching, stale registration, and temporary network loss.

## Acceptance Criteria

- With notification permission granted and a valid registration, an eligible background message normally produces a notification containing the sender and safe preview.
- An active foreground application does not show a system notification and still receives or synchronizes the message through the existing SDK path.
- Ordinary messages in muted conversations do not notify; validated `@me` and `@all` messages do.
- The sender receives no FCM notification on any of the sender's registered devices.
- The same `msgId` does not produce more than one user-visible notification on one installation despite duplicate Kafka/FCM delivery.
- A notification tap from a warm or cold application reaches the correct conversation after boot/auth/navigation readiness and performs authoritative synchronization.
- A delayed payload for a previous account is discarded on a shared installation.
- Denied notification permission does not affect login, WebSocket messaging, local data, or synchronization.
- FCM outage, missing development configuration, or invalid target never causes an accepted IM message to fail.
- Logs, traces, and metrics do not expose FCM targets, Firebase credentials, access tokens, or message previews.

Delivery time is monitored but is not expressed as a strict end-to-end SLA because Android power management, network conditions, user notification settings, and FCM delivery are outside the application's full control.

## Rollout

1. Deploy the schema and registration APIs with push sending disabled.
2. Release an internal Android build that registers installations and exercises permission, channel, payload, and tap behavior against a non-production Firebase project.
3. Enable the push consumer for internal accounts, monitor invalid-target and retry rates, and verify message-path latency is unchanged.
4. Expand gradually while retaining the server-side feature flag and dead-letter monitoring.
5. Document Firebase-project ownership, credential rotation, environment mapping, and the force-stop limitation before general release.

## Scope Boundaries

This release does not add iOS/APNs, domestic Android vendor channels, web push, marketing notifications, topic broadcasts, notification replies, notification mark-as-read actions, calls, end-to-end encrypted notification previews, per-user preview privacy settings, strict push-delivery SLAs, or an FCM transactional outbox. It does not replace WebSocket, REST incremental synchronization, SQLite, the existing message schema, or Android system notification controls.
