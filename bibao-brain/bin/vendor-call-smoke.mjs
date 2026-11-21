#!/usr/bin/env node
/**
 * 供应商真实调用：起一个本地 OpenAI 兼容端点，确认对话带着该供应商的 Key 与模型发出。
 * node bin/vendor-call-smoke.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const seen = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization ?? '', body: body ? JSON.parse(body) : null })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ bubbles: ['嗯'], inner_monologue: '测试', neuro_delta: {} }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-vendor-call-'))
const routes = new Map()
const ctx = {
  get(name) { if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: '', model: '' }) }; return undefined },
  effect(factory) { factory(); return () => {} },
  connection: { fetch: { register(route) { routes.set(`${route.methods.join(',')} ${route.path}`, route); return async () => {} } } },
}

apply(ctx, { userName: '我', userId: 'owner', useLlm: false, stateFile: path.join(dir, 'brain-state.json') })
await new Promise((r) => setTimeout(r, 400))

const call = async (method, suffix, body) => {
  const route = [...routes.values()].find((i) => i.path === `/api/bibao${suffix}` && i.methods.includes(method))
  const request = new Request(`http://localhost/api/bibao${suffix}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
  })
  const response = await route.fetch(request)
  return { status: response.status, data: await response.json() }
}

const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

try {
  const added = await call('POST', '/vendors', {
    name: '本地假端点', baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-fake-endpoint-key', models: ['fake-model-1'], makeDefault: true,
  })
  const used = await call('POST', '/llm/use-vendor', { vendor: added.data.vendor.id, scope: 'all' })
  check('供应商已应用到全部逻辑', used.status === 200)

  // 短问候会走本地快路径，这里用一句真实对话触发模型
  await call('POST', '/talk', { text: '今天天气不错啊，你在干嘛呢', entityId: 'owner', entityName: '我' })
  check('确实请求了供应商端点', seen.length > 0, `${seen.length} 次请求`)
  const first = seen[0]
  check('请求路径是 OpenAI 兼容接口', Boolean(first && /\/v1\/chat\/completions$/.test(first.url ?? '')), first?.url)
  check('带上了该供应商的 Key', first?.auth === 'Bearer sk-fake-endpoint-key', first?.auth ? 'Bearer ***' : '无')
  check('使用了该供应商的模型', first?.body?.model === 'fake-model-1', first?.body?.model)
} finally {
  server.close()
  for (let i = 0; i < 5; i += 1) { try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 120)) } }
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
