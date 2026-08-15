<div align="center">

# ⏰ ChronoAgent

**Schedule AI agents like cron jobs. Zero token cost until they run.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/XSakura666/ChronoAgent)](https://github.com/XSakura666/ChronoAgent/releases)
[![Downloads](https://img.shields.io/github/downloads/XSakura666/ChronoAgent/total)](https://github.com/XSakura666/ChronoAgent/releases)

*Write a task now, set a time, and the agent does the work later — automatically.*

<!-- TODO: 30s demo GIF here. Show: write task → set time → agent writes a file when the timer fires -->

</div>

## ✨ What is ChronoAgent?

ChronoAgent is a **local-first desktop app** that turns your backlog into **scheduled AI agent runs**.

Describe a task in plain text, pick a time, and forget it. **Until that moment, ChronoAgent makes zero API calls and costs you zero tokens.** When the time comes, it wakes up and runs an AI agent that can read/write files, browse the web, and call any tool you connect via MCP.

```
scheduler = director · your AI model = brain · your tools = hands
```

## 🚀 Features

- ⏰ **Scheduled execution** — tasks run automatically at the time you set
- 💸 **Zero cost before execution** — no API calls, no token spend until the timer fires
- 🤖 **Agentic execution** — the agent plans, calls tools, and completes multi-step tasks
- 🧩 **Bring your own model** — any OpenAI-compatible API (DeepSeek, OpenAI, Ollama, Qwen…)
- 🔌 **Bring your own tools (MCP)** — connect any MCP server: filesystem, GitHub, databases…
- 📦 **Local-first & private** — tasks and results stay on your machine
- 🔁 **Recurring tasks** — daily / weekly / monthly
- 🪶 **Batch execution** — merge tasks due at the same time into one call (saves tokens)
- 🖥️ **Runs in the background** — tray-resident, auto-start, catches up missed tasks
- 🧠 **Memory catalog** — every run auto-archives to a searchable, token-efficient index, so repeat or related tasks can pick up where they left off
- 🤝 **Call other AI & services** — `ask_model` delegates to a second model, `http_request` calls any HTTP API
- 🔐 **Encrypted API keys** — stored encrypted with the OS keychain (DPAPI), never plaintext on disk

## 🧩 DeepSeek Harness plugin

ChronoAgent is also available as a **DeepSeek Harness (DSH) plugin** — a host-side scheduled-task agent with the same zero-cost-until-run model, persisted to the session log and recovered across restarts.

See [`dsh-chrono-agent/`](dsh-chrono-agent) for the plugin source and install guide.

## 🎬 Demo

<!-- TODO: record a 30-second screen capture and drop the GIF link here. -->

## 🧰 Installation

### Download (no Node.js required)

Get the latest build from [Releases](https://github.com/XSakura666/ChronoAgent/releases):

| File | Type |
|---|---|
| `ChronoAgent Setup.exe` | Installer — creates a desktop shortcut |
| `ChronoAgent.exe` | Portable — double-click to run |

> Windows may show a "SmartScreen" warning (unsigned build). Click **More info → Run anyway**.

### Build from source

```bash
git clone https://github.com/XSakura666/ChronoAgent.git
cd ChronoAgent
npm install
npm start
```

## 🚦 Quick Start

1. **Add your model** — Settings → enter your API base URL + key (a one-click DeepSeek preset is included)
2. **Write a task** — e.g. *"Write a 500-word product intro and save it to `intro.md`"*
3. **Pick a time** — use a quick preset (1 hour, tonight 20:00…) and hit **Add**
4. **Done** — the agent runs at the scheduled time. View results in the task card, or open the workspace folder to see generated files.

## 🔌 Connect your own tools with MCP

ChronoAgent is an **MCP client**. Connect any [MCP server](https://modelcontextprotocol.io) in **Settings → MCP servers**:

| Tool | Command | Args |
|---|---|---|
| Filesystem | `npx` | `-y @modelcontextprotocol/server-filesystem D:\data` |
| GitHub | `npx` | `-y @modelcontextprotocol/server-github` |

## 🏗️ Architecture

```
┌───────────────────────────────────────────────────┐
│                    ChronoAgent                    │
│                                                   │
│   Scheduler          AI Model           Tools      │
│   (director)         (brain)            (hands)    │
│   · timer            · any OpenAI-      · built-ins │
│   · zero cost        compatible model   · MCP      │
│     until run                            · shell   │
└───────────────────────────────────────────────────┘
```

## 🧭 Roadmap

- [ ] Voice input (local transcription — stays zero-cost)
- [ ] MCP template marketplace
- [ ] Code signing (remove SmartScreen warning)
- [ ] Linux / macOS builds

## 🤝 Contributing

Pull requests and ideas are welcome.

## 📄 License

[MIT](LICENSE)
