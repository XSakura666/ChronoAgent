# ChronoAgent（DSH 静态插件）安装指南

这个包把「定时任务智能体」做成了 DSH 的**静态 host 插件**：任务写进会话事件日志持久化，随 DSH 重启后自动恢复，并在会话 agent 上线时补投过期任务。

## 文件

- `package.json` — 包清单（`name: dsh-chrono-agent`，ESM，`main: index.js`）。
- `index.js` — 插件本体（`apply` + 每个会话一个 `ChronoRuntime`）。

## 工作原理（对照动态版 v4 的关键差异）

- 静态包跑在 **host 主机语境**，拥有完整 Node 能力：直接用 `setTimeout`/`clearTimeout`、`crypto`、`createUserMessage`（`@deepseek-ai/dsh-llm`）、`defineTool`（`@deepseek-ai/dsh-tools`）。
- 通过 **`agent/created` 事件** 监听每个根 agent 上线：折叠 `agent.session.events` 里的 `chrono/task` 事件重建任务表、重挂定时器、补投 `at <= now` 的过期任务。
- 到点用 `agent.followup(message)` 唤醒该会话 agent 自动执行（零 token 到点前）。
- 任务变更（create/cancel/dispatch/clear）都 `agent.session.append("chrono/task", …)` 持久化。

## 安装步骤（推荐：手动复制，最稳）

> 这些步骤会写入 DSH 的 home 目录（默认 `~/.dsh`，即 Windows 的 `C:\Users\<你的用户名>\.dsh`）。

1. **复制包进 profile 的 node_modules**（真实复制，不是符号链接——ESM 会按真实路径向上解析依赖）：

   ```powershell
   Copy-Item "<你的项目路径>\dsh-chrono-agent" `
             "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-chrono-agent" -Recurse -Force
   ```

2. **在宿主组合里加一行**。编辑 `$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml`，把 `[]` 改成：

   ```yaml
   - id: chrono-agent
     name: dsh-chrono-agent
   ```

3. **重启 DSH**（先停掉正在跑的 `dsh web`，再 `dsh web` 启动）。

## 备选：`dsh plugin` 安装

```powershell
dsh plugin --profile web add file:<你的项目路径>/dsh-chrono-agent
```

然后同样编辑 `cordis.patch.yml` 加行、重启。注意 pnpm 对 `file:` 本地包可能建**符号链接**，ESM 依赖解析会沿真实路径向上找，可能找不到 `@deepseek-ai/*` —— 若遇到 `Cannot find package "@deepseek-ai/dsh-tools"`，改用上面的手动复制法。

## 验证

重启后，在会话里问模型「用 list_scheduled_tasks 看看定时任务」，或让模型 `schedule_task(text="...", at="60")` 排一个 60 秒后的任务。到点应能看到 agent 自动醒来执行。

## 依赖说明

本包 `import` 了 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/cordis`，这些已在 profile 的 hoisted `node_modules/@deepseek-ai/*` 里，无需额外安装。
