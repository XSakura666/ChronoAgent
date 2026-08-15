# DSH 插件方案：定时任务智能体（Scheduled Task）

> 目标：把 ChronoAgent 的「定时 + 到点前零 token + 到点自动执行」能力，做成 DeepSeek Harness 的 Cordis 动态插件。

## 一、定位

DSH 插件版只补「定时调度」这一块，其余能力复用 DSH 自带：

- **Host 侧（code.host）**：注册一个 `schedule_task` 工具 + 一个到点触发的调度器（用 `timer` 服务）。
- **Client 侧（code.client）**：在设置页/侧边栏加一个「定时任务」列表，展示待执行/已完成。

## 二、核心流程

```
用户/模型 调用 schedule_task(text, at)
        ↓
  Host 存到内存任务表，用 timer 安排在 at 触发
        ↓
  到点 → 触发执行（调用模型/子代理，或发送事件/通知）
        ↓
  Client 列表刷新，显示「已完成 + 结果」
```

## 三、代码骨架（需在 cordis 环境用 cordis_inspect_* 校验真实 API）

> ⚠️ 下面按 SKILL.md 的规范写的是**骨架**。`harness`、`timer`、事件名等确切签名，必须先 `cordis_inspect_list` + `cordis_inspect_query` 确认后再填实。

### code.host（调度器 + 动态工具）

```js
return {
  inject: ['timer'],
  apply(ctx) {
    // 任务表（动态插件是 process-local，不持久化；要持久化需另接服务）
    const tasks = new Map()

    // TODO: 用 cordis_inspect_query 确认 harness 的注册工具签名
    const harness = ctx.get('harness')
    if (harness === undefined) return

    // 伪代码：注册 schedule_task 工具，让模型能安排任务
    // harness.register({
    //   name: 'schedule_task',
    //   description: '安排一个任务在未来的某个时间自动执行（到点前不消耗 token）',
    //   inputSchema: {
    //     type: 'object',
    //     properties: {
    //       text: { type: 'string', description: '要执行的任务内容' },
    //       at: { type: 'string', description: '执行时间（ISO 时间或秒数）' }
    //     },
    //     required: ['text', 'at']
    //   },
    //   execute: async (args) => {
    //     const id = crypto.randomUUID?.() ?? String(Date.now())
    //     const fireAt = Date.parse(args.at) || Date.now() + Number(args.at) * 1000
    //     const timer = ctx.timeout(() => runTask(id), Math.max(0, fireAt - Date.now()))
    //     tasks.set(id, { id, text: args.text, at: fireAt, status: 'pending', timer })
    //     return { ok: true, id, at: new Date(fireAt).toISOString() }
    //   }
    // })

    // async function runTask(id) {
    //   const task = tasks.get(id)
    //   if (!task) return
    //   task.status = 'running'
    //   // TODO: 触发执行 —— 用子代理 / 模型服务跑 task.text
    //   // 例如 ctx.get('subagents')?.spawn({ prompt: task.text }) ...
    //   task.status = 'done'
    // }

    // 清理
    ctx.on('dispose', () => { for (const t of tasks.values()) clearTimeout(t.timer) })
  }
}
```

### code.client（定时任务列表 UI）

```js
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    // TODO: 用 Slots.listSubTree 选一个合适的设置页 Slot（如 settings.section）
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', key: 'scheduled-tasks' },
      (props) => React.createElement('div', null, '定时任务列表（待实现）'),
    ))
  }
}
```

## 四、部署步骤（在 cordis 环境 / preset 下）

1. `cordis_inspect_list` → 看有哪些 Services / Builtins / Tools
2. `cordis_inspect_query` → 确认 `harness`、`timer`、`subagents`、Slot 的真实签名
3. 把上面的 code.host / code.client 填实
4. `cordis_define`（生成 pluginId + packageId）
5. `cordis_run`（激活，等待审批/加载）
6. 用 `cordis_inspect_self` 排错；`cordis_stop` 暂停

## 五、与独立桌面版的取舍

| | 独立桌面版（已做） | DSH 插件版 |
|---|---|---|
| 运行形态 | 独立 Electron app | DSH 内一个能力 |
| 定时到点前零 token | ✅ 核心卖点 | ✅ 可复用同思路 |
| 持久化 | 本地 JSON | 需另接持久化服务 |
| 用户群体 | 普通用户（非技术） | DSH 的 agent 用户 |

建议：独立桌面版继续面向普通用户；DSH 插件版面向「想在 DSH 里排期任务」的开发者，两者共享同一套「调度 + 零 token」设计。

