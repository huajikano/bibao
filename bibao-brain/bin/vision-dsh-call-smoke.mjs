#!/usr/bin/env node
/**
 * DSH 视觉真实调用：确认图片被存成附件、并以 image 块交给所选 DSH 模型。
 * node bin/vision-dsh-call-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-vision-dsh-'))
const routes = new Map()
const seen = []
const saved = []

const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: '', model: '' }) }
    if (name === 'llm') {
      return {
        listProviders: () => [{ id: 'zcode', name: 'ZCode' }],
        listConfigurableProviders: () => [],
        listModels: async () => [{ id: 'GLM-5.3-Flash', inputModalities: ['text', 'image'] }],
        async *stream(options) {
          seen.push(options)
          yield { type: 'text-delta', text: '这是一张深色的图。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    }
    if (name === 'attachments') {
      return {
        saveImage: async ({ mediaType, data, name: fileName }) => {
          saved.push({ mediaType, bytes: data?.length ?? 0, name: fileName })
          return { attachmentId: 'att-test', mediaType, bytes: data?.length ?? 0, width: 64, height: 64 }
        },
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
  const used = await call('POST', '/vision/use', { source: 'dsh', provider: 'zcode', model: 'GLM-5.3-Flash' })
  check('已切到 DSH 视觉模型', used.status === 200 && used.data.snapshot?.vision?.mode === 'dsh')

  const tested = await call('POST', '/vision/test')
  check('视觉测试调用成功', tested.status === 200 && Boolean(tested.data.text), `${tested.status} ${tested.data.text ?? tested.data.error ?? ''}`)
  check('图片被存成附件', saved.length === 1 && saved[0].bytes > 0, JSON.stringify(saved[0] ?? null))
  const opts = seen[0] ?? {}
  check('使用的是所选 DSH 模型', opts.provider === 'zcode' && opts.model === 'GLM-5.3-Flash', `${opts.provider}/${opts.model}`)
  const parts = opts.messages?.[0]?.content ?? []
  check('消息里包含 image 块', parts.some((p) => p.type === 'image' && p.attachment?.attachmentId === 'att-test'))
  check('消息里包含文字提示', parts.some((p) => p.type === 'text' && String(p.text).length > 0))
} finally {
  for (let i = 0; i < 5; i += 1) { try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 120)) } }
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
