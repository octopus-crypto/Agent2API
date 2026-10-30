import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 256 * 1024;

function reply(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function error(res, status, message) {
  reply(res, status, { error: { message, type: 'enterprise_bridge_error' } });
}

function authorized(header, expected) {
  const actual = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const key = Buffer.from(expected);
  return actual.length === key.length && timingSafeEqual(actual, key);
}

export function createBridge({ key, models, run }) {
  if (typeof key !== 'string' || key.length < 32) throw new Error('适配层密钥至少需要 32 个字符');
  if (!Array.isArray(models) || models.length === 0 || models.some(model => typeof model !== 'string' || !model)) {
    throw new Error('需要配置至少一个企业模型名称');
  }
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { status: 'ok', inferenceVerified: false });
    if (!authorized(req.headers.authorization, key)) return error(res, 401, '适配层密钥无效');
    if (req.method === 'GET' && req.url === '/v1/models') {
      return reply(res, 200, { object: 'list', data: models.map(id => ({ id, object: 'model', owned_by: 'workbuddy-enterprise' })) });
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return error(res, 404, '接口不存在');
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { req.resume(); return error(res, 413, '请求体过大'); }
        chunks.push(chunk);
      }
    } catch { return error(res, 400, '请求体读取失败'); }
    let request;
    try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return error(res, 400, '请求体不是有效 JSON'); }
    if (!request || typeof request !== 'object' || Array.isArray(request)) return error(res, 400, '请求体必须是对象');
    const unsupported = Object.keys(request).filter(field => !['model', 'messages', 'stream'].includes(field));
    if (unsupported.length || request.stream === true) return error(res, 501, '当前仅支持非流式单条用户消息，其他参数尚未实现');
    if (request.stream !== undefined && typeof request.stream !== 'boolean') return error(res, 400, 'stream 必须是布尔值');
    if (!models.includes(request.model)) return error(res, 404, '模型未在企业适配层配置中');
    if (!Array.isArray(request.messages) || request.messages.length !== 1 || request.messages[0]?.role !== 'user' || typeof request.messages[0]?.content !== 'string' || !request.messages[0].content.trim()) {
      return error(res, 400, '当前仅支持一条非空的用户文本消息');
    }
    try {
      const result = await run({ model: request.model, prompt: request.messages[0].content });
      if (result.model !== request.model) return error(res, 502, '上游模型与请求模型不一致，已拒绝回退结果');
      if (typeof result.text !== 'string' || !result.text) return error(res, 502, '上游未返回有效文本');
      return reply(res, 200, { id: `chatcmpl-enterprise-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: result.model, choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }] });
    } catch (failure) {
      if (failure?.code === 'quota') return error(res, 429, '企业账号额度不足，请等待额度恢复或联系管理员');
      if (failure?.code === 'timeout') return error(res, 504, '企业 SDK 请求超时');
      return error(res, 502, '企业 SDK 调用失败，请检查本机官方登录和服务状态');
    }
  });
}

export function loadConfig(env) {
  const endpoint = new URL(env.WORKBUDDY_ENTERPRISE_ENDPOINT || '');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error('企业服务地址必须是 HTTPS 根地址');
  const models = JSON.parse(env.WORKBUDDY_ENTERPRISE_MODELS || '[]');
  const port = Number(env.WORKBUDDY_ENTERPRISE_PORT || '3067');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('适配层端口无效');
  if (!env.CODEBUDDY_CONFIG_DIR) throw new Error('请指定官方工具的隔离配置目录');
  return { key: env.WORKBUDDY_ENTERPRISE_BRIDGE_KEY, endpoint: endpoint.origin, models, port, configDir: env.CODEBUDDY_CONFIG_DIR };
}

export async function runSdk({ model, prompt }, config, queryOverride) {
  const query = queryOverride || (await import('@tencent-ai/agent-sdk')).query;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120000);
  let text = '';
  let actualModel = '';
  let quota = false;
  let success = false;
  try {
    const events = query({ prompt, options: {
      environment: 'cloudhosted', endpoint: config.endpoint, model, tools: [], maxTurns: 1,
      persistSession: false, abortController: abort,
      env: { ...process.env, CODEBUDDY_CONFIG_DIR: config.configDir, CODEBUDDY_INTERNET_ENVIRONMENT: 'cloudhosted' },
    } });
    for await (const message of events) {
      if (message.type === 'assistant') {
        actualModel = message.message?.model || actualModel;
        const contents = (message.message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
        quota ||= /quota is used up|额度已用完/i.test(contents);
        text += contents;
      }
      if (message.type === 'result') success = !message.is_error && message.subtype === 'success';
    }
    if (quota) throw Object.assign(new Error('额度不足'), { code: 'quota' });
    if (!success) throw new Error('上游未报告成功');
    return { text, model: actualModel };
  } catch (failure) {
    if (quota) throw Object.assign(new Error('额度不足'), { code: 'quota' });
    if (abort.signal.aborted) throw Object.assign(new Error('请求超时'), { code: 'timeout' });
    throw failure;
  } finally { clearTimeout(timer); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfig(process.env);
    const server = createBridge({ ...config, run: request => runSdk(request, config) });
    server.on('error', () => { console.error('企业适配层启动失败，请检查端口'); process.exitCode = 1; });
    server.listen(config.port, '127.0.0.1', () => console.log(`企业适配层监听 127.0.0.1:${config.port}`));
  } catch { console.error('企业适配层配置无效'); process.exitCode = 1; }
}
