---
name: add-loopbox
description: Add Loopbox as a channel. Loopbox is a todo app where each task has an agent chat. NanoClaw subscribes to pending tasks via Convex and responds in real time. Each task gets its own isolated agent session.
---

# Add Loopbox Channel

This skill installs the Loopbox channel — a real-time Convex subscription that delivers todo task chats to the agent and posts replies back.

## Phase 1: Collect Token

Use `AskUserQuestion` to ask:

> Do you have a Loopbox agent token (starts with `ak_...`)? If not, go to Loopbox → Settings → Agents, find or create the nanoclaw agent, and click **Token**. It's only shown once so copy it now.

Wait for the user to provide the token, then append it to `.env`:

```bash
echo "LOOPBOX_TOKEN=<their-token>" >> .env
```

`LOOPBOX_URL` defaults to `https://convex.loopbox.one`. If they're using a self-hosted or custom Convex instance, also add:

```bash
echo "LOOPBOX_URL=<their-convex-url>" >> .env
```

Sync to the container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

## Phase 2: Pre-flight

Check if the channel is already installed:

```bash
test -f src/channels/loopbox.ts && echo "already installed"
```

If already installed, skip to Phase 5 (Build & Restart).

## Phase 3: Core change — add `registerGroup` to ChannelOpts

Loopbox auto-registers a new group for each task it receives. This requires adding a `registerGroup` callback to the shared channel options type.

### 3a. Update `src/channels/registry.ts`

Add `registerGroup` to the `ChannelOpts` interface. The interface currently ends with:
```ts
  registeredGroups: () => Record<string, RegisteredGroup>;
```

Add one line after it:
```ts
  registerGroup: (jid: string, group: RegisteredGroup) => void;
```

### 3b. Update `src/index.ts`

Find the `channelOpts` object (containing `onMessage`, `onChatMetadata`, `registeredGroups`). Add `registerGroup` to it:

```ts
    registeredGroups: () => registeredGroups,
    registerGroup,
```

The `registerGroup` function is already defined in `src/index.ts` — just add it to the opts object.

## Phase 4: Install the channel

### 4a. Install the Convex npm package

```bash
npm install convex
```

### 4b. Copy the channel file

Copy `${CLAUDE_SKILL_DIR}/loopbox.ts` to `src/channels/loopbox.ts`.

### 4c. Register in the barrel

Add this import to `src/channels/index.ts`:

```ts
import './loopbox.js';
```

## Phase 5: Build and restart

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

## Phase 6: Verify

Check the logs to confirm the subscription is live:

```bash
tail -20 logs/nanoclaw.log | grep -i loopbox
```

You should see:
```
Loopbox channel connected
```

When a user sends a message in Loopbox, you'll also see:
```
Loopbox task group registered  { jid: "loopbox:<taskId>", ... }
```

If you see "Channel installed but credentials missing — skipping", the `LOOPBOX_TOKEN` in `.env` is missing or incorrect.

## How it works

- `LOOPBOX_TOKEN` is read from `.env` at startup via `readEnvFile`. If missing, the channel is gracefully skipped (same pattern as Telegram/Slack/Discord).
- NanoClaw subscribes to `agents:getAssignedTasks` on Convex — a reactive push subscription, no polling.
- Each pending task becomes a JID (`loopbox:<taskId>`) and is auto-registered as its own group with an isolated `groups/loopbox_<id>/` folder and agent session.
- The task's `context` field (a server-assembled, formatted prompt including full history and instructions) is passed directly to the agent — no client-side history assembly needed.
- When the agent replies via the normal output path, NanoClaw calls `agents:submitWork` on Convex, which posts the reply and removes the task from the pending queue.
- The `inProgress` set prevents double-processing if the subscription fires while a response is in flight.

### Container agent tools

Agents running in a Loopbox task context have two additional MCP tools (registered via the `registerAction` mechanism in `ChannelOpts`):

- **`loopbox_update_task`** (loopbox groups only): Update task details or post a message to the activity feed without sending a final reply. Supports `message`, `details`, `label_ids`, and `reassign_to_user_id`. Authorization: only the group that owns the task can call this.
- **`loopbox_create_task`** (any group): Create a new Loopbox task assigned to the owner. Useful for proactive follow-up tasks from any agent.

Both tools write IPC files to `/workspace/ipc/tasks/` which the host processes and routes to the Loopbox channel — the token never leaves the host.

## Troubleshooting

### "Channel installed but credentials missing — skipping"

`LOOPBOX_TOKEN` is absent or blank in `.env`. Add it and restart.

### Build error: `registerGroup` not found on ChannelOpts

Phase 3 was not applied. Check that `ChannelOpts` in `src/channels/registry.ts` includes `registerGroup`, and that `channelOpts` in `src/index.ts` passes it.

### "No channel owns JID" in logs

The `ownsJid` check failed. Verify the channel file was copied correctly and is imported in `src/channels/index.ts`.

### Tasks appear but agent doesn't reply

1. Check the group folder was created: `ls groups/ | grep loopbox`
2. Check agent logs: `tail -f groups/loopbox_*/logs/*.log`
3. Look for "Failed to send Loopbox reply" in `logs/nanoclaw.log`

## Removal

```bash
rm src/channels/loopbox.ts
# Remove 'import ./loopbox.js' from src/channels/index.ts
# Remove 'registerGroup' from ChannelOpts in src/channels/registry.ts (if no other channel uses it)
# Remove 'registerGroup' from channelOpts in src/index.ts (if no other channel uses it)
# Remove LOOPBOX_TOKEN from .env
npm uninstall convex
npm run build
systemctl --user restart nanoclaw  # or launchctl kickstart on macOS
```
