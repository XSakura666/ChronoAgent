const bridge = window.api;
const $ = (id) => document.getElementById(id);

const STATUS = {
  pending: { label: '待执行', cls: 'pending' },
  running: { label: '⏳ 执行中', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  failed: { label: '失败', cls: 'failed' },
  skipped: { label: '已跳过', cls: 'skipped' }
};

const REPEAT = { daily: '每天', weekly: '每周', monthly: '每月' };

let state = null;
let toastTimer = null;
let mcpServers = [];

function flash(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function toLocalInput(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function relative(ts) {
  const diff = ts - Date.now();
  const m = Math.round(diff / 60000);
  if (m > 0) return m >= 60 ? (Math.round(m / 6) / 10 + ' 小时后') : (m + ' 分钟后');
  if (m === 0) return '现在';
  return '已过期';
}

function fillSettings(s) {
  $('baseUrl').value = s.baseUrl || '';
  $('apiKey').value = s.apiKey || '';
  $('model').value = s.model || '';
  $('auxBaseUrl').value = s.auxBaseUrl || '';
  $('auxApiKey').value = s.auxApiKey || '';
  $('auxModel').value = s.auxModel || '';
  $('systemPrompt').value = s.systemPrompt || '';
  $('background').checked = !!s.background;
  $('autoStart').checked = !!s.autoStart;
  $('allowShell').checked = !!s.allowShell;
  $('catchUp').checked = !!s.catchUp;
  $('mergeBatch').checked = !!s.mergeBatch;
  mcpServers = (s.mcpServers || []).slice();
  renderMcp();
  $('mcpCount').textContent = state && state.mcpToolCount ? ('（已接入 ' + state.mcpToolCount + ' 个工具）') : '';
}

function parseArgs(s) {
  s = String(s || '').trim();
  if (!s) return [];
  if (s[0] === '[') {
    try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) {}
  }
  return s.split(/\s+/);
}

function renderMcp() {
  const list = $('mcpList');
  if (!list) return;
  if (!mcpServers.length) {
    list.innerHTML = '<div class="tip">还没有接入任何 MCP 服务器。</div>';
    return;
  }
  list.innerHTML = mcpServers.map((srv, i) => `
    <div class="mcp-item" data-i="${i}">
      <span class="mcp-name">${esc(srv.name)}</span>
      <code>${esc(srv.command)} ${esc((srv.args || []).join(' '))}</code>
      <button class="btn small danger" data-act="mcp-del" type="button">删除</button>
    </div>`).join('');
}

function updateStatus(s) {
  const dot = $('statusDot'), txt = $('statusText');
  const mcp = state && state.mcpToolCount ? (' · MCP ' + state.mcpToolCount + ' 工具') : '';
  if (!s.apiKey) {
    dot.className = 'dot warn';
    txt.textContent = '未配置 API Key（点“设置”填写）' + mcp;
  } else {
    dot.className = 'dot ok';
    txt.textContent = '模型：' + (s.model || '?') + mcp;
  }
}

function renderTask(t) {
  const st = STATUS[t.status] || { label: t.status, cls: '' };
  const showRun = t.status === 'pending' || t.status === 'failed';
  const showEdit = t.status === 'pending';
  const rep = REPEAT[t.repeat] || '';
  const showResult = t.result || (t.logs && t.logs.length) || (t.lastRun && t.lastRun.result);
  return `
  <div class="task ${st.cls}" data-id="${esc(t.id)}">
    <div class="task-head">
      <span class="badge ${st.cls}">${st.label}</span>
      <div class="task-text">${esc(t.text)}</div>
      <div class="task-actions">
        ${showRun ? `<button class="btn small" data-act="run">立即执行</button>` : ''}
        ${showEdit ? `<button class="btn small" data-act="edit">改时间</button>` : ''}
        <button class="btn small danger" data-act="del">删除</button>
      </div>
    </div>
    <div class="task-meta">
      <span>⏰ ${fmt(t.scheduledAt)}</span>
      ${t.status === 'pending' ? `<span class="rel">（${relative(t.scheduledAt)}）</span>` : ''}
      ${rep ? `<span class="rep">↻ ${rep}</span>` : ''}
      ${t.batchCount ? `<span class="batch">🔗 合并执行 ${t.batchCount} 个任务</span>` : ''}
      ${t.lastRun ? `<span>上次：${fmt(t.lastRun.at)} 完成</span>` : ''}
      <span>创建于 ${fmt(t.createdAt)}</span>
    </div>
    ${showEdit ? `<div class="edit-row" data-edit hidden><input type="datetime-local" class="edit-input" value="${toLocalInput(t.scheduledAt)}"><button class="btn small" data-act="save-time">确定</button><button class="btn small" data-act="cancel">取消</button></div>` : ''}
    ${showResult ? `
    <details class="result">
      <summary>查看执行详情</summary>
      ${t.result ? `<pre class="result-pre">${esc(t.result)}</pre>` : ''}
      ${!t.result && t.lastRun && t.lastRun.result ? `<pre class="result-pre">${esc(t.lastRun.result)}</pre>` : ''}
      ${t.logs && t.logs.length ? `<pre class="logs-pre">${esc(t.logs.join('\n'))}</pre>` : ''}
    </details>` : ''}
  </div>`;
}

function renderEmpty() {
  const hasKey = !!(state && state.settings && state.settings.apiKey);
  const keyStep = hasKey
    ? '<div class="step done">✓ API Key 已配置</div>'
    : '<div class="step active">① 点右上角「设置」，填入 API Key</div>';
  $('taskList').innerHTML = `
    <div class="empty">
      <div class="empty-icon">🕐</div>
      <div class="empty-title">开始使用，很简单</div>
      <div class="empty-steps">
        ${keyStep}
        <div class="step">② 在下面写下任务、选时间</div>
        <div class="step">③ 到点自动执行（或点「立即执行」）</div>
      </div>
    </div>`;
}

function renderTasks(tasks) {
  const list = $('taskList');
  if (!tasks.length) { renderEmpty(); return; }
  list.innerHTML = tasks.map(renderTask).join('');
}

function renderMemory() {
  const list = $('memoryList');
  const q = ($('memSearch').value || '').trim().toLowerCase();
  let mem = (state && state.memory) || [];
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    mem = mem.filter(e => {
      const hay = ((e.text || '') + ' ' + (e.result || '')).toLowerCase();
      return terms.some(t => hay.includes(t));
    });
  }
  if (!mem.length) {
    list.innerHTML = '<div class="tip">还没有记忆。任务完成后会自动归档到这里。</div>';
    return;
  }
  const groups = {};
  for (const e of mem) {
    const key = new Date(e.finishedAt).toLocaleDateString('zh-CN');
    (groups[key] = groups[key] || []).push(e);
  }
  let html = '';
  for (const key of Object.keys(groups)) {
    html += `<div style="margin:12px 0 4px;font-size:12px;font-weight:600;color:#8b98b0;">📁 ${esc(key)} · ${groups[key].length} 条</div>`;
    html += groups[key].map(e => `
      <div class="task">
        <div class="task-head">
          <span class="badge ${e.status === 'failed' ? 'failed' : 'done'}">${e.status === 'failed' ? '失败' : '完成'}</span>
          <div class="task-text">${esc(e.text)}</div>
          <div class="task-actions">
            <button class="btn small danger" data-act="mem-del" data-id="${esc(e.id)}">删除</button>
          </div>
        </div>
        <div class="task-meta"><span>⏰ ${fmt(e.finishedAt)}</span><span class="rep">#${esc(e.id)}</span></div>
        ${e.result ? `<details class="result"><summary>查看结果</summary><pre class="result-pre">${esc(e.result)}</pre></details>` : ''}
      </div>`).join('');
  }
  list.innerHTML = html;
}

$('taskList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.task');
  const id = card.dataset.id;
  const act = btn.dataset.act;
  if (act === 'run') { bridge.runNow(id); flash('已触发立即执行'); }
  else if (act === 'del') { bridge.deleteTask(id); }
  else if (act === 'edit') { card.querySelector('[data-edit]').hidden = false; }
  else if (act === 'save-time') {
    const v = card.querySelector('.edit-input').value;
    if (v) bridge.updateTask({ id, scheduledAt: new Date(v).getTime() });
  }
  else if (act === 'cancel') { card.querySelector('[data-edit]').hidden = true; }
});

