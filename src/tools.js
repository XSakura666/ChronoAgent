const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_URL_BYTES = 1 * 1024 * 1024;
const CMD_TIMEOUT_MS = 120000;

function resolvePath(workspaceDir, p) {
  if (!p) return workspaceDir;
  return path.isAbsolute(p) ? p : path.resolve(workspaceDir, p);
}

async function tool_list_files(args, ctx) {
  const dir = resolvePath(ctx.workspaceDir, args.path);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return '读取目录失败：' + e.message;
  }
  const rows = entries.map(en => {
    let size = '';
    if (en.isFile()) {
      try { size = ' ' + fs.statSync(path.join(dir, en.name)).size + 'B'; } catch (e) {}
    }
    return (en.isDirectory() ? '[目录] ' : '[文件] ') + en.name + size;
  });
  return rows.length ? rows.join('\n') : '(空目录)';
}

async function tool_read_file(args, ctx) {
  const p = resolvePath(ctx.workspaceDir, args.path);
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    return '读取文件失败：' + e.message;
  }
  let truncated = false;
  if (buf.length > MAX_READ_BYTES) { buf = buf.subarray(0, MAX_READ_BYTES); truncated = true; }
  if (buf.includes(0)) {
    return '(二进制文件，无法按文本显示，大小 ' + buf.length + 'B)';
  }
  let text = buf.toString('utf8');
  return text + (truncated ? '\n...(内容过长已截断)' : '');
}

async function tool_write_file(args, ctx) {
  const p = resolvePath(ctx.workspaceDir, args.path);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(args.content != null ? args.content : ''), 'utf8');
  } catch (e) {
    return '写入文件失败：' + e.message;
  }
  return '已写入文件：' + p;
}

async function tool_fetch_url(args, ctx) {
  let url = String(args.url || '');
  if (!/^https?:\/\//i.test(url)) return '仅支持 http/https 链接';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    let res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    let redirects = 0;
    while ([301, 302, 303, 307, 308].includes(res.status) && redirects < 5) {
      const loc = res.headers.get('location');
      if (!loc) break;
      url = new URL(loc, url).toString();
      if (!/^https?:\/\//i.test(url)) return '重定向到非 http/https 地址，已拒绝';
      res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
      redirects++;
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) return '重定向次数过多，已停止';
    const lenHeader = Number(res.headers.get('content-length') || 0);
    if (lenHeader > MAX_URL_BYTES) return '内容过大（约 ' + lenHeader + ' 字节），已跳过下载';
    let text = await res.text();
    if (text.length > MAX_URL_BYTES) text = text.slice(0, MAX_URL_BYTES) + '\n...(内容过长已截断)';
    return 'HTTP ' + res.status + '\n' + text;
  } catch (e) {
    return '抓取失败：' + e.message;
  } finally {
    clearTimeout(timer);
  }
}

async function tool_run_command(args, ctx) {
  if (!ctx.settings || !ctx.settings.allowShell) return '未开启“允许执行命令”权限，无法执行。';
  const cmd = String(args.command || '');
  return new Promise((resolve) => {
    exec(cmd, {
      cwd: ctx.workspaceDir,
      timeout: CMD_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 5,
      windowsHide: true
    }, (err, stdout, stderr) => {
      if (err && err.killed) return resolve('命令超时被终止');
      let out = '';
      if (stdout) out += stdout;
      if (stderr) out += (out ? '\n[stderr]\n' : '[stderr]\n') + stderr;
      if (err && !out) out = '退出码 ' + err.code + '：' + err.message;
      resolve(out || (err ? '命令执行失败：' + err.message : '(无输出)'));
    });
  });
}

async function tool_http_request(args, ctx) {
  const method = String(args.method || 'GET').toUpperCase();
  const url = String(args.url || '');
  if (!/^https?:\/\//i.test(url)) return '仅支持 http/https 链接';
  let headers = {};
  if (args.headers !== undefined) {
    if (typeof args.headers === 'object' && args.headers !== null) headers = args.headers;
    else { try { headers = JSON.parse(String(args.headers)); } catch (e) {} }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const opts = { method, signal: ctrl.signal, headers };
    if (method !== 'GET' && method !== 'HEAD' && args.body !== undefined) {
      opts.body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
    }
    const res = await fetch(url, opts);
    let text = await res.text();
    if (text.length > MAX_URL_BYTES) text = text.slice(0, MAX_URL_BYTES) + '\n...(内容过长已截断)';
    return 'HTTP ' + res.status + '\n' + text;
  } catch (e) {
    return '请求失败：' + e.message;
  } finally {
    clearTimeout(timer);
  }
}

async function tool_ask_model(args, ctx) {
  const s = ctx.settings || {};
  const baseUrl = (s.auxBaseUrl || s.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '') + '/chat/completions';
  const apiKey = s.auxApiKey || s.apiKey || '';
  const model = s.auxModel || s.model || 'deepseek-chat';
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return '缺少 prompt';
  if (!apiKey) return '未配置 API Key（主或辅助），无法调用模型';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] })
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { return '响应不是有效 JSON（HTTP ' + res.status + '）'; }
    if (!res.ok) {
      const msg = json && json.error && json.error.message ? json.error.message : text.slice(0, 300);
      return '模型调用失败 HTTP ' + res.status + '：' + msg;
    }
    const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return content || '(无返回内容)';
  } catch (e) {
    return '模型调用失败：' + e.message;
  } finally {
    clearTimeout(timer);
  }
}

