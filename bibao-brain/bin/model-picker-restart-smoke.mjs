#!/usr/bin/env node
/**
 * 重启恢复：进程 A 选好 DSH 模型并落盘，进程 B 重新加载后仍使用同一模型。
 * node bin/model-picker-restart-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const phase = process.argv[2]
const root = process.argv[3]

function fakeCtx(routes) {
  return {
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'zcode', model: 'GLM-5.3-Flash' }) }
      if (name === 'llm') {
        return {
          listProviders: () => [{ id: 'zcode', name: 'ZCode' }],
          listConfigurableProviders: () => [],
          listModels: async () => [{ id: 'GLM-5.3', name: 'GLM-5.3' }, { id: 'GLM-5.3-Flash', name: 'GLM-5.3-Flash' }],
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
}

async function call(routes, method, suffix, body) {
  const route = [...routes.values()].find(
    (item) => item.path === `/api/bibao${suffix.split('?')[0]}` && item.methods.includes(method),
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

if (!phase) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-model-restart-'))
  try {
    const script = fileURLToPath(import.meta.url)
    const writer = spawnSync(process.execPath, [script, 'write', dir], { stdio: 'inherit', timeout: 30000 })
    assert.equal(writer.status, 0, 'writer process')
    const reader = spawnSync(process.execPath, [script, 'read', dir], { stdio: 'inherit', timeout: 30000 })
    assert.equal(reader.status, 0, 'reader process')
    console.log('PASS 选好的 DSH 模型在重启后仍然生效')
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
    }
  }
} else {
  const routes = new Map()
  apply(fakeCtx(routes), { userName: '我', userId: 'owner', useLlm: false, stateFile: path.join(root, 'brain-state.json') })
  await new Promise((resolve) => setTimeout(resolve, 400))
  if (phase === 'write') {
    const used = await call(routes, 'POST', '/llm/use-dsh', { provider: 'zcode', model: 'GLM-5.3-Flash', scope: 'all' })
    assert.equal(used.status, 200)
    console.log('PASS 写进程已把全部逻辑切到 DSH 模型')
    process.exit(0)
  }
  const state = await call(routes, 'GET', '/state')
  const profiles = state.data.llmConfig?.profiles ?? []
  const wired = profiles.filter((row) => !['funnel', 'ignition'].includes(row.name))
  assert.ok(wired.length >= 5, 'logic rows')
  for (const row of wired) {
    assert.equal(row.dsh, true, `${row.name} dsh`)
    assert.equal(row.provider, 'zcode', `${row.name} provider`)
    assert.equal(row.model, 'GLM-5.3-Flash', `${row.name} model`)
    assert.equal(row.source, 'dsh:zcode', `${row.name} source`)
  }
  console.log('PASS 读进程从 settings.json 恢复了全部逻辑的 DSH 模型')
}