$('addBtn').addEventListener('click', () => {
  const text = $('taskText').value.trim();
  if (!text) { flash('请先写任务内容'); return; }
  const v = $('taskTime').value;
  const scheduledAt = v ? new Date(v).getTime() : Date.now();
  bridge.addTask({ text, scheduledAt, repeat: $('taskRepeat').value });
  $('taskText').value = '';
  $('taskTime').value = toLocalInput(Date.now() + 3600 * 1000);
  $('taskRepeat').value = '';
  flash('已添加，到点自动执行');
});

$('settingsBtn').addEventListener('click', () => {
  fillSettings(state.settings);
  $('settingsModal').classList.add('open');
});
$('settingsClose').addEventListener('click', () => $('settingsModal').classList.remove('open'));
$('saveSettings').addEventListener('click', async () => {
  await bridge.setSettings({
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    auxBaseUrl: $('auxBaseUrl').value.trim(),
    auxApiKey: $('auxApiKey').value.trim(),
    auxModel: $('auxModel').value.trim(),
    systemPrompt: $('systemPrompt').value,
    background: $('background').checked,
    autoStart: $('autoStart').checked,
    allowShell: $('allowShell').checked,
    catchUp: $('catchUp').checked,
    mergeBatch: $('mergeBatch').checked,
    mcpServers: mcpServers
  });
  $('settingsModal').classList.remove('open');
  flash('设置已保存');
});

