const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./src/store');
const ai = require('./src/ai');
const Scheduler = require('./src/scheduler');
const { McpManager } = require('./src/mcp');
const memory = require('./src/memory');

const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  auxBaseUrl: '',     // 辅助模型 baseUrl（ask_model 用，可选）
  auxApiKey: '',      // 辅助模型 API Key（可选）
  auxModel: '',       // 辅助模型名称（可选）
  systemPrompt: '',
  background: true,   // 关闭窗口后驻留托盘
  autoStart: true,    // 开机自启
  allowShell: false,  // 是否允许执行命令（危险）
  catchUp: true,      // 错过的时间是否补跑
  mergeBatch: true,   // 多条到期任务合并成一次执行（省 token）
  mcpServers: []      // MCP 工具服务器配置
};

let win = null;
let tray = null;
let store = null;
let scheduler = null;
let mcp = null;
let isQuitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });
  app.whenReady().then(init);
}

function init() {
  store = new Store(path.join(app.getPath('userData'), 'data.json'));
  applyAutoStart();
  createWindow();
  createTray();
  setupIpc();
  reconnectMcp();
  scheduler = new Scheduler({
    store,
    runDue: runDue,
    onUpdate: broadcast,
    isCatchUp: () => getSettings().catchUp
  });
  scheduler.start();
  // 启动时补跑错过的任务
  scheduler.tick();
}

function getSettings() {
  if (!store) return Object.assign({}, DEFAULT_SETTINGS);
  const s = Object.assign({}, DEFAULT_SETTINGS, store.data.settings || {});
  for (const key of ['apiKey', 'auxApiKey']) {
    if (!s[key] && s[key + 'Enc']) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          s[key] = safeStorage.decryptString(Buffer.from(s[key + 'Enc'], 'base64'));
        }
      } catch (e) {}
    }
  }
  return s;
}

function encryptSecret(plain) {
  const v = String(plain == null ? '' : plain);
  if (!v) return { value: '', enc: '' };
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { value: '', enc: safeStorage.encryptString(v).toString('base64') };
    }
  } catch (e) {}
  return { value: v, enc: '' };
}

function workspaceDir() {
  const dir = path.join(app.getPath('userData'), 'workspace');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

function iconPath() {
  const p = path.join(__dirname, 'assets', 'icon.png');
  return fs.existsSync(p) ? p : null;
}

function getState() {
  return { tasks: store.data.tasks, settings: getSettings(), memory: memory.recent(store, 50), workspace: workspaceDir(), now: Date.now(), mcpToolCount: getMcpTools().length };
}

function broadcast() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('state:update', getState());
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; if (store) store.save(); }, 500);
}
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (store) store.save();
}

function getMcpTools() {
  return mcp ? mcp.getToolDefs() : [];
}

function memorySearch(query) {
  return memory.search(store, query, 10);
}

function memoryGet(id) {
  return memory.formatDetail(memory.getById(store, id));
}

function memoryContext() {
  return memory.formatIndex(memory.recent(store, 8));
}

function callMcp(name, args) {
  if (!mcp) return Promise.reject(new Error('MCP 不可用'));
  return mcp.callTool(name, args);
}

async function reconnectMcp() {
  if (mcp) { try { mcp.disconnectAll(); } catch (e) {} }
  const servers = getSettings().mcpServers || [];
  mcp = new McpManager(servers);
  try {
    const results = await mcp.connectAll();
    const okCount = results.filter(r => r.ok).length;
    console.log('MCP 连接结果：', JSON.stringify(results));
    if (okCount) notify('MCP 已连接', okCount + ' 个工具服务器就绪');
  } catch (e) {
    console.error('MCP 连接失败：', e);
  }
  broadcast();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    title: '待命智能体',
    icon: iconPath() || undefined,
    backgroundColor: '#0f1420',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (!isQuitting && getSettings().background) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const p = iconPath();
  const img = p ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
  if (img.isEmpty()) return;
  tray = new Tray(img);
  tray.setToolTip('待命智能体');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: () => { if (win) { win.show(); win.focus(); } } },
    { label: '立即检查任务', click: () => { if (scheduler) scheduler.tick(); } },
    { label: '打开工作目录', click: () => shell.openPath(workspaceDir()) },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
}

