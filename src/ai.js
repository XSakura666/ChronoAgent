const { buildToolDefs, executeTool } = require('./tools');

const MAX_STEPS = 25;

const BATCH_INSTRUCTION = [
  '',
  '【批量任务】你这次会收到多个任务，请依次、完整地完成每一个任务。',
  '可以用工具读写文件、抓取网页等。',
  '最后用中文总结，按“任务1 / 任务2 / …”逐条说明每个任务的完成情况和产出位置。'
].join('\n');

function defaultSystemPrompt(ctx) {
  return [
    '你是一个运行在用户电脑上的个人任务助手，名叫“待命智能体”。',
    '用户会给你下达任务，你要独立、完整地完成它。',
    '你有以下工具可用：读写文件、列出目录、抓取网页、发 HTTP 请求调用外部服务（http_request）、调用另一个 AI 模型（ask_model）' + (ctx.settings && ctx.settings.allowShell ? '、执行命令行' : '') + '。',
    '工作目录：' + ctx.workspaceDir + '（相对路径都基于这个目录）。',
    '规则：',
    '1) 用工具真实地完成任务，不要假装调用过工具或编造结果。',
    '2) 生成的成果（文件、报告等）尽量写到工作目录。',
    '3) 最终用中文给出简洁的执行结果总结。',
    '4) 信息不够就先尝试用工具获取，仍不够再说明还缺什么。'
  ].join('\n');
}

async function chatCompletion({ baseUrl, apiKey, model, messages, tools }) {
  const url = (baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '') + '/chat/completions';
  const body = { model, messages };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {})
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error('无法连接 API（' + url + '）：' + e.message);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('响应不是有效 JSON（HTTP ' + res.status + '）：' + text.slice(0, 500));
  }
  if (!res.ok) {
    const msg = json && json.error && json.error.message ? json.error.message : JSON.stringify(json).slice(0, 500);
    throw new Error('API 错误 HTTP ' + res.status + '：' + msg);
  }
  return json;
}

async function testConnection(config) {
  const json = await chatCompletion({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, messages: [{ role: 'user', content: '请只回复两个字：OK' }] });
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  return { reply: content || '' };
}

async function runLoop(messages, config, ctx, onLog) {
  const baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
  const model = config.model || 'deepseek-chat';
  const tools = buildToolDefs(config).concat(ctx.mcpTools || []);

  let finalAnswer = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    const json = await chatCompletion({ baseUrl, apiKey: config.apiKey, model, messages, tools });
    const msg = json.choices && json.choices[0] && json.choices[0].message;
    if (!msg) throw new Error('API 响应缺少 choices[0].message');
    messages.push(msg);

    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (toolCalls.length === 0) {
      finalAnswer = msg.content || '';
      break;
    }

    for (const tc of toolCalls) {
      const fn = tc.function || {};
      let args = {};
      try { args = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch (e) { args = {}; }
      if (onLog) onLog('🔧 ' + fn.name + ' ' + JSON.stringify(args).slice(0, 200));
      let result;
      try {
        if (fn.name && fn.name.indexOf('mcp__') === 0 && ctx.callMcp) {
          result = await ctx.callMcp(fn.name, args);
        } else {
          result = await executeTool(fn.name, args, ctx);
        }
      } catch (e) {
        result = '工具执行出错：' + e.message;
      }
      if (typeof result !== 'string') result = JSON.stringify(result);
      if (onLog) onLog('   ↳ 完成');
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
    }
  }

  if (!finalAnswer) finalAnswer = '(达到最大步骤数，未产出最终结论)';
  return finalAnswer;
}

async function runAgent(taskText, config, ctx, onLog) {
  const sys = (config.systemPrompt && String(config.systemPrompt).trim()) || defaultSystemPrompt(ctx);
  const messages = [
    { role: 'system', content: sys },
    ...(ctx && ctx.memoryText ? [{ role: 'user', content: '（以下是历史记忆，仅供你参考、不是新任务）\n' + ctx.memoryText }] : []),
    { role: 'user', content: taskText }
  ];
  return runLoop(messages, config, ctx, onLog);
}

async function runAgentBatch(tasks, config, ctx, onLog) {
  const sys = (config.systemPrompt && String(config.systemPrompt).trim()) || defaultSystemPrompt(ctx);
  const messages = [
    { role: 'system', content: sys + BATCH_INSTRUCTION },
    ...(ctx && ctx.memoryText ? [{ role: 'user', content: '（以下是历史记忆，仅供你参考、不是新任务）\n' + ctx.memoryText }] : []),
    ...tasks.map((t, i) => ({ role: 'user', content: `【任务${i + 1}】${t.text}` }))
  ];
  return runLoop(messages, config, ctx, onLog);
}

module.exports = { runAgent, runAgentBatch, chatCompletion, testConnection };
