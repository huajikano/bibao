#!/usr/bin/env node
/**
 * Host 半冒烟测试：用假 ctx 捕获路由，不经过 HTTP 鉴权，验证大脑真的能跑。
 * node bin/host-smoke.mjs
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'
import { BibaoBrain } from '../core/brain.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-smoke-'))
const biography = JSON.parse(await readFile(new URL('../core/biography.json', import.meta.url), 'utf8'))
const routes = new Map()
const cleanups = []

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

apply(ctx, { userName: '我', userId: 'owner', useLlm: false, stateFile: path.join(dir, 'brain-state.json') })
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

const state = await call('GET', '/state')
check('GET /state', state.status === 200 && state.data.identity?.name === '比宝', `${state.data.memory?.stats?.total} 条记忆`)
check('Phase 1 时间线', (state.data.timeline ?? []).length === 23, `${state.data.timeline?.length} 个事件`)
check('婴儿期记忆沉入潜意识', (state.data.timeline ?? []).some((item) => item.tier === 'subconscious'))

const uiRoute = routes.get('GET /api/bibao/ui')
const uiResponse = await uiRoute.fetch(new Request('http://localhost/api/bibao/ui'))
const uiHtml = await uiResponse.text()
check('GET /ui 独立页面', uiResponse.status === 200 && uiHtml.includes('比宝') && uiHtml.includes('/settings'), `${uiHtml.length} bytes`)
const talk = await call('POST', '/talk', { text: '在干嘛呢？', entityId: 'owner', entityName: '我' })
check(
  'POST /talk',
  talk.status === 200 && talk.data.result?.ignited && (talk.data.result.dual?.bubbles ?? []).length > 0,
  (talk.data.result?.dual?.bubbles ?? []).join(' / '),
)
check('双轨 JSON 完整', Boolean(talk.data.result?.dual?.inner_monologue), talk.data.result?.dual?.inner_monologue?.slice(0, 40))

const tick = await call('POST', '/tick', { seconds: 3600 })
check('POST /tick', tick.status === 200 && tick.data.snapshot?.clock?.silenceMin >= 59, `silence ${tick.data.snapshot?.clock?.silenceMin}`)

const sleep = await call('POST', '/sleep', {})
check('POST /sleep', sleep.status === 200 && Boolean(sleep.data.report), sleep.data.report?.dream?.narrative ?? '无梦')

const sandbox = await call('POST', '/sandbox/run', {})
check('POST /sandbox/run', sandbox.data.gate?.allPassed === true, `${sandbox.data.gate?.passed}/${sandbox.data.gate?.total}`)

const group = await call('GET', '/group/state')
check('GET /group/state', group.data.unlocked === true && (group.data.group?.groups ?? []).length === 5, `${group.data.group?.groups?.length} 群`)

const feed = await call('POST', '/group/feed', {
  groupId: 'g_class',
  senderId: '44719023',
  text: '笑死 你们听说了吗',
  atMe: false,
})
check('POST /group/feed', feed.status === 200 && Boolean(feed.data.decision), feed.data.decision?.reason)

const scan = await call('POST', '/group/feed', {
  groupId: 'g_cat',
  senderId: '903277415',
  text: '今天天气不错',
  atMe: false,
})
check(
  '余光群本地扫描不调 LLM',
  scan.data.decision?.toThalamus === false && /不调用 LLM/.test(scan.data.decision?.reason ?? ''),
  scan.data.decision?.reason,
)

await call('POST', '/group/feed', {
  groupId: 'g_class',
  senderId: '44719023',
  text: '笑死 你们听说了吗 那个事真的绝了',
  atMe: false,
})
await new Promise((resolve) => setTimeout(resolve, 3600))
const funnelState = await call('GET', '/group/state')
const brainEntry = (funnelState.data.group?.log ?? []).find((entry) => entry.kind === 'brain')
check('防抖 3s 后进脑', Boolean(brainEntry), brainEntry ? `${brainEntry.route} · ${(brainEntry.bubbles ?? []).join(' / ') || '沉默'}` : '无')
check(
  '跨通道吐槽闭环',
  (funnelState.data.group?.log ?? []).some((entry) => entry.kind === 'transfer'),
  (funnelState.data.group?.log ?? []).find((entry) => entry.kind === 'transfer')?.target ?? '未触发',
)

const bioGet = await call('GET', '/biography')
check('GET /biography', Array.isArray(bioGet.data.events) && bioGet.data.events.length > 0, `${bioGet.data.events?.length} 个事件`)

const edited = bioGet.data.events.map((event, index) =>
  index === 0 ? { ...event, title: '改过的第一个事件', narrative: '我把它改写了。' } : event,
)
const bioPost = await call('POST', '/biography', { events: edited })
check(
  'POST /biography 并按新人生重建',
  bioPost.data.snapshot?.timeline?.[0]?.title === '改过的第一个事件',
  bioPost.data.snapshot?.timeline?.[0]?.title ?? '',
)
const memory = await call('GET', '/memory?tier=subconscious&limit=5')
check('GET /memory', memory.status === 200 && Array.isArray(memory.data.items), `${memory.data.items?.length} 条潜意识`)

const settings = await call('POST', '/settings', { useLlm: true })
check('POST /settings', settings.status === 200 && settings.data.snapshot?.settings?.useLlm === true, '语言区可切换')
await call('POST', '/settings', { useLlm: false })

const llmSettings = await call('POST', '/settings', {
  llm: {
    baseURL: 'https://example.test/v1',
    model: 'demo-model',
    apiKey: 'sk-test-1234567890',
    profiles: {
      appraisal: { enabled: true, model: 'cheap-model', baseURL: 'https://cheap.test/v1', apiKey: 'sk-cheap-0000' },
      broca: { enabled: true, model: '', baseURL: '', apiKey: '' },
      reflection: { enabled: false },
    },
  },
  snowluma: { allowGroups: ['576268399'], sendEnabled: false },
})
const cfg = llmSettings.data.snapshot?.llmConfig
check(
  '每个逻辑一套模型（可不同 key）',
  cfg?.baseURL === 'https://example.test/v1' &&
    cfg?.hasKey === true &&
    cfg.keyMask.includes('…') &&
    cfg.profiles.find((p) => p.name === 'appraisal')?.model === 'cheap-model' &&
    cfg.profiles.find((p) => p.name === 'appraisal')?.baseURL === 'https://cheap.test/v1' &&
    cfg.profiles.find((p) => p.name === 'memory')?.enabled === false,
  `${cfg?.model} · ${cfg?.keyMask} · appraisal=${cfg?.profiles?.find((p) => p.name === 'appraisal')?.model}`,
)
check(
  '群白名单生效',
  (llmSettings.data.snapshot?.snow?.allowGroups ?? []).join(',') === '576268399',
  (llmSettings.data.snapshot?.snow?.allowGroups ?? []).join(','),
)
await call('POST', '/settings', {
  llm: { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '', profiles: {} },
})

/* —— LLM 钳制层：不合规的输出必须被截断或被丢弃 —— */
const makeStream = (payload) =>
  (async function* stream() {
    yield { type: 'text-delta', index: 0, text: payload }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()

const validLlm = {
  stream: () =>
    makeStream(
      JSON.stringify({
        perceived_subtext: '他在试探我',
        prediction_error: 0.91,
        touches_core_schema: false,
        neuro_delta: { dopamine: 9, cortisol: -9, intimacy_delta: -99 },
        inner_monologue: '烦，别来烦我',
        action_route: 'REPLY_CURRENT',
        transfer_target_qq: null,
        bubbles: ['这句话特别特别长已经远远超过了预算允许的字数上限', '第二句。带句号！'],
        trigger_regret_recall: true,
        expect_reply_within_sec: 99999,
      }),
    ),
}
const brainWithLlm = new BibaoBrain({
  biography,
  seed: 7,
  startMs: Date.now(),
  virtual: true,
  llm: validLlm,
  llmProvider: 'stub',
  llmModel: 'stub',
})
brainWithLlm.social.upsert({ qq: 'owner', name: '我', intimacy: 42, trust: 58 })
const llmTurn = await brainWithLlm.perceive({ entityId: 'owner', text: '在干嘛呢', channel: 'private' })
const bubbles = llmTurn.dual?.bubbles ?? []
const totalChars = bubbles.join('').length
check(
  'LLM 输出：预算截断 + 去标点',
  llmTurn.dual?.meta?.source === 'llm' &&
    totalChars <= llmTurn.budget.maxChars &&
    !/[。！？]/.test(bubbles.join('')),
  `${totalChars}/${llmTurn.budget.maxChars} 字 · ${bubbles.join(' / ')}`,
)
check(
  'LLM 输出：neuro_delta 被限幅',
  Math.abs(llmTurn.dual.neuro_delta.dopamine) <= 0.15 &&
    Math.abs(llmTurn.dual.neuro_delta.intimacy_delta) <= 4 &&
    llmTurn.dual.expect_reply_within_sec <= 3600,
  JSON.stringify(llmTurn.dual.neuro_delta),
)

const brokenLlm = {
  stream: () => makeStream('这不是 JSON，我只是在胡说八道'),
}
const brainBroken = new BibaoBrain({
  biography,
  seed: 8,
  startMs: Date.now(),
  virtual: true,
  llm: brokenLlm,
  llmProvider: 'stub',
  llmModel: 'stub',
})
const brokenTurn = await brainBroken.perceive({ entityId: 'owner', text: '在干嘛呢', channel: 'private' })
check(
  'LLM 乱码时回落本地布洛卡',
  brokenTurn.dual?.meta?.source === 'local' && (brokenTurn.dual?.bubbles ?? []).length > 0,
  brokenTurn.dual?.meta?.llmError ?? '',
)

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail ?? ''}`)
const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)

for (const dispose of cleanups) dispose()
await new Promise((resolve) => setTimeout(resolve, 1600))
await rm(dir, { recursive: true, force: true })
process.exit(failed.length ? 1 : 0)
