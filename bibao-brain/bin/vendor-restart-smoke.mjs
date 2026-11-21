#!/usr/bin/env node
/**
 * 供应商重启恢复：进程 A 建供应商并应用，进程 B 重新加载后仍走该供应商。
 * node bin/vendor-restart-smoke.mjs
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
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: '', model: '' }) }
      return undefined
    },
    effect(factory) { factory(); return () => {} },
    connection: { fetch: { register(route) { routes.set(`${route.methods.join(',')} ${route.path}`, route); return async () => {} } } },
  }
}

async function call(routes, method, suffix, body) {
  const route = [...routes.values()].find((i) => i.path === `/api/bibao${suffix}` && i.methods.includes(method))
  if (!route) throw new Error(`missing ${method} ${suffix}`)
  const request = new Request(`http://localhost/api/bibao${suffix}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
  })
  const response = await route.fetch(request)
  return { status: response.status, data: await response.json() }
}

if (!phase) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-vendor-restart-'))
  try {
    const script = fileURLToPath(import.meta.url)
    const writer = spawnSync(process.execPath, [script, 'write', dir], { stdio: 'inherit', timeout: 40000 })
    assert.equal(writer.status, 0, 'writer process')
    const reader = spawnSync(process.execPath, [script, 'read', dir], { stdio: 'inherit', timeout: 40000 })
    assert.equal(reader.status, 0, 'reader process')
    console.log('PASS 供应商配置在重启后仍然生效')
  } finally {
    for (let i = 0; i < 5; i += 1) { try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 120)) } }
  }
} else {
  const routes = new Map()
  apply(fakeCtx(routes), { userName: '我', userId: 'owner', useLlm: false, stateFile: path.join(root, 'brain-state.json') })
  await new Promise((r) => setTimeout(r, 400))
  if (phase === 'write') {
    const added = await call(routes, 'POST', '/vendors', {
      name: 'Restart Vendor', baseURL: 'https://restart.example/v1', apiKey: 'sk-restart-secret', models: ['restart-model'], makeDefault: true,
    })
    assert.equal(added.status, 200)
    const used = await call(routes, 'POST', '/llm/use-vendor', { vendor: added.data.vendor.id, scope: 'all' })
    assert.equal(used.status, 200)
    console.log('PASS 写进程已建立并应用供应商')
    process.exit(0)
  }
  const state = await call(routes, 'GET', '/state')
  const vendors = state.data.llmConfig?.vendors ?? []
  assert.equal(vendors.length, 1, 'vendor restored')
  assert.equal(vendors[0].name, 'Restart Vendor')
  assert.equal(vendors[0].hasKey, true)
  const wired = (state.data.llmConfig?.profiles ?? []).filter((r) => !['funnel', 'ignition'].includes(r.name))
  for (const row of wired) {
    assert.equal(row.source, `vendor:${vendors[0].id}`, `${row.name} source`)
    assert.equal(row.resolvedModel, 'restart-model', `${row.name} model`)
  }
  console.log('PASS 读进程恢复了供应商与各逻辑的引用')
}
