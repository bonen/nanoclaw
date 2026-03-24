---
name: loopbox
description: Interact with Loopbox tasks — create new todos or update the current task. Use when working inside a Loopbox task or when any agent wants to create a new Loopbox todo.
---

# Loopbox Tools

Two MCP tools are available for interacting with Loopbox (the todo/task app).

## `mcp__nanoclaw__loopbox_create_task` — Create a new todo

Available to any agent. Creates a task assigned to the owner.

```
loopbox_create_task(
  name: "Follow up with customer",        // required: task title
  description: "Check order #12345",      // optional: details/notes
)
```

Use this to proactively create follow-up tasks, delegate work, or capture things to do later.

## `mcp__nanoclaw__loopbox_update_task` — Update the current task

Only available when running inside a Loopbox task (not in WhatsApp/Telegram/etc. groups).

```
loopbox_update_task(
  message: "Research complete, see details below",  // post to activity feed
  details: "## Findings\n- ...",                    // replace task notes (markdown)
  reassign_to_user_id: "user_abc123",               // hand back to the user
  label_ids: ["label_id_1", "label_id_2"],          // replace all labels
)
```

All fields are optional — include only what you need.

### Common patterns

**Research task — add notes and reassign to user:**
```
loopbox_update_task(
  details: "## MacBook Comparison\n- M4 Pro: ...\n- M4 Max: ...",
  message: "Research done, notes in details",
  reassign_to_user_id: "<owner-id>",
)
```

**Post a progress update mid-task:**
```
loopbox_update_task(message: "Found the issue, working on a fix...")
```

**Simple response:** Just output your reply normally — the host calls `submitWork` automatically and closes the task. Use `loopbox_update_task` when you want to do more than just reply (add notes, reassign, label).
