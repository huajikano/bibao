#!/usr/bin/env node
/**
 * 对话页好感度：本地模式（不接模型）下也要随互动变化，不再是固定的 42。
 * node bin/talk-intimacy-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-intimacy-'))
const routes = new Map()
const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: '', model: '' }) }
    return undefined
  },
  effect(factory) { factory(); return () => {} },
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

const intimacyOf = (snap) => {
  const row = (snap.social ?? []).find((item) => item.id === 'owner')
  return row ? Number(row.intimacy) : NaN
}

const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

try {
  const before = await call('GET', '/state')
  const start = intimacyOf(before.data)
  check('初始好感读取正常', Number.isFinite(start), `intimacy=${start}`)

  for (let i = 0; i < 6; i += 1) {
    await call('POST', '/talk', { text: '谢谢你，今天真的辛苦了，早点休息', entityId: 'owner', entityName: '我' })
  }
  const warm = await call('GET', '/state')
  const afterWarm = intimacyOf(warm.data)
  check('聊几句暖话后好感会涨', afterWarm > start, `${start} → ${afterWarm}`)

  for (let i = 0; i < 6; i += 1) {
    await call('POST', '/talk', { text: '闭嘴吧 你真烦 别再说话了', entityId: 'owner', entityName: '我' })
  }
  const cold = await call('GET', '/state')
  const afterCold = intimacyOf(cold.data)
  check('被凶之后好感会掉', afterCold < afterWarm, `${afterWarm} → ${afterCold}`)

  // 存档是 1.2s 防抖写入，等一下再读
  await new Promise((r) => setTimeout(r, 1800))
  const saved = JSON.parse(await readFile(path.join(dir, 'brain-state.json'), 'utf8'))
  const persisted = (saved.social ?? []).find((row) => row.id === 'owner')
  check('好感变化会落盘', persisted && Number(persisted.intimacy) !== 42, `saved=${Number(persisted?.intimacy).toFixed(1)}`)

  // 界面不能再写死 42
  const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  check('界面不再写死「亲密度 42」', !clientSource.includes('亲密度 42'))
} finally {
  for (let i = 0; i < 5; i += 1) { try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 120)) } }
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
