# dsh-chrono-agent

A **scheduled-task agent** plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) — the DSH-native version of ChronoAgent.

Schedule tasks to run automatically at a future time, with **zero token cost until they fire**. Tasks are persisted to the session log, survive DSH restarts, and overdue tasks run when the session resumes.

## Features

- `schedule_task(text, at, repeat?)` — schedule a one-shot or recurring task
- `list_scheduled_tasks` / `cancel_scheduled_task` / `clear_scheduled_tasks`
- `at` accepts ISO 8601, local time-of-day `"18:00"`, relative durations (`"2h"`, `"30m"`, `"1d"`), or seconds
- `repeat: "daily" | "weekly"` (DST-safe)
- Same-time tasks are batched into a single agent turn (saves tokens)
- Durable: tasks live in the session event log (`chrono/task`), recovered on `agent/created`

## Install

See [INSTALL.md](INSTALL.md). In short:

1. Copy this package into your profile's `node_modules` (real copy, not a symlink):

   ```powershell
   Copy-Item "<your-path>\dsh-chrono-agent" "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-chrono-agent" -Recurse -Force
   ```

2. Add a row to your profile's `cordis.patch.yml`:

   ```yaml
   - id: chrono-agent
     name: dsh-chrono-agent
   ```

3. Restart DSH and open a new session.

## How it works

The plugin runs host-side. On `agent/created`, it folds that session's `chrono/task` events to rebuild the task table, arms a timer for the next due task, and wakes the owning agent with `agent.followup` when a task fires — so the agent executes the task with its own tools (files, web, commands, subagents, MCP).

See [../dsh-plugin-design.md](../dsh-plugin-design.md) for the full design notes.
