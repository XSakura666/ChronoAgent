const { spawn } = require('child_process');

const INIT_TIMEOUT_MS = 30000;

function safeName(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'server';
}

function mcpResultToText(res) {
  if (res && Array.isArray(res.content)) {
    const texts = res.content.filter(c => c && c.type === 'text').map(c => c.text);
    if (texts.length) return texts.join('\n');
    return JSON.stringify(res.content);
  }
  if (res && res.isError) return 'MCP 工具返回错误：' + JSON.stringify(res);
  return JSON.stringify(res == null ? '' : res);
}

// 单个 MCP stdio 服务器连接
class McpConnection {
  constructor(config) {
    this.config = config;
    this.proc = null;
    this.tools = [];
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.stderrTail = '';
    this.ready = false;
  }

  write(obj) {
    if (this.proc && this.proc.stdin && this.proc.stdin.writable) {
      this.proc.stdin.write(JSON.stringify(obj) + '\n');
    }
  }

  request(method, params, timeoutMs = INIT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('MCP 请求超时：' + method + (this.stderrTail ? '\n服务器输出：' + this.stderrTail.slice(-500) : '')));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.write({ jsonrpc: '2.0', id, method, params: params || {} });
    });
  }

  handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return; }
    if (msg && msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }

  rejectAll(msg) {
    for (const [, p] of this.pending) { try { p.reject(new Error(msg)); } catch (e) {} }
    this.pending.clear();
  }

  async start() {
    const cfg = this.config;
    await new Promise((resolve, reject) => {
      this.proc = spawn(cfg.command, cfg.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        env: Object.assign({}, process.env, cfg.env || {})
      });
      this.proc.on('error', (e) => {
        this.ready = false;
        this.rejectAll('无法启动 MCP 进程：' + e.message);
        reject(new Error('无法启动 MCP 进程（' + cfg.command + '）：' + e.message));
      });
      this.proc.on('spawn', () => resolve());
      this.proc.stdout.on('data', (d) => {
        this.buf += d.toString('utf8');
        let idx;
        while ((idx = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, idx).trim();
          this.buf = this.buf.slice(idx + 1);
          if (line) this.handleLine(line);
        }
      });
      this.proc.stderr.on('data', (d) => {
        this.stderrTail = (this.stderrTail + d.toString('utf8')).slice(-2000);
      });
      this.proc.on('exit', () => {
        this.ready = false;
        this.rejectAll('MCP 进程已退出');
      });
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'scheduled-agent', version: '0.2.0' }
    });
    this.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.ready = true;
  }

  async listTools() {
    const r = await this.request('tools/list', {});
    return (r && r.tools) || [];
  }

  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args || {} });
  }

  stop() {
    this.ready = false;
    if (this.proc) { try { this.proc.kill(); } catch (e) {} this.proc = null; }
    this.rejectAll('MCP 已断开');
  }
}

class McpManager {
  constructor(configs) {
    this.conns = (configs || []).map(c => new McpConnection(c));
    this.toolDefs = [];
    this.toolMap = {};
  }

  async connectAll() {
    const results = [];
    for (const c of this.conns) {
      try {
        await c.start();
        c.tools = await c.listTools();
        results.push({ ok: true, name: c.config.name, toolCount: c.tools.length });
      } catch (e) {
        results.push({ ok: false, name: c.config.name, error: String(e && e.message ? e.message : e) });
      }
    }
    this.buildToolMap();
    return results;
  }

  buildToolMap() {
    const defs = [];
    const map = {};
    for (const c of this.conns) {
      if (!c.ready) continue;
      for (const t of c.tools) {
        const full = 'mcp__' + safeName(c.config.name) + '__' + safeName(t.name);
        map[full] = { conn: c, toolName: t.name };
        defs.push({
          type: 'function',
          function: {
            name: full,
            description: '[MCP·' + c.config.name + '] ' + (t.description || t.name),
            parameters: (t.inputSchema && typeof t.inputSchema === 'object') ? t.inputSchema : { type: 'object', properties: {} }
          }
        });
      }
    }
    this.toolDefs = defs;
    this.toolMap = map;
  }

  getToolDefs() {
    return this.toolDefs || [];
  }

  async callTool(fullName, args) {
    const entry = this.toolMap && this.toolMap[fullName];
    if (!entry) throw new Error('未知 MCP 工具：' + fullName);
    const res = await entry.conn.callTool(entry.toolName, args);
    return mcpResultToText(res);
  }

  disconnectAll() {
    for (const c of this.conns) c.stop();
  }
}

module.exports = { McpManager, mcpResultToText };
