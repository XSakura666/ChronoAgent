# ⏰ ChronoAgent（待命智能体）

**把 AI agent 像定时任务一样排期。到点前零 token，到点后自动执行。**

一个 Windows 桌面应用：提前把任务录进去、设定执行时间，到点前不碰 AI（零 token），到点后智能体自动把攒下的任务做完。

> 英文版见 [README.md](README.md)

## 已实现功能

- ⏰ 定时执行，**到点前零 token**
- 🤖 智能体工具循环（读写文件、列目录、抓网页、可选执行命令）
- 🧩 自填任意 OpenAI 兼容模型（DeepSeek / OpenAI / Ollama / 通义）
- 🔌 **MCP 协议接入任意第三方工具**
- 🔁 重复任务（每天 / 每周 / 每月）
- 🪶 多条任务合并执行省 token
- 🖥️ 后台驻留 + 开机自启 + 错过补跑
- 📦 本地存储，隐私安全

## 快速开始

1. 下载 `release\` 里的 exe（绿色版双击即用 / 安装版装完有桌面快捷方式）
2. 「设置」里填 API Key（可一键填入 DeepSeek + 测试连接）
3. 写任务 → 选时间 → 到点自动执行

## 接入 MCP 工具

设置 → MCP 工具服务器，填「名称 + 命令 + 参数」：

| 工具 | 命令 | 参数 |
|---|---|---|
| 文件系统 | `npx` | `-y @modelcontextprotocol/server-filesystem D:\data` |
| GitHub | `npx` | `-y @modelcontextprotocol/server-github` |

## 架构

**调度器 = 导演，AI 模型 = 大脑，工具 = 手脚。**

## 从源码运行

```bash
npm install
npm start
```

## 打包

```bash
npm install --save-dev electron-builder
npm run dist
```