---

## 六、已实现（v1 部署记录，2026 当前会话）

插件已用动态 Cordis 插件部署并跑通：**pluginId `chrono-1`，packageId `pkg-1`**（当前运行中）。

真实可用的关键 API（跟骨架伪代码不同，务必按这个写）：

- **工具注册**：`harness.defineTool({ name, description, parameters, output:{schema,render}, execute })` → `harness.registerTool(ctx, tool)`。`parameters` 用 per-property DSL（`{ type:'string', required:true, description }`），`output.schema` 用 ValueSchemaSpec（object 必须写 `additionalProperties:false`），`render` 返回 `[{ type:'text', text }]`。
- **到点执行**（零 token 的关键）：用 `ctx.timeout(cb, delay)`（`inject:['timer']`）挂定时器；到点后构造 `{ id, role:'user', content:[{type:'text',text}], source:{kind:'plugin', plugin:'chrono-agent'} }`，调 `agent.followup(message)` 唤醒**本会话 agent** 自动执行（`agent` 来自 `schedule_task` 的 `exec.agent`）。这是照 DSH 自带 `dsh-schedule` 包的 `runMaintenance`+`followup` 模式。
- **沙箱约束**：动态插件沙箱**没有** `setTimeout`/`AbortController`/`crypto`（所以不能直接 spawn 子代理），但 `Date`/`JSON`/`Math`/`Map` 等 ECMAScript 内建都在；`console.log` 带插件标签。
- **Client UI**：`inject:['slots']` 后 `ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id, order, label }, renderFn))`；`host.call('list-tasks')` 走 Package 私有 RPC。

三个模型工具：`schedule_task(text, at)`、`list_scheduled_tasks`、`cancel_scheduled_task(id)`。任务表是**进程内**的（动态插件不持久化），插件停止或进程重启即丢。

**v2（pkg-2，当前运行中）**：`schedule_task` 的 `at` 支持本地时刻 `"18:00"`（解析为下一次出现：今天已过则明天）、相对时长 `"30m"`/`"2h"`/`"1d"`、ISO 时间、秒数；新增可选 `repeat: "daily" | "weekly"`（到点后自动把 `at` 推后 1 天/7 天再挂定时器）。client 列表给重复任务加「每日重复/每周重复」徽章。`repeat` 同样依赖进程内定时器，进程重启即丢；要跨重启的永久队列需走静态 npm 包 + `session/append` 持久化事件（持久化路线，另做）。

**v3（pkg-3，当前运行中，健壮性加固）**：
1. **单一调度器 + 批量执行**：不再每个任务各挂一个 timer，改为 `reschedule()` 找最早到期任务挂一个 timer；到点 `drainDue()` 收集所有 `at <= now` 的任务**合并成一条消息**一次唤醒 agent（同刻多任务只跑一轮）。
2. **DST 安全的重复**：`"HH:MM"` 时刻存 `timeOfDay`，到点用 `setDate(+1/+7)` + `setHours` 日历算术重算下一次，不再硬加 `86400000ms`。
3. **清理**：新增 `clear_scheduled_tasks` 工具 + client「清除已完成」按钮，避免列表无限堆积。
4. **上次运行时间**：`lastFiredAt` 字段，重复任务显示「下次 + 上次」。
5. **liveness 检查**：`isLive(agent)`（`agents.get(id) === agent`），失败任务记 error。

**v4（pkg-4，当前运行中，修 bug + 会话级持久化）**：
1. **修崩溃 bug**：`repeat` 配绝对时间（非 `"HH:MM"`）时 `timeOfDay` 为 `null`，`nextOccurrence` 用 `!== undefined` 误判进入分支访问 `null.hh` 抛错。改成 `timeOfDay: null→undefined` + 判空用 `!= null`。
2. **会话级持久化**：create/cancel/dispatch/clear 每次变更都 `session.append('chrono/task', {op, ...})` 写进会话事件日志；任务不再只存内存。
3. **恢复**：插件激活后首次工具调用时 `recover(agent)` 从 `agent.session.events`（从 `header.seedLength` 起）折叠重建任务表、重挂定时器、续推 `seq`，过期 pending 立即补投。
4. **liveness 加 `roots()` 判断**，排除子代理等短暂 agent。

**仍存在的硬边界**：DSH 进程重启后动态插件本身消失（process-local），跨重启的任务+定时器仍丢；要「关机第二天开机仍在、自动补跑」必须走**静态 npm 包**（`dsh plugin` 装进部署、随 DSH 启动自动加载）。
