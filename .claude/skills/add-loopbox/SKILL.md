---
name: add-loopbox
description: Add Loopbox as a channel. Loopbox is a todo app where each task has an agent chat. NanoClaw subscribes to pending tasks via Convex and responds in real time. Each task gets its own isolated agent session.
---

# Add Loopbox Channel

This skill installs the Loopbox channel — a real-time Convex subscription that delivers todo task chats to the agent and posts replies back.

## Phase 1: Pre-flight

Check if the channel is already installed:

```bash
test -f src/channels/loopbox.ts && echo "already installed"
```

If already installed, skip to Phase 4 (Build & Restart).

## Phase 2: Core change — add `registerGroup` to ChannelOpts

Loopbox auto-registers a new group for each task it receives. This requires adding a `registerGroup` callback to the shared channel options type.

### 2a. Update `src/channels/registry.ts`

Add `registerGroup` to the `ChannelOpts` interface:

```ts
import { RegisteredGroup } from '../types.js';
```

The interface currently ends with:
```ts
  registeredGroups: () => Record<string, RegisteredGroup>;
```

Add one line after it:
```ts
  registerGroup: (jid: string, group: RegisteredGroup) => void;
```

### 2b. Update `src/index.ts`

Find the `channelOpts` object (the one passed to channel factories, containing `onMessage`, `onChatMetadata`, `registeredGroups`). Add `registerGroup` to it:

```ts
    registeredGroups: () => registeredGroups,
    registerGroup,
```

The `registerGroup` function is already defined in `src/index.ts` — just add it to the opts object.

## Phase 3: Install the channel

### 3a. Install the Convex npm package

```bash
npm install convex
```

### 3b. Copy the channel file

Copy `${CLAUDE_SKILL_DIR}/loopbox.ts` to `src/channels/loopbox.ts`.

### 3c. Register in the barrel

Add this import to `src/channels/index.ts`:

```ts
import './loopbox.js';
```

## Phase 4: Build and restart

```bash
npm run build
```

Build must be clean (no TypeScript errors) before restarting.

Restart the service:

```bash
# Linux (systemd)
systemctl --user restart nanoclaw

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Phase 5: Verify

Check the logs to confirm the subscription is live:

```bash
tail -f logs/nanoclaw.log | grep -i loopbox
```

You should see:
```
Loopbox channel connected
```

When a user sends a message in Loopbox, you'll also see:
```
Loopbox task group registered  { jid: "loopbox:<taskId>", ... }
```

## How it works

- NanoClaw subscribes to `nanoclaw:getPendingMessages` on Convex — a reactive push subscription, no polling.
- Each pending task becomes a JID (`loopbox:<taskId>`) and is auto-registered as its own group with an isolated `groups/loopbox_<id>/` folder and agent session.
- The full chat history is included in every message so the agent has prior context.
- When the agent replies, NanoClaw calls `nanoclaw:respondToTask` on Convex, which posts the reply and removes the task from the pending queue.
- The `inProgress` set prevents double-processing if the subscription fires while a response is in flight.

## Troubleshooting

### Build error: `registerGroup` not found on ChannelOpts

Phase 2 was not applied. Check that `ChannelOpts` in `src/channels/registry.ts` includes `registerGroup`, and that `channelOpts` in `src/index.ts` passes it.

### "No channel owns JID" in logs

The `ownsJid` check (`jid.startsWith('loopbox:')`) failed. Verify the channel file was copied correctly and is imported in `src/channels/index.ts`.

### Tasks appear but agent doesn't reply

1. Check the group folder was created: `ls groups/ | grep loopbox`
2. Check agent logs: `tail -f groups/loopbox_*/logs/*.log`
3. Verify the Convex mutation succeeds: look for "Failed to send Loopbox reply" in `logs/nanoclaw.log`

### Task stays pending after a reply

The `respondToTask` mutation may have thrown. Check for errors in `logs/nanoclaw.log`. The `inProgress` entry is cleared in `finally`, so the task will be retried on the next subscription update.

## Removal

```bash
rm src/channels/loopbox.ts
# Remove 'import ./loopbox.js' from src/channels/index.ts
# Remove 'registerGroup' from ChannelOpts in src/channels/registry.ts (if no other channel uses it)
# Remove 'registerGroup' from channelOpts in src/index.ts (if no other channel uses it)
npm uninstall convex
npm run build
systemctl --user restart nanoclaw  # or launchctl kickstart on macOS
```
