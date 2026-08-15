import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

// ChronoAgent — a durable, host-side scheduled-task agent.
//
// Tasks are persisted to the owning session's append-only event log under the
// `chrono/task` event type, so they survive plugin reloads and DSH restarts.
// On `agent/created`, a per-agent runtime folds that session's log, re-arms the
// next timer, and delivers any overdue tasks. Delivery wakes the owning agent
// with a `followup` message, so the agent executes the task with its own tools.

export const name = "chrono-agent";
export const inject = ["agents"];

const DAY_MS = 86400000;
const WEEK_MS = 604800000;
const MAX_DELAY = 2147483647;
const EVENT_TYPE = "chrono/task";

const TASK_VIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true },
    text: { type: "string", required: true },
    at: { type: "string", required: true },
    status: { type: "string", required: true, enum: ["pending", "dispatched", "failed", "cancelled"] },
    repeat: { type: "string", enum: ["daily", "weekly"] },
    lastFiredAt: { type: "string" },
    error: { type: "string" },
  },
};

function parseTimeOfDay(s) {
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m === null) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] === undefined ? 0 : Number(m[3]);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return { hh, mm, ss };
}

function nextTimeOfDay(tod, afterMs) {
  const d = new Date(afterMs);
  d.setHours(tod.hh, tod.mm, tod.ss, 0);
  if (d.getTime() <= afterMs) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function parseAt(value, now) {
  const s = String(value === undefined || value === null ? "" : value).trim();
  if (s === "") return NaN;
  if (/^\d+$/.test(s)) return now + Number(s) * 1000;
  const rel = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (rel !== null) {
    const n = Number(rel[1]);
    const u = rel[2].toLowerCase();
    const ms = u[0] === "s" ? n * 1000 : u[0] === "m" ? n * 60000 : u[0] === "h" ? n * 3600000 : n * DAY_MS;
    if (!Number.isFinite(ms) || ms <= 0) return NaN;
    return now + ms;
  }
  const tod = parseTimeOfDay(s);
  if (tod !== null) return nextTimeOfDay(tod, now);
  return Date.parse(s);
}

class ChronoRuntime {
  constructor(agent) {
    this.agent = agent;
    this.tasks = new Map();
    this.seq = 0;
    this.timer = null;
    this.stopping = false;
  }

  now() {
    return Date.now();
  }

  recordOf(task) {
    const r = { id: task.id, text: task.text, at: task.at, status: task.status };
    if (task.repeat !== undefined) r.repeat = task.repeat;
    if (task.timeOfDay != null) r.timeOfDay = task.timeOfDay;
    if (task.intervalMs !== undefined) r.intervalMs = task.intervalMs;
    if (task.lastFiredAt !== undefined) r.lastFiredAt = task.lastFiredAt;
    if (task.error !== undefined) r.error = task.error;
    return r;
  }

  persist(op, data) {
    try {
      this.agent.session.append(EVENT_TYPE, Object.assign({ op }, data));
    } catch (error) {
      console.error(`[chrono-agent] persist failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  taskView(task) {
    const view = { id: task.id, text: task.text, at: new Date(task.at).toISOString(), status: task.status };
    if (task.repeat !== undefined) view.repeat = task.repeat;
    if (task.lastFiredAt !== undefined) view.lastFiredAt = new Date(task.lastFiredAt).toISOString();
    if (task.error !== undefined) view.error = task.error;
    return view;
  }

  listView() {
    const out = [];
    this.tasks.forEach((task) => out.push(this.taskView(task)));
    return { tasks: out };
  }

  isLive() {
    return this.agent && !this.stopping;
  }

  fold() {
    const events = this.agent.session?.events;
    if (!Array.isArray(events)) return;
    try {
      const seedLen = this.agent.session.header && typeof this.agent.session.header.seedLength === "number"
        ? this.agent.session.header.seedLength
        : 0;
      for (let i = seedLen; i < events.length; i++) {
        const e = events[i];
        if (!e || e.type !== EVENT_TYPE) continue;
        const d = e.data;
        if (!d || typeof d !== "object") continue;
        if (d.op === "create" && d.task && typeof d.task.id === "string") {
          this.tasks.set(d.task.id, Object.assign({}, d.task));
        } else if (d.op === "cancel" && typeof d.id === "string") {
          const t = this.tasks.get(d.id);
          if (t) t.status = "cancelled";
        } else if (d.op === "dispatch" && typeof d.id === "string") {
          const t = this.tasks.get(d.id);
          if (t) {
            if (d.lastFiredAt !== undefined) t.lastFiredAt = d.lastFiredAt;
            if (d.status === "dispatched") t.status = "dispatched";
            else if (d.status === "failed") { t.status = "failed"; if (d.error !== undefined) t.error = d.error; }
            else if (typeof d.at === "number") { t.at = d.at; t.status = "pending"; }
          }
        } else if (d.op === "clear" && Array.isArray(d.ids)) {
          for (const id of d.ids) this.tasks.delete(id);
        }
      }
      let maxSeq = -1;
      this.tasks.forEach((t) => {
        const m = String(t.id).match(/^task-(\d+)$/);
        if (m && Number(m[1]) > maxSeq) maxSeq = Number(m[1]);
      });
      if (maxSeq + 1 > this.seq) this.seq = maxSeq + 1;
    } catch (error) {
      console.error(`[chrono-agent] recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  dueTasks() {
    const t = this.now();
    const due = [];
    this.tasks.forEach((task) => {
      if (task.status === "pending" && task.at <= t) due.push(task);
    });
    due.sort((a, b) => a.at - b.at);
    return due;
  }

  nextOccurrence(task) {
    if (task.timeOfDay != null) {
      const step = task.repeat === "weekly" ? 7 : 1;
      const d = new Date(task.at);
      d.setDate(d.getDate() + step);
      d.setHours(task.timeOfDay.hh, task.timeOfDay.mm, task.timeOfDay.ss, 0);
      return d.getTime();
    }
    return task.at + task.intervalMs;
  }

  reschedule() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    let earliest;
    this.tasks.forEach((task) => {
      if (task.status !== "pending") return;
      if (earliest === undefined || task.at < earliest.at) earliest = task;
    });
    if (earliest === undefined) return;
    const remaining = Math.max(0, earliest.at - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, Math.min(remaining, MAX_DELAY));
  }

  drain() {
    const due = this.dueTasks();
    if (due.length === 0) { this.reschedule(); return; }
    if (!this.isLive()) {
      due.forEach((task) => {
        task.status = "failed";
        task.error = "owning agent is no longer live";
        this.persist("dispatch", { id: task.id, status: "failed", error: task.error });
      });
      this.reschedule();
      return;
    }
    let text;
    if (due.length === 1) {
      text = "[SCHEDULED TASK - execute now]\nA task scheduled earlier is now due. Execute it using your available tools, then report what you did and the result.\n\nTask:\n" + due[0].text;
    } else {
      const parts = due.map((task, i) => `${i + 1}. ${task.text}`);
      text = `[SCHEDULED TASKS - execute now]\n${due.length} scheduled tasks are now due. Execute each one using your available tools, then report what you did and the results.\n\nTasks:\n${parts.join("\n")}`;
    }
    try {
      const message = createUserMessage({
        content: [{ type: "text", text }],
        source: { kind: "plugin", plugin: "chrono-agent" },
      });
      due.forEach((task) => {
        task.lastFiredAt = this.now();
        if (task.repeat === undefined) {
          task.status = "dispatched";
          this.persist("dispatch", { id: task.id, status: "dispatched", lastFiredAt: task.lastFiredAt });
        } else {
          task.at = this.nextOccurrence(task);
          task.status = "pending";
          this.persist("dispatch", { id: task.id, status: "pending", at: task.at, lastFiredAt: task.lastFiredAt });
        }
      });
      this.agent.followup(message);
      console.log(`[chrono-agent] dispatched ${due.length} scheduled task(s)`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      due.forEach((task) => {
        task.status = "failed";
        task.error = msg;
        this.persist("dispatch", { id: task.id, status: "failed", error: msg });
      });
      console.error(`[chrono-agent] dispatch failed: ${msg}`);
    }
    this.reschedule();
  }

  start() {
    this.fold();
    this.reschedule();
  }

  dispose() {
    this.stopping = true;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }
}

function registerTools(agent, runtime) {
  const disposers = [];
  const requireAgent = (exec) => {
    if (exec.agent !== agent) throw new Error("scheduled task tools are scoped to their owning session");
  };

  disposers.push(agent.ctx.tools.register(defineTool({
    name: "schedule_task",
    description: "Schedule a task to be executed automatically at a future time, without consuming tokens until then. Tasks due at the same time are executed together in one agent turn. Tasks are persisted to the session log and survive DSH restarts; overdue tasks run when this session is resumed. \"at\" accepts an ISO 8601 date-time (e.g. 2026-01-01T18:00:00Z), a bare local time-of-day \"HH:MM\" (e.g. \"18:00\", resolved to the next occurrence), a relative duration (\"30m\", \"2h\", \"1d\"), or a number of seconds from now (\"3600\"). Optional \"repeat\" re-runs the task every day (\"daily\") or every week (\"weekly\") at the same time.",
    parameters: {
      text: { type: "string", required: true, description: "The task to execute at the due time. Be specific and self-contained: what to do and what result to report." },
      at: { type: "string", required: true, description: "When to execute: ISO 8601 date-time, local time \"HH:MM\", a relative duration like \"2h\", or seconds from now as a string." },
      repeat: { type: "string", enum: ["daily", "weekly"], description: "Optional. Re-run this task every day (\"daily\") or every week (\"weekly\") at the same time." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true },
          text: { type: "string", required: true },
          at: { type: "string", required: true },
          status: { type: "string", required: true, const: "pending" },
          repeat: { type: "string", enum: ["daily", "weekly"] },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Scheduled task ${value.id} for ${value.at}${value.repeat ? ` (repeat: ${value.repeat})` : ""}:\n${value.text}` }],
    },
    execute(args, exec) {
      requireAgent(exec);
      const text = String(args.text || "").trim();
      if (text.length === 0) throw new Error("text must be a non-empty task description");
      const repeat = args.repeat === undefined ? undefined : String(args.repeat);
      if (repeat !== undefined && repeat !== "daily" && repeat !== "weekly") throw new Error("repeat must be \"daily\" or \"weekly\"");
      const s = String(args.at === undefined || args.at === null ? "" : args.at).trim();
      const tod = parseTimeOfDay(s);
      const fireAt = parseAt(args.at, runtime.now());
      if (!Number.isFinite(fireAt)) throw new Error("at must be an ISO date-time, \"HH:MM\", a relative duration like \"2h\", or seconds from now");
      if (fireAt <= runtime.now()) throw new Error("at must be strictly in the future");
      const id = `task-${runtime.seq++}`;
      const task = {
        id,
        text,
        at: fireAt,
        status: "pending",
        repeat,
        intervalMs: repeat === "daily" ? DAY_MS : WEEK_MS,
        timeOfDay: tod == null ? undefined : tod,
      };
      runtime.tasks.set(id, task);
      runtime.persist("create", { task: runtime.recordOf(task) });
      runtime.reschedule();
      const out = { id, text, at: new Date(fireAt).toISOString(), status: "pending" };
      if (repeat !== undefined) out.repeat = repeat;
      return out;
    },
  })));

  disposers.push(agent.ctx.tools.register(defineTool({
    name: "list_scheduled_tasks",
    description: "List every scheduled task in the current session with its id, text, due time, optional repeat rule, last fired time, and status (pending, dispatched, failed, or cancelled).",
    parameters: {},
    output: {
      schema: { type: "object", additionalProperties: false, properties: { tasks: { type: "array", required: true, items: TASK_VIEW_SCHEMA } } },
      render: (_args, value) => value.tasks.length === 0
        ? [{ type: "text", text: "No scheduled tasks." }]
        : [{ type: "text", text: JSON.stringify(value.tasks, null, 2) }],
    },
    execute(_args, exec) {
      requireAgent(exec);
      return runtime.listView();
    },
  })));

  disposers.push(agent.ctx.tools.register(defineTool({
    name: "cancel_scheduled_task",
    description: "Cancel a scheduled task by its exact id (returned by schedule_task or list_scheduled_tasks). For a recurring task this stops all future runs. Tasks that are already dispatched, failed, or cancelled return cancelled false.",
    parameters: { id: { type: "string", required: true, description: "Exact task id." } },
    output: {
      schema: { type: "object", additionalProperties: false, properties: { id: { type: "string", required: true }, cancelled: { type: "boolean", required: true } } },
      render: (_args, value) => [{ type: "text", text: value.cancelled ? `Cancelled task ${value.id}.` : `Task ${value.id} was not pending (or does not exist).` }],
    },
    execute(args, exec) {
      requireAgent(exec);
      const id = String(args.id || "");
      const task = runtime.tasks.get(id);
      if (task === undefined || task.status !== "pending") return { id, cancelled: false };
      task.status = "cancelled";
      runtime.persist("cancel", { id });
      runtime.reschedule();
      return { id, cancelled: true };
    },
  })));

  disposers.push(agent.ctx.tools.register(defineTool({
    name: "clear_scheduled_tasks",
    description: "Remove all finished scheduled tasks (dispatched, failed, or cancelled) from the current session list, keeping only pending tasks.",
    parameters: {},
    output: {
      schema: { type: "object", additionalProperties: false, properties: { cleared: { type: "integer", required: true } } },
      render: (_args, value) => [{ type: "text", text: `Cleared ${value.cleared} finished scheduled task(s).` }],
    },
    execute(_args, exec) {
      requireAgent(exec);
      const ids = [];
      runtime.tasks.forEach((task) => {
        if (task.status === "dispatched" || task.status === "failed" || task.status === "cancelled") ids.push(task.id);
      });
      for (const id of ids) runtime.tasks.delete(id);
      if (ids.length > 0) runtime.persist("clear", { ids });
      return { cleared: ids.length };
    },
  })));

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const dispose of disposers.reverse()) dispose();
  };
}

export function apply(ctx) {
  const runtimes = new Map();
  ctx.effect(() => {
    const stopCreated = ctx.on("agent/created", ({ agent }) => {
      if (runtimes.has(agent) || !ctx.agents.roots().includes(agent)) return;
      const runtime = new ChronoRuntime(agent);
      const cleanup = agent.ctx.effect(() => {
        const disposeTools = registerTools(agent, runtime);
        const stopStatus = agent.ctx.on("agent/status", ({ status }) => {
          if (status === "idle" && agent.session.events.some((e) => e.type === EVENT_TYPE)) runtime.reschedule();
        });
        runtime.start();
        return async () => {
          stopStatus();
          disposeTools();
          runtime.dispose();
          if (runtimes.get(agent) === cleanup) runtimes.delete(agent);
        };
      }, "chrono-agent.runtime");
      runtimes.set(agent, cleanup);
    });
    return async () => {
      stopCreated();
      const cleanups = [...runtimes.values()];
      runtimes.clear();
      await Promise.allSettled(cleanups.map((cleanup) => Promise.resolve(cleanup())));
    };
  }, "chrono-agent.lifecycle");
}
