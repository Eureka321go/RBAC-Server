# IM Client UI and Motion Design

## Objective

Upgrade the complete React Native IM client to a polished, coherent visual system without changing its messaging, synchronization, authentication, voice, attachment, or group-management behavior. The redesign covers login, conversations, chat, contacts, groups, settings, and a new profile area.

The experience uses the light **Aurora Cloud** direction by default and translates the dark **Night Navigation Neon** direction into a matching dark mode. Motion stays restrained, fast, and functional.

## Product Structure

Authenticated users enter a three-tab application shell:

1. **Chats** — conversation list and entry point to direct and group conversations.
2. **Contacts** — searchable organization directory and entry points for direct chats and group creation.
3. **Me** — profile, presence, appearance, notifications, storage, privacy, help, and logout.

The tab bar remains visible on the three root screens. Secondary screens such as chat detail, group creation, conversation settings, and group details are pushed on the native stack and hide the tab bar. Login remains outside the authenticated shell.

## Visual System

### Light theme: Aurora Cloud

- Cool white and pale blue layered backgrounds.
- White translucent-looking surfaces with subtle borders and soft shadows.
- Blue-to-violet accents for primary actions, active navigation, and selected states.
- Saturated gradient avatars, with deterministic identity colors.
- High-contrast dark navy text and quiet blue-gray secondary text.

### Dark theme: Night Navigation Neon

- Deep navy backgrounds rather than pure black.
- Slightly elevated blue-gray surfaces with low-contrast light borders.
- Violet accents with controlled glow on active or transient states only.
- Bright text with muted blue-gray secondary content.
- Message bubbles and input surfaces remain clearly separated without excessive bloom.

### Theme behavior

Users can select **Follow system**, **Light**, or **Dark** in Me > Appearance. Follow system is the default. The preference persists locally. If preference loading fails, the application falls back to Follow system and does not block authentication or messaging.

Theme tokens are semantic rather than screen-specific. They cover page background, elevated and muted surfaces, primary and secondary text, borders, accent states, message bubbles, overlays, success, warning, danger, and shadows. Existing components consume these tokens through a theme hook instead of importing a static color object.

## Screen Design

### Login

The login screen uses a calm branded hero, layered ambient shapes, a raised form surface, clear focus states, and a primary gradient-style action. Form validation and authentication errors remain close to the form. Keyboard avoidance and screen-reader labels remain intact.

### Chats

The Chats root screen contains a date or contextual eyebrow, a clear page title, search, quick creation actions, and a highly scannable conversation list. Rows prioritize avatar, title, preview, time, mentions, unread count, mute state, and connection status. Empty, refreshing, offline, and sync-error states share the same visual language.

### Chat detail

Chat detail hides the root tab bar. The header shows identity, presence or member count, search, and settings. Incoming and outgoing bubbles use distinct shapes and theme-aware surfaces. Quotes, mentions, system messages, media, voice, delivery state, and unread markers retain their current behavior.

The composer uses a floating elevated surface. Attachment, voice, emoji, and send actions remain accessible with at least 44-point touch targets. A newly sent bubble moves from the composer area into the message stream with a short scale-and-translate transition.

### Contacts

Contacts becomes a permanent root tab instead of only a new-conversation utility. It provides search, organization directory access, group creation, recently contacted people, department groups, presence, and direct-chat creation. Manual user-ID entry remains available as a fallback when directory loading fails or a contact cannot be found.

### Me

The new Me screen presents the current identity and presence, followed by Appearance, Notifications and Do Not Disturb, Storage and Data, Privacy and Security, Help and About, and Logout. Only Appearance and existing supported actions need full behavior in this iteration; unsupported future settings appear only if backed by an existing destination or are omitted.

### Groups and settings

Create Group, Conversation Settings, and Group Details adopt the shared headers, surfaces, rows, selection states, buttons, empty states, and theme tokens. Their business logic and navigation parameters remain unchanged.

## Motion System

Motion communicates hierarchy and state rather than decorating every element.

