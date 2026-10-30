import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, loadConfig, runSdk } from './server.mjs';

const key = 'x'.repeat(32);
const model = 'test-model';

async function withServer(run, callback) {
  const server = createBridge({ key, models: [model], run });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

const body = { model, messages: [{ role: 'user', content: '你好' }] };
const send = (url, payload, token = key) => fetch(`${url}/v1/chat/completions`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload),
});

test('仅向持有密钥的客户端提供受限对话接口', async () => {
  await withServer(async () => ({ model, text: '你好' }), async url => {
    assert.equal((await send(url, body, 'wrong')).status, 401);
    const response = await send(url, body);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.model, model);
    assert.equal(result.choices[0].message.content, '你好');
    assert.equal(result.choices[0].finish_reason, 'stop');
    assert.equal((await send(url, { ...body, stream: true })).status, 501);
    assert.equal((await send(url, { ...body, tools: [] })).status, 501);
    assert.equal((await send(url, { ...body, messages: [...body.messages, ...body.messages] })).status, 400);
  });
});

test('拒绝模型回退并保留额度错误', async () => {
  await withServer(async () => ({ model: 'other', text: '错误来源' }), async url => {
    assert.equal((await send(url, body)).status, 502);
  });
  await withServer(async () => { throw Object.assign(new Error('内部信息'), { code: 'quota' }); }, async url => {
    const response = await send(url, body);
    assert.equal(response.status, 429);
    assert.doesNotMatch(await response.text(), /内部信息/);
  });
});

test('只接受企业 HTTPS 根地址', () => {
  const common = { WORKBUDDY_ENTERPRISE_BRIDGE_KEY: key, WORKBUDDY_ENTERPRISE_MODELS: '["test-model"]', CODEBUDDY_CONFIG_DIR: 'test' };
  assert.equal(loadConfig({ ...common, WORKBUDDY_ENTERPRISE_ENDPOINT: 'https://example.com' }).endpoint, 'https://example.com');
  assert.throws(() => loadConfig({ ...common, WORKBUDDY_ENTERPRISE_ENDPOINT: 'https://example.com/login' }));
  assert.throws(() => loadConfig({ ...common, WORKBUDDY_ENTERPRISE_ENDPOINT: 'http://example.com' }));
});

test('SDK 返回额度错误时不把错误文本当成模型回复', async () => {
  const fakeQuery = () => (async function* () {
    yield { type: 'assistant', message: { model, content: [{ type: 'text', text: 'Your personal quota is used up' }] } };
    throw new Error('SDK 错误');
  })();
  await assert.rejects(runSdk({ model, prompt: '测试' }, { endpoint: 'https://example.com', configDir: 'test' }, fakeQuery), { code: 'quota' });
});

test('SDK 成功时保留真实返回的模型名称', async () => {
  const fakeQuery = () => (async function* () {
    yield { type: 'assistant', message: { model, content: [{ type: 'text', text: 'OK' }] } };
    yield { type: 'result', subtype: 'success', is_error: false };
  })();
  assert.deepEqual(await runSdk({ model, prompt: '测试' }, { endpoint: 'https://example.com', configDir: 'test' }, fakeQuery), { model, text: 'OK' });
});