async function tool_memory_search(args, ctx) {
  if (!ctx.memorySearch) return '记忆功能不可用';
  const query = String(args.query || '').trim();
  const entries = ctx.memorySearch(query);
  if (!entries || !entries.length) return '没有找到相关记忆。';
  const lines = entries.map((e, i) => {
    const t = new Date(e.finishedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const tag = e.status === 'failed' ? '失败' : '完成';
    const text = String(e.text || '').replace(/\s+/g, ' ').trim();
    const summary = text.length > 60 ? text.slice(0, 60) + '…' : text;
    return `${i + 1}. [${tag}] ${summary}（${t}） id=${e.id}`;
  });
  return lines.join('\n') + '\n\n（要看某条的完整结果，用 memory_get 工具，传入上面的 id）';
}

async function tool_memory_get(args, ctx) {
  if (!ctx.memoryGet) return '记忆功能不可用';
  const id = String(args.id || '').trim();
  if (!id) return '缺少 id';
  const detail = ctx.memoryGet(id);
  return detail || '未找到该记忆（id=' + id + '）';
}

const BASE_DEFS = [
  { type: 'function', function: { name: 'list_files', description: '列出目录内容。path 省略时列出工作目录。', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录绝对路径（可选）' } } } } },
  { type: 'function', function: { name: 'read_file', description: '读取文本文件内容。', parameters: { type: 'object', properties: { path: { type: 'string', description: '文件绝对路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: '把文本写入文件（覆盖已有内容）。', parameters: { type: 'object', properties: { path: { type: 'string', description: '文件绝对路径' }, content: { type: 'string', description: '要写入的完整文本内容' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'fetch_url', description: '抓取网页/URL 的文本内容。', parameters: { type: 'object', properties: { url: { type: 'string', description: 'http/https 地址' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'http_request', description: '向任意 http/https 地址发起 HTTP 请求（可指定方法、headers、body），用于调用外部服务/API。', parameters: { type: 'object', properties: { method: { type: 'string', description: 'HTTP 方法，默认 GET' }, url: { type: 'string', description: '目标地址' }, headers: { type: 'object', description: '请求头（可选，JSON 对象）' }, body: { type: 'string', description: '请求体（POST/PUT 时用，字符串）' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'ask_model', description: '把一个问题交给另一个模型（默认用辅助模型，未配置则用主模型）做一次独立问答，返回结果。可用于多模型分工、翻译、总结等子任务。', parameters: { type: 'object', properties: { prompt: { type: 'string', description: '要交给另一个模型的问题/任务' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'memory_search', description: '搜索历史记忆的目录索引（只返回任务摘要+id，不含完整结果，省 token），用于查找之前做过的工作。query 用空格分隔的关键词。', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词（空格分隔）' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'memory_get', description: '按 id 取某条记忆的完整结果（先 memory_search 拿到 id，再用它取详情）。', parameters: { type: 'object', properties: { id: { type: 'string', description: '记忆条目 id（由 memory_search 返回）' } }, required: ['id'] } } }
];

const SHELL_DEF = { type: 'function', function: { name: 'run_command', description: '在电脑上执行一条命令行（需开启权限）。', parameters: { type: 'object', properties: { command: { type: 'string', description: '要执行的命令' } }, required: ['command'] } } };

function buildToolDefs(settings) {
  const defs = BASE_DEFS.slice();
  if (settings && settings.allowShell) defs.push(SHELL_DEF);
  return defs;
}

async function executeTool(name, args, ctx) {
  switch (name) {
    case 'list_files': return tool_list_files(args, ctx);
    case 'read_file': return tool_read_file(args, ctx);
    case 'write_file': return tool_write_file(args, ctx);
    case 'fetch_url': return tool_fetch_url(args, ctx);
    case 'http_request': return tool_http_request(args, ctx);
    case 'ask_model': return tool_ask_model(args, ctx);
    case 'memory_search': return tool_memory_search(args, ctx);
    case 'memory_get': return tool_memory_get(args, ctx);
    case 'run_command': return tool_run_command(args, ctx);
    default: return '未知工具：' + name;
  }
}

module.exports = { buildToolDefs, executeTool };