- Root tab content uses a short fade and small horizontal translation.
- First-load list rows use a brief staggered upward fade. Refreshes do not replay the full entrance sequence.
- Buttons and tab icons use subtle scale or spring feedback on press and selection.
- New message bubbles use a short scale-and-translate entrance and settle without overshoot that delays reading.
- Online and unread indicators may use slow, low-amplitude breathing only when it improves discoverability.
- Voice recording, loading, and empty states receive more expressive purpose-built motion.
- Native stack transitions remain platform-appropriate.

Motion uses React Native `Animated` and `LayoutAnimation` with native-driven opacity and transform animations where supported. The implementation does not add Reanimated or a custom rendering engine. `AccessibilityInfo` controls a reduced-motion path: decorative loops stop, stagger is removed, and transitions become a short fade or immediate state change.

## Architecture and Components

The redesign introduces focused, reusable units:

- `ThemeProvider` and `useAppTheme` resolve the saved preference and system color scheme.
- `RootTabs` owns Chats, Contacts, and Me while the existing native stack owns secondary screens.
- Semantic theme tokens replace the current static `COLORS` usage incrementally across all screens in scope.
- Shared primitives provide themed surface, header, button, icon button, text field, avatar, status notice, list row, and tab bar behavior.
- Small motion primitives cover enter transitions, press feedback, presence pulse, and message entrance.

Large screens are split only where the redesign creates an obvious responsibility boundary. In particular, ChatScreen may extract its header, message row, and composer presentation, but its SDK subscriptions, pagination, sending, recording, and attachment behavior stay in their current data flow.

### Dependency choices

The implementation adds only three focused UI dependencies: `@react-navigation/bottom-tabs` for correct tab navigation semantics, `@react-native-async-storage/async-storage` for the non-sensitive appearance preference, and `react-native-linear-gradient` for the approved ambient backgrounds, avatars, and primary accents. It does not introduce a second state library or animation runtime.

## Data Flow and Persistence

The existing Zustand store remains responsible for authentication and connection state. Theme preference is isolated from SDK state and persisted through an AsyncStorage-backed adapter under one namespaced key. System appearance changes update the resolved theme immediately when the saved mode is Follow system.

Navigation changes do not alter SDK calls. Chats continues to subscribe to conversation and sync events. Contacts continues to load the SDK directory and create direct conversations through the SDK. Chat detail continues to load, subscribe, and send through its existing code paths.

## Error, Loading, and Empty States

- Initialization displays a branded loading state and surfaces database initialization failure instead of leaving a blank screen.
- Offline and reconnecting states use a compact theme-aware banner and never obscure navigation.
- Conversation and contact sync failures preserve locally available content and expose retry or fallback actions.
- Empty states explain the next useful action without animation loops that distract indefinitely.
- Theme preference errors fall back silently to the system setting.
- Animation failures cannot block interaction because final layout state is always rendered independently of animation completion.

## Accessibility

- Interactive targets remain at least 44 by 44 points.
- Text and meaningful icons meet readable light and dark contrast.
- Dynamic Type growth is allowed for labels and important content without clipping essential actions.
- Screen-reader roles and labels remain on buttons, avatars, connection state, message state, and unread indicators.
- Color is never the only signal for online, error, selected, muted, or unread state.
- Reduced-motion settings are respected throughout the application.

## Testing and Acceptance

Implementation follows test-driven development for new state and navigation behavior. Coverage includes:

- Theme preference resolution, persistence, system changes, and fallback behavior.
- Authenticated root tabs and secondary stack navigation.
- Existing login, conversation loading, direct-chat creation, message rendering, and sending regressions.
- Reduced-motion behavior for reusable motion components.
- Representative light and dark rendering for shared primitives.
- Empty, loading, offline, reconnecting, and failure states.

Completion requires fresh successful runs of ESLint, TypeScript checking, Jest, and the available Android static/build validation. The final review also checks the implementation against the approved screen structure and motion rules.

## Scope Boundaries

This work does not change server APIs, SDK contracts, message schema, encryption or authentication policy, media storage, notification infrastructure, or group permission rules. It does not add speculative settings without working destinations. It does not introduce Reanimated, Skia, a utility-CSS framework, or a new application-wide state library.