function setupIpc() {
  ipcMain.handle('app:getState', () => getState());

  ipcMain.handle('tasks:add', (e, payload) => {
    const text = String((payload && payload.text) || '').trim();
    if (!text) return { ok: false, error: '任务内容不能为空' };
    const task = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text,
      createdAt: Date.now(),
      scheduledAt: (payload && payload.scheduledAt) ? Number(payload.scheduledAt) : Date.now(),
      repeat: (payload && payload.repeat) || '',
      lastRun: null,
      status: 'pending',
      result: '',
      logs: []
    };
    store.data.tasks.unshift(task);
    store.save();
    broadcast();
    return { ok: true, task };
  });

  ipcMain.handle('tasks:update', (e, payload) => {
    if (!payload || typeof payload.id !== 'string') return { ok: false };
    const t = store.data.tasks.find(x => x.id === payload.id);
    if (!t) return { ok: false };
    if (payload.text !== undefined) t.text = String(payload.text).trim();
    if (payload.scheduledAt !== undefined) t.scheduledAt = Number(payload.scheduledAt);
    if (payload.repeat !== undefined) t.repeat = String(payload.repeat || '');
    store.save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('tasks:delete', (e, id) => {
    store.data.tasks = store.data.tasks.filter(x => x.id !== id);
    store.save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('tasks:runNow', (e, id) => {
    const t = store.data.tasks.find(x => x.id === id);
    if (!t) return { ok: false };
    runTask(t);
    return { ok: true };
  });

  ipcMain.handle('settings:set', async (e, patch) => {
    const prevMcp = JSON.stringify((store.data.settings && store.data.settings.mcpServers) || []);
    const s = getSettings();
    const allowed = ['baseUrl', 'model', 'systemPrompt', 'background', 'autoStart', 'allowShell', 'catchUp', 'mergeBatch', 'mcpServers', 'auxBaseUrl', 'auxModel'];
    if (patch && typeof patch === 'object') {
      for (const k of allowed) if (patch[k] !== undefined) s[k] = patch[k];
      if (patch.apiKey !== undefined) s.apiKey = String(patch.apiKey);
      if (patch.auxApiKey !== undefined) s.auxApiKey = String(patch.auxApiKey);
    }
    // 明文 key 永不落盘：统一在保存前加密（含“未改 key 但保存其它设置”的场景）
    for (const key of ['apiKey', 'auxApiKey']) {
      if (s[key]) {
        const enc = encryptSecret(s[key]);
        s[key] = enc.value;
        s[key + 'Enc'] = enc.enc;
      } else {
        s[key + 'Enc'] = '';
      }
    }
    store.data.settings = s;
    store.save();
    applyAutoStart();
    if (JSON.stringify(s.mcpServers || []) !== prevMcp) {
      await reconnectMcp();
    }
    broadcast();
    return { ok: true, settings: getSettings() };
  });

  ipcMain.handle('ai:test', async (e, patch) => {
    const settings = Object.assign({}, getSettings(), patch || {});
    if (!settings.apiKey) return { ok: false, error: '请先填写 API Key' };
    try {
      const r = await ai.testConnection(settings);
      return { ok: true, reply: r.reply };
    } catch (err) {
      return { ok: false, error: String((err && err.message) ? err.message : err) };
    }
  });

  ipcMain.handle('shell:openWorkspace', () => shell.openPath(workspaceDir()));
  ipcMain.handle('shell:openDataDir', () => shell.openPath(app.getPath('userData')));

  ipcMain.handle('memory:clear', () => {
    store.data.memory = [];
    store.save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('memory:delete', (e, id) => {
    if (!Array.isArray(store.data.memory)) return { ok: false };
    const before = store.data.memory.length;
    store.data.memory = store.data.memory.filter(x => x.id !== id);
    if (before !== store.data.memory.length) { store.save(); broadcast(); }
    return { ok: before !== store.data.memory.length };
  });
}

function repeatLabel(r) {
  return { daily: '每天', weekly: '每周', monthly: '每月' }[r] || '';
}

function nextOccurrence(ts, repeat) {
  const d = new Date(ts);
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly') {
    const day = d.getDate();
    d.setMonth(d.getMonth() + 1);
    if (d.getDate() < day) d.setDate(0); // 月末溢出（如 1/31 → 2 月底）时钳到当月最后一天
  }
  return d.getTime();
}

function finalizeTask(task, result, ok) {
  if (ok) {
    if (task.repeat && task.repeat !== '') {
      task.lastRun = { at: Date.now(), result };
      task.status = 'pending';
      task.scheduledAt = nextOccurrence(task.scheduledAt, task.repeat);
      task.result = '';
      task.logs = ['✅ 完成', '↻ 已自动安排下一次执行（' + repeatLabel(task.repeat) + '）'];
    } else {
      task.status = 'done';
      task.result = result;
      task.logs.push('✅ 完成');
    }
  } else {
    task.status = 'failed';
    task.result = result;
    task.logs.push('❌ 失败：' + result);
  }
  task.finishedAt = Date.now();
  memory.addEntry(store, { text: task.text, status: ok ? 'done' : 'failed', result });
}

const MAX_BATCH = 8;

async function runDue(tasks) {
  if (!tasks || !tasks.length) return;
  const settings = getSettings();
  if (settings.mergeBatch && tasks.length > 1) {
    for (let i = 0; i < tasks.length; i += MAX_BATCH) {
      await runBatch(tasks.slice(i, i + MAX_BATCH), settings);
    }
  } else {
    for (const t of tasks) await runTask(t);
  }
}

async function runBatch(tasks, settings) {
  for (const t of tasks) {
    t.status = 'running';
    t.startedAt = Date.now();
    t.result = '';
    t.logs = [];
  }
  store.save();
  broadcast();
  const ctx = { workspaceDir: workspaceDir(), settings, now: Date.now(), mcpTools: getMcpTools(), callMcp, memorySearch, memoryGet, memoryText: memoryContext() };
  try {
    const answer = await ai.runAgentBatch(tasks, settings, ctx, (line) => {
      for (const t of tasks) t.logs.push(line);
      scheduleSave();
      broadcast();
    });
    for (const t of tasks) {
      t.batchCount = tasks.length;
      finalizeTask(t, answer, true);
    }
    notify('批量任务完成', tasks.length + ' 个任务已合并执行');
  } catch (e) {
    const msg = String((e && e.message) ? e.message : e);
    for (const t of tasks) finalizeTask(t, msg, false);
    notify('批量任务失败', msg.slice(0, 60));
  }
  flushSave();
  broadcast();
}

async function runTask(task) {
  if (!task || task.status === 'running') return;
  task.status = 'running';
  task.startedAt = Date.now();
  task.result = '';
  task.logs = [];
  store.save();
  broadcast();
  const settings = getSettings();
  const ctx = { workspaceDir: workspaceDir(), settings, now: Date.now(), mcpTools: getMcpTools(), callMcp, memorySearch, memoryGet, memoryText: memoryContext() };
  try {
    const answer = await ai.runAgent(task.text, settings, ctx, (line) => {
      task.logs.push(line);
      scheduleSave();
      broadcast();
    });
    finalizeTask(task, answer, true);
    notify('任务完成', (task.text || '').slice(0, 60));
  } catch (e) {
    const msg = String((e && e.message) ? e.message : e);
    finalizeTask(task, msg, false);
    notify('任务失败', (task.text || '').slice(0, 60));
  }
  flushSave();
  broadcast();
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, icon: iconPath() || undefined }).show();
    }
  } catch (e) {}
}

function applyAutoStart() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!getSettings().autoStart });
  } catch (e) {}
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !getSettings().background) {
    app.quit();
  }
});

app.on('activate', () => {
  if (win) win.show();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (mcp) { try { mcp.disconnectAll(); } catch (e) {} }
});
