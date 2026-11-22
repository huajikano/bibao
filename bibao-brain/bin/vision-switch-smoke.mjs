#!/usr/bin/env node
/**
 * 视觉模型切换：DSH 已登录模型 + 自定义供应商模型都能选，一条请求换掉。
 * node bin/vision-switch-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-vision-switch-'))
const routes = new Map()
const dshModels = {
  zcode: [{ id: 'GLM-5.3-Flash', inputModalities: ['text', 'image'] }, { id: 'GLM-5.3', inputModalities: ['text'] }],
}
const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: '', model: '' }) }
    if (name === 'llm') {
      return {
        listProviders: () => [{ id: 'zcode', name: 'ZCode' }],
        listConfigurableProviders: () => [],
        listModels: async (p) => dshModels[p] ?? [],
        async *stream() { yield { type: 'text-delta', text: 'ok' }; yield { type: 'finish', reason: { kind: 'stop' } } },
      }
    }
    if (name === 'attachments') {
      return { saveImage: async ({ mediaType }) => ({ attachmentId: 'att-1', mediaType, bytes: 10, width: 1, height: 1 }) }
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
  const v1 = await call('POST', '/vendors', {
    name: '视觉供应商 A', baseURL: 'https://vision-a.example/v1', apiKey: 'sk-vision-a', models: ['vision-a-1', 'vision-a-2'],
  })

  const list = await call('GET', '/vision/models')
  const dshOptions = list.data.options.filter((o) => o.source === 'dsh')
  const customOptions = list.data.options.filter((o) => o.source === 'custom')
  check('DSH 里能看图的模型被列出', dshOptions.some((o) => o.model === 'GLM-5.3-Flash'), dshOptions.map((o) => o.model).join(','))
  check('纯文本模型不混进视觉列表', !dshOptions.some((o) => o.model === 'GLM-5.3'))
  check('自定义供应商模型也列出', customOptions.length === 2, customOptions.map((o) => o.model).join(','))
  check('列表不含密钥', !JSON.stringify(list.data).includes('sk-vision-a'))

  const useDsh = await call('POST', '/vision/use', { source: 'dsh', provider: 'zcode', model: 'GLM-5.3-Flash' })
  check('可切换到 DSH 模型', useDsh.status === 200 && useDsh.data.snapshot?.vision?.provider === 'zcode' && useDsh.data.snapshot?.vision?.mode === 'dsh', useDsh.data.snapshot?.vision?.mode)
  check('切到 DSH 后自动开启视觉', useDsh.data.snapshot?.vision?.enabled === true)

  const useCustom = await call('POST', '/vision/use', { source: 'custom', vendor: v1.data.vendor.id, model: 'vision-a-2' })
  check('可切换到自定义供应商模型', useCustom.data.snapshot?.vision?.vendor === v1.data.vendor.id && useCustom.data.snapshot?.vision?.effectiveModel === 'vision-a-2')
  check('切换后 DSH 来源被清空', useCustom.data.snapshot?.vision?.provider === '')

  const back = await call('POST', '/vision/use', { source: 'dsh', provider: 'zcode', model: 'GLM-5.3-Flash' })
  check('可以在两类之间来回切', back.data.snapshot?.vision?.mode === 'dsh' && back.data.snapshot?.vision?.vendor === '')

  const unknownProvider = await call('POST', '/vision/use', { source: 'dsh', provider: 'nope', model: 'x' })
  check('未知 DSH 来源被拒绝', unknownProvider.status === 400, unknownProvider.data.error)
} finally {
  for (let i = 0; i < 5; i += 1) { try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 120)) } }
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
