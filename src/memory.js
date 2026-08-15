const MAX_ENTRIES = 200;

// 把一次任务完成情况归档成一条记忆
function addEntry(store, { text, status, result }) {
  if (!Array.isArray(store.data.memory)) store.data.memory = [];
  store.data.memory.unshift({
    id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: String(text || '').slice(0, 500),
    status: status === 'failed' ? 'failed' : 'done',
    result: String(result || '').slice(0, 2000),
    finishedAt: Date.now()
  });
  if (store.data.memory.length > MAX_ENTRIES) store.data.memory.length = MAX_ENTRIES;
}

// 最近 N 条记忆
function recent(store, limit = 10) {
  return (store.data.memory || []).slice(0, limit);
}

// 按 id 取单条
function getById(store, id) {
  return (store.data.memory || []).find(e => e.id === id);
}

// 按关键词搜索记忆（空格分隔，命中越多越靠前）
function search(store, query, limit = 10) {
  const mem = store.data.memory || [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return mem.slice(0, limit);
  const terms = q.split(/\s+/).filter(Boolean);
  return mem
    .map(e => {
      const hay = (e.text + ' ' + e.result).toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score++;
      return { e, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.e.finishedAt - a.e.finishedAt)
    .slice(0, limit)
    .map(x => x.e);
}

function short(s, max = 60) {
  const v = String(s || '').replace(/\s+/g, ' ').trim();
  return v.length > max ? v.slice(0, max) + '…' : v;
}

function fmtTime(ts, full) {
  const opts = full
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  return new Date(ts).toLocaleString('zh-CN', opts);
}

// 目录索引：只给「状态 + 摘要 + 时间 + id」，不含结果正文，省 token
function formatIndex(entries) {
  if (!entries || !entries.length) return '';
  return entries.map((e, i) => {
    const tag = e.status === 'failed' ? '失败' : '完成';
    return `${i + 1}. [${tag}] ${short(e.text)}（${fmtTime(e.finishedAt)}） id=${e.id}`;
  }).join('\n');
}

// 单条完整详情（memory_get 用）
function formatDetail(e) {
  if (!e) return '';
  const tag = e.status === 'failed' ? '失败' : '完成';
  return `[${tag}] ${e.text}\n时间：${fmtTime(e.finishedAt, true)}\n\n${e.result || '(无结果记录)'}`;
}

module.exports = { addEntry, recent, getById, search, formatIndex, formatDetail };