$('openWorkspaceBtn').addEventListener('click', () => bridge.openWorkspace());

$('mcpList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="mcp-del"]');
  if (!btn) return;
  const i = Number(btn.closest('.mcp-item').dataset.i);
  mcpServers.splice(i, 1);
  renderMcp();
});

$('mcpAddBtn').addEventListener('click', () => {
  const name = $('mcpName').value.trim();
  const command = $('mcpCommand').value.trim();
  if (!name || !command) { flash('请填写名称和命令'); return; }
  mcpServers.push({ name, command, args: parseArgs($('mcpArgs').value) });
  $('mcpName').value = ''; $('mcpCommand').value = ''; $('mcpArgs').value = '';
  renderMcp();
});

// 快捷时间
document.querySelectorAll('.chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const now = new Date();
    if (btn.dataset.min !== undefined) {
      $('taskTime').value = toLocalInput(Date.now() + Number(btn.dataset.min) * 60000);
    } else if (btn.dataset.hour !== undefined) {
      const d = new Date(); d.setHours(Number(btn.dataset.hour), 0, 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      $('taskTime').value = toLocalInput(d.getTime());
    } else if (btn.dataset.tomorrow !== undefined) {
      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(Number(btn.dataset.tomorrow), 0, 0, 0);
      $('taskTime').value = toLocalInput(d.getTime());
    }
  });
});

// Ctrl+Enter 快速添加
$('taskText').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('addBtn').click();
});

// DeepSeek 一键填入
$('dsPresetBtn').addEventListener('click', () => {
  $('baseUrl').value = 'https://api.deepseek.com/v1';
  $('model').value = 'deepseek-chat';
  flash('已填入 DeepSeek，请再填 API Key');
});

// 测试连接
$('testAiBtn').addEventListener('click', async () => {
  const btn = $('testAiBtn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '测试中…';
  try {
    const r = await bridge.testAi({
      baseUrl: $('baseUrl').value.trim(),
      apiKey: $('apiKey').value.trim(),
      model: $('model').value.trim()
    });
    if (r.ok) flash('✅ 连接成功，模型回复：' + (r.reply || 'OK'));
    else flash('❌ 连接失败：' + (r.error || '未知错误'));
  } catch (e) {
    flash('❌ 连接失败：' + (e && e.message ? e.message : e));
  }
  btn.disabled = false;
  btn.textContent = original;
});

// 每分钟刷新倒计时
setInterval(() => {
  if (state && state.tasks && state.tasks.some((t) => t.status === 'pending')) {
    renderTasks(state.tasks);
  }
}, 30000);

async function init() {
  $('taskTime').value = toLocalInput(Date.now() + 3600 * 1000);
  state = await bridge.getState();
  fillSettings(state.settings);
  updateStatus(state.settings);
  renderTasks(state.tasks);
  renderMemory();
  $('memSearch').addEventListener('input', renderMemory);
  $('memClearBtn').addEventListener('click', () => { bridge.clearMemory(); flash('已清空记忆'); });
  $('memoryList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act="mem-del"]');
    if (!btn) return;
    bridge.deleteMemory(btn.dataset.id);
    flash('已删除该记忆');
  });
  bridge.onState((s) => {
    state = s;
    updateStatus(s.settings);
    renderTasks(s.tasks);
    renderMemory();
  });
}

init();
