#!/usr/bin/env node
/**
 * 供应商中心：增删改查、掩码、按供应商调用、视觉选供应商、重启恢复。
 * node bin/vendor-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-vendor-'))
const routes = new Map()
const cleanups = []
const SECRET_A = 'sk-vendor-secret-aaaa1111'
const SECRET_B = 'sk-vendor-secret-bbbb2222'

const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: '', model: '' }) }
    return undefined
  },
  effect(factory) { const d = factory(); cleanups.push(d); return () => {} },
  connection: { fetch: { register(route) { routes.set(`${route.methods.join(',')} ${route.path}`, route); return async () => {} } } },
}

apply(ctx, { userName: '我', userId: 'owner', useLlm: false, stateFile: path.join(dir, 'brain-state.json') })
await new Promise((r) => setTimeout(r, 400))

const call = async (method, suffix, body) => {
  const route = [...routes.values()].find((i) => i.path === `/api/bibao${suffix.split('?')[0]}` && i.methods.includes(method))
  if (!route) throw new Error(`missing ${method} ${suffix}`)
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
  const empty = await call('GET', '/vendors')
  check('初始没有供应商', empty.status === 200 && empty.data.vendors.length === 0)

  const added = await call('POST', '/vendors', {
    name: 'DeepSeek 官方',
    baseURL: 'https://api.deepseek.example/v1',
    apiKey: SECRET_A,
    models: 'deepseek-chat, deepseek-reasoner',
    makeDefault: true,
  })
  check('新增供应商成功', added.status === 200 && added.data.vendors.length === 1, added.data.vendor?.name)
  check('新增后自动设为默认', added.data.current === added.data.vendor.id)
  check('返回值只给掩码，不含 Key', !JSON.stringify(added.data).includes(SECRET_A) && added.data.vendor.hasKey === true)

  const second = await call('POST', '/vendors', {
    name: '本地 Ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
    apiKey: SECRET_B,
    models: 'qwen2.5:7b',
  })
  check('可以加第二个供应商', second.data.vendors.length === 2, second.data.vendors.map((v) => v.name).join('/'))
  check('列表也不泄露任何 Key', !JSON.stringify(second.data.vendors).includes(SECRET_A) && !JSON.stringify(second.data.vendors).includes(SECRET_B))

  const deepseek = added.data.vendor.id
  const applied = await call('POST', '/llm/use-vendor', { vendor: deepseek, scope: 'all' })
  const profiles = applied.data.snapshot?.llmConfig?.profiles ?? []
  const wired = profiles.filter((row) => !['funnel', 'ignition'].includes(row.name))
  check('一键套用到全部逻辑', wired.every((row) => row.vendor === deepseek), wired.map((r) => `${r.name}:${r.vendor}`).join(' '))
  check('实际解析到该供应商', wired.every((row) => row.source === `vendor:${deepseek}`), wired.map((r) => r.source).join(','))
  check('模型用供应商第一个模型', wired.every((row) => row.resolvedModel === 'deepseek-chat'), wired[0]?.resolvedModel)

  // 单个逻辑指定另一个供应商
  const single = await call('POST', '/llm/use-vendor', { vendor: second.data.vendor.id, scope: 'appraisal' })
  const appraisal = (single.data.snapshot?.llmConfig?.profiles ?? []).find((r) => r.name === 'appraisal')
  const broca = (single.data.snapshot?.llmConfig?.profiles ?? []).find((r) => r.name === 'broca')
  check('单独指定只改一个逻辑', appraisal?.vendor === second.data.vendor.id && broca?.vendor === deepseek)

  // 视觉也能选供应商
  const vision = await call('POST', '/settings', { vision: { enabled: true, vendor: second.data.vendor.id, model: '' } })
  check('视觉模型能选供应商', vision.data.snapshot?.vision?.vendor === second.data.vendor.id)
  check('视觉生效地址来自供应商', vision.data.snapshot?.vision?.effectiveBaseURL === 'http://127.0.0.1:11434/v1', vision.data.snapshot?.vision?.effectiveBaseURL)
  check('视觉生效模型来自供应商', vision.data.snapshot?.vision?.effectiveModel === 'qwen2.5:7b', vision.data.snapshot?.vision?.effectiveModel)

  // 落盘
  const saved = JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'))
  check('供应商写入 settings.json', Array.isArray(saved.providers) && saved.providers.length === 2, `${saved.providers?.length} 个`)
  check('默认供应商写入 settings.json', saved.vendor === deepseek)
  check('视觉供应商写入 settings.json', saved.vision?.vendor === second.data.vendor.id)

  // 删除
  const removed = await call('DELETE', '/vendors', { id: deepseek })
  check('删除供应商成功', removed.status === 200 && removed.data.vendors.length === 1)
  check('删除后引用被清空', (removed.data.snapshot?.llmConfig?.profiles ?? []).every((r) => r.vendor !== deepseek))
} finally {
  for (let i = 0; i < 5; i += 1) { try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 120)) } }
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
