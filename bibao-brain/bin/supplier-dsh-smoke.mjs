#!/usr/bin/env node
/**
 * 供应商页：DSH 来源自动列模型、一键分配；视觉只接受自定义供应商。
 * node bin/supplier-dsh-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-supplier-dsh-'))
const routes = new Map()
const modelsByProvider = { zcode: [{ id: 'GLM-5.3' }, { id: 'GLM-5.3-Flash' }] }

const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'zcode', model: 'GLM-5.3-Flash' }) }
    if (name === 'llm') {
      return {
        listProviders: () => [{ id: 'zcode', name: 'ZCode' }],
        listConfigurableProviders: () => [],
        listModels: async (p) => modelsByProvider[p] ?? [],
        async *stream() { yield { type: 'text-delta', text: '{}' }; yield { type: 'finish', reason: { kind: 'stop' } } },
      }
    }
    return undefined
  },
  effect(factory) { factory(); return () => {} },
  connection: { fetch: { register(route) { routes.set(`${route.methods.join(',')} ${route.path}`, route); return async () => {} } } },
}

apply(ctx, { userName: '我', userId: 'owner', useLlm: false, stateFile: path.join(dir, 'brain-state.json') })
await new Promise((r) => setTimeout(r, 400))

const call = async (method, suffix, body) => {
  const route = [...routes.values()].find((i) => i.path === `/api/bibao${suffix}` && i.methods.includes(method))
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
  const catalog = await call('GET', '/llm/catalog')
  check('DSH 供应商自动列出', (catalog.data.providers ?? []).length > 0, (catalog.data.providers ?? []).map((p) => p.provider).join(','))

  const models = await call('POST', '/suppliers/models', { source: 'dsh', id: 'zcode' })
  check('DSH 模型自动获取', models.status === 200 && models.data.models.length === 2, models.data.models.map((m) => m.id).join(','))

  const assigned = await call('POST', '/suppliers/assign', { source: 'dsh', id: 'zcode', model: 'GLM-5.3', scope: 'all' })
  const wired = (assigned.data.snapshot?.llmConfig?.profiles ?? []).filter((r) => !['funnel', 'ignition'].includes(r.name))
  check('DSH 一键分配到全部逻辑', wired.every((r) => r.provider === 'zcode' && r.model === 'GLM-5.3' && r.source === 'dsh:zcode'), wired.map((r) => r.source).join(','))

  const vision = await call('POST', '/suppliers/assign', { source: 'dsh', id: 'zcode', model: 'GLM-5.3', scope: 'vision' })
  check('DSH 不能直接给视觉用（需兼容端点）', vision.status === 400, vision.data.error)
} finally {
  for (let i = 0; i < 5; i += 1) { try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 120)) } }
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
