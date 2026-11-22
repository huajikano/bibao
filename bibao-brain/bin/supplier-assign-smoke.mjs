#!/usr/bin/env node
/**
 * 按逻辑单独分配：不同逻辑可以指向不同供应商，互不覆盖。
 * node bin/supplier-assign-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-assign-'))
const routes = new Map()
const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: '', model: '' }) }
    if (name === 'llm') {
      return {
        listProviders: () => [{ id: 'zcode', name: 'ZCode' }],
        listConfigurableProviders: () => [],
        listModels: async () => [{ id: 'GLM-5.3-Flash', inputModalities: ['text', 'image'] }],
        async *stream() { yield { type: 'text-delta', text: '{}' }; yield { type: 'finish', reason: { kind: 'stop' } } },
      }
    }
    if (name === 'attachments') return { saveImage: async () => ({ attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }) }
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
const prof = (snap, name) => (snap.llmConfig?.profiles ?? []).find((row) => row.name === name) ?? {}

try {
  const a = await call('POST', '/vendors', { name: '供应商A', baseURL: 'https://a.example/v1', apiKey: 'sk-a', models: ['a-model'] })
  const b = await call('POST', '/vendors', { name: '供应商B', baseURL: 'https://b.example/v1', apiKey: 'sk-b', models: ['b-model'] })
  const vA = a.data.vendor.id
  const vB = b.data.vendor.id

  const def = await call('POST', '/suppliers/assign', { source: 'custom', id: vA, model: 'a-model', scope: 'default' })
  check('默认供应商设置成功', def.status === 200 && def.data.snapshot.llmConfig.vendor === vA)

  const onlyBroca = await call('POST', '/suppliers/assign', { source: 'custom', id: vB, model: 'b-model', scope: 'broca' })
  const s1 = onlyBroca.data.snapshot
  check('语言区可单独指向另一家', prof(s1, 'broca').vendor === vB && prof(s1, 'broca').source === `vendor:${vB}`, prof(s1, 'broca').source)
  check('其它逻辑仍继承默认', prof(s1, 'memory').vendor === '' && prof(s1, 'memory').source === `vendor:${vA}`, prof(s1, 'memory').source)
  check('默认供应商没被改掉', s1.llmConfig.vendor === vA)

  const onlyAppraisal = await call('POST', '/suppliers/assign', { source: 'dsh', id: 'zcode', model: 'GLM-5.3-Flash', scope: 'appraisal' })
  const s2 = onlyAppraisal.data.snapshot
  check('情感评估可单独指向 DSH', prof(s2, 'appraisal').source === 'dsh:zcode' && prof(s2, 'appraisal').provider === 'zcode')
  check('语言区保持原供应商', prof(s2, 'broca').vendor === vB)

  const vision = await call('POST', '/suppliers/assign', { source: 'custom', id: vA, model: 'a-model', scope: 'vision' })
  const s3 = vision.data.snapshot
  check('视觉单独设置不影响逻辑', s3.vision.vendor === vA && prof(s3, 'broca').vendor === vB && prof(s3, 'appraisal').provider === 'zcode')
  check('视觉生效模型正确', s3.vision.effectiveModel === 'a-model', s3.vision.effectiveModel)
} finally {
  for (let i = 0; i < 5; i += 1) { try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 120)) } }
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
