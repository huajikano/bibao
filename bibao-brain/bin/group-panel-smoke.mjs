#!/usr/bin/env node
/**
 * 群聊页数据完整性：每个群都要有成员数、未读和最近消息，且界面不再只渲染前 12 个。
 * node bin/group-panel-smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-groups-'))
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

const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

try {
  const before = await call('GET', '/group/state')
  const groups = before.data.group?.groups ?? []
  check('群列表完整返回', groups.length >= 5, `${groups.length} 个群`)
  check(
    '每个群都带成员数/未读/消息缓存',
    groups.every((g) => g.name && Number.isFinite(g.memberCount) && Number.isFinite(g.unread) && Array.isArray(g.buffer)),
    groups.map((g) => `${g.name}(${g.memberCount}人)`).join(' '),
  )

  const target = groups[0]
  const text = '这条消息应该出现在群卡片上'
  await call('POST', '/group/feed', { groupId: target.id, senderId: '100000002', text, atMe: false })
  const after = await call('GET', '/group/state')
  const updated = (after.data.group?.groups ?? []).find((g) => g.id === target.id)
  const last = (updated?.buffer ?? []).at(-1)
  check('群卡片能拿到最近一条消息', last?.text === text, `${last?.senderName ?? '?'}：${last?.text ?? '空'}`)
  check('未读数会随消息增加', Number(updated?.unread) >= 1, `unread=${updated?.unread}`)

  const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  check('界面不再只渲染前 12 个群', !clientSource.includes('groups.slice(0, 12)'))
  check('群卡片包含消息预览节点', clientSource.includes('bb-groupMsg'))
  check('群列表可滚动，长列表不会被截断', /\.bb-groups \{[^}]*overflow: auto/.test(clientSource))
} finally {
  for (let i = 0; i < 5; i += 1) { try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 120)) } }
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
