#!/usr/bin/env node
/**
 * 表情包导入冒烟：用一个假的 OpenAI 兼容视觉端点，验证
 * dataURL → 视觉描述 → StickerBook 落盘 → /stickers 可读回。
 *
 * 它不测浏览器 canvas；浏览器端由 live-render / 手点验证。
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-sticker-'))
const routes = new Map()
const cleanups = []

const visionServer = createServer((req, res) => {
  if (req.url?.endsWith('/chat/completions')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '```json\n{"kind":"sticker","gist":"假装生气的猫","mood":"笑","text":"哼"}\n```',
            },
          },
        ],
      }),
    )
    return
  }
  res.writeHead(404)
  res.end('not found')
})
await new Promise((resolve) => visionServer.listen(0, '127.0.0.1', resolve))
const visionPort = visionServer.address().port

const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'stub', model: 'stub' }) }
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

apply(ctx, {
  userName: '我',
  userId: 'owner',
  useLlm: false,
  stateFile: path.join(dir, 'brain-state.json'),
  vision: { enabled: true, model: 'fake/vision', maxPerHour: 10 },
  llm: { baseURL: `http://127.0.0.1:${visionPort}/v1`, apiKey: 'test-key', model: 'fake/vision' },
  snowluma: { enabled: false },
})
await new Promise((resolve) => setTimeout(resolve, 500))

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

const jpg = await readFile(new URL('../../c0adccca200a726f4e2171ee7ccf7dcb.jpg', import.meta.url))
const dataUrl = `data:image/jpeg;base64,${jpg.toString('base64')}`

const bad = await call('POST', '/stickers/import', { dataUrl: 'not-an-image' })
check('非图片 dataURL 被拒绝', bad.status === 400, `${bad.status} ${bad.data?.error ?? ''}`)

const imported = await call('POST', '/stickers/import', { dataUrl })
check(
  '真实 JPEG 能导入',
  imported.status === 200 && imported.data?.ok === true && Boolean(imported.data?.item?.id),
  `${imported.status} ${imported.data?.gist ?? imported.data?.error ?? ''}`,
)

const list = await call('GET', '/stickers')
check('导入后能从收藏夹读回', (list.data?.items ?? []).length >= 1, `items=${list.data?.items?.length ?? 0}`)
const fileRoute = [...routes.values()].find((item) => item.path === '/api/bibao/stickers/file' && item.methods.includes('GET'))
const fileResponse = await fileRoute.fetch(
  new Request(`http://localhost/api/bibao/stickers/file?id=${imported.data?.item?.id ?? 'bad'}`),
)
check('收藏的图片能取回', fileResponse.status === 200 && fileResponse.headers.get('content-type')?.startsWith('image/'), fileResponse.headers.get('content-type') ?? String(fileResponse.status))

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
for (const dispose of cleanups) dispose()
await new Promise((resolve) => setTimeout(resolve, 500))
visionServer.close()
await rm(dir, { recursive: true, force: true })
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
