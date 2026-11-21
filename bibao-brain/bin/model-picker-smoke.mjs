#!/usr/bin/env node
/**
 * 模型选择冒烟：目录读取、一键采用 DSH 模型、按逻辑单独指定、旧直连兼容、密钥不外泄。
 * node bin/model-picker-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-model-picker-'))
const stateFile = path.join(dir, 'brain-state.json')
const settingsFile = path.join(dir, 'settings.json')
const routes = new Map()
const cleanups = []
const SECRET = 'sk-direct-secret-value'

const providers = [
  { id: 'zcode', name: 'ZCode（智谱）' },
  { id: 'deepseek-account', name: 'DeepSeek 账户' },
]
const modelsByProvider = {
  zcode: [{ id: 'GLM-5.3', name: 'GLM-5.3' }, { id: 'GLM-5.3-Flash', name: 'GLM-5.3-Flash' }],
  'deepseek-account': [{ id: 'deepseek-v4', name: 'deepseek-v4' }],
}

const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'zcode', model: 'GLM-5.3-Flash' }) }
    if (name === 'llm') {
      return {
        listProviders: () => providers,
        listConfigurableProviders: () => [],
        listModels: async (provider) => modelsByProvider[provider] ?? [],
        async *stream() {
          yield { type: 'text-delta', text: 'ok' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    }
    return undefined
  },
  effect(factory) {
    const dispose = factory()
    cleanups.push(typeof dispose === 'function' ? dispose : () => {})
    return () => {}
  },
  connection: {
    fetch: {
      register(route) {
        routes.set(`${route.methods.join(',')} ${route.path}`, route)
        return async () => {}
      },
    },
  },
}

apply(ctx, { userName: '我', userId: 'owner', useLlm: false, stateFile })
await new Promise((resolve) => setTimeout(resolve, 400))

const call = async (method, suffix, body) => {
  const routePath = suffix.split('?')[0]
  const route = [...routes.values()].find(
    (item) => item.path === `/api/bibao${routePath}` && item.methods.includes(method),
  )
  if (!route) throw new Error(`missing route ${method} ${suffix}`)
  const request = new Request(`http://localhost/api/bibao${suffix}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
  })
  const response = await route.fetch(request)
  return { status: response.status, data: await response.json() }
}

const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

try {
  // 1. 目录：列出 DSH 里已注册的来源，且不带任何密钥
  const catalog = await call('GET', '/llm/catalog')
  check('GET /llm/catalog 返回来源列表', catalog.status === 200 && (catalog.data.providers ?? []).length === 2, (catalog.data.providers ?? []).map((row) => row.provider).join(','))
  check('目录不返回任何密钥', !JSON.stringify(catalog.data).includes(SECRET) && catalog.data.active?.apiKey === undefined)

  const zcodeModels = await call('GET', '/llm/catalog?provider=zcode')
  check('可按来源读取模型列表', (zcodeModels.data.models ?? []).length === 2, (zcodeModels.data.models ?? []).map((row) => row.id).join(','))

  // 2. 一键铺给全部认知逻辑
  const all = await call('POST', '/llm/use-dsh', { provider: 'zcode', model: 'GLM-5.3-Flash', scope: 'all' })
  const profiles = all.data.snapshot?.llmConfig?.profiles ?? []
  const wired = profiles.filter((row) => !['funnel', 'ignition'].includes(row.name))
  check('套用到全部逻辑', all.status === 200 && wired.every((row) => row.dsh === true && row.provider === 'zcode' && row.model === 'GLM-5.3-Flash'), wired.map((row) => `${row.name}:${row.source}`).join(' '))
  check('全部逻辑实际走 DSH 适配', wired.every((row) => row.source === 'dsh:zcode'), wired.map((row) => row.source).join(','))
  check('默认也切到该模型', all.data.snapshot?.llmConfig?.provider === 'zcode' && all.data.snapshot?.llmConfig?.dshModel === 'GLM-5.3-Flash')

  // 3. 落盘，重启后能恢复
  const saved = JSON.parse(await readFile(settingsFile, 'utf8'))
  check('settings.json 记住默认 provider/model', saved.provider === 'zcode' && saved.model === 'GLM-5.3-Flash')
  check('settings.json 记住每个逻辑的 dsh 选择', saved.llm?.profiles?.broca?.dsh === true && saved.llm.profiles.broca.provider === 'zcode' && saved.llm.profiles.broca.model === 'GLM-5.3-Flash')

  // 4. 只给一个逻辑单独指定
  const single = await call('POST', '/llm/use-dsh', { provider: 'deepseek-account', model: 'deepseek-v4', scope: 'appraisal' })
  const after = single.data.snapshot?.llmConfig?.profiles ?? []
  const appraisal = after.find((row) => row.name === 'appraisal')
  const broca = after.find((row) => row.name === 'broca')
  check('单独指定只改那一个逻辑', appraisal?.provider === 'deepseek-account' && appraisal?.model === 'deepseek-v4' && broca?.provider === 'zcode')

  // 5. 旧直连配置仍然可用，且密钥不回传
  const direct = await call('POST', '/settings', {
    llm: { profiles: { broca: { enabled: true, dsh: false, provider: '', baseURL: 'https://api.example.invalid/v1', model: 'legacy-model', apiKey: SECRET } } },
  })
  const directBroca = (direct.data.snapshot?.llmConfig?.profiles ?? []).find((row) => row.name === 'broca')
  check('旧直连配置仍生效', directBroca?.source === 'direct' && directBroca?.resolvedModel === 'legacy-model', directBroca?.source)
  check('接口只回显掩码不回显密钥', directBroca?.hasKey === true && !JSON.stringify(direct.data.snapshot).includes(SECRET))

  // 6. 未知来源会被拒绝
  const bad = await call('POST', '/llm/use-dsh', { provider: 'no-such-provider', model: 'x', scope: 'default' })
  check('未知来源明确报错', bad.status === 400 && /没有注册来源/.test(bad.data.error ?? ''), bad.data.error)
} finally {
  for (const cleanup of cleanups) await cleanup()
  // 控制台服务与落盘定时器可能还握着手柄，删不掉不算测试失败
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true })
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  }
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) process.exitCode = 1
