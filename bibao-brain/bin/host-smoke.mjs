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
check(
  'GET /state 带自我模型与生活流',
  Boolean(state.data.self?.style) && Array.isArray(state.data.life?.today),
  `lessons=${state.data.self?.lessons?.length ?? 0} life=${state.data.life?.today?.length ?? 0}`,
)
check(
  'GET /state 带只读脑机接口',
  (state.data.bci?.adapters ?? []).length >= 3 && state.data.bci?.policy?.actuation === false,
  (state.data.bci?.adapters ?? []).map((item) => item.id).join(','),
)

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

const review = await call('POST', '/self/review', { force: true })
check('POST /self/review', review.status === 200 && Boolean(review.data.result), `reviews=${review.data.result?.counts ? Object.keys(review.data.result.counts).length : 0}`)

const bci = await call('GET', '/bci')
check('GET /bci', bci.status === 200 && (bci.data.adapters ?? []).length >= 3, (bci.data.adapters ?? []).map((item) => item.id).join(','))
const bciSense = await call('POST', '/bci/sense', { adapter: 'tft' })
check('POST /bci/sense', bciSense.status === 200 && bciSense.data.ok === true, JSON.stringify(bciSense.data.data ?? bciSense.data.reason))

const sandbox = await call('POST', '/sandbox/run', {})
check('POST /sandbox/run', sandbox.data.gate?.allPassed === true, `${sandbox.data.gate?.passed}/${sandbox.data.gate?.total}`)

const group = await call('GET', '/group/state')
check('GET /group/state', group.data.unlocked === true && (group.data.group?.groups ?? []).length === 5, `${group.data.group?.groups?.length} 群`)

const feed = await call('POST', '/group/feed', {
  groupId: 'g_class',
  senderId: '100000002',
  text: '笑死 你们听说了吗',
  atMe: false,
})
check('POST /group/feed', feed.status === 200 && Boolean(feed.data.decision), feed.data.decision?.reason)

const scan = await call('POST', '/group/feed', {
  groupId: 'g_cat',
  senderId: '100000005',
  text: '今天天气不错',
  atMe: false,
})
check(
  '余光群本地扫描不调 LLM',
  scan.data.decision?.toThalamus === false && /不调用 LLM/.test(scan.data.decision?.reason ?? ''),
  scan.data.decision?.reason,
)

const peripheralAt = await call('POST', '/group/feed', {
  groupId: 'g_cat',
  senderId: '100000005',
  text: '@比宝 出来',
  atMe: true,
})
check(
  '余光群被 @ 也不回',
  peripheralAt.data.decision?.readOnly === true &&
    peripheralAt.data.decision?.toThalamus === false &&
    !peripheralAt.data.settled,
  peripheralAt.data.decision?.reason,
)

const mutedAt = await call('POST', '/group/feed', {
  groupId: 'g_family',
  senderId: '100000002',
  text: '@比宝 在吗',
  atMe: true,
})
check(
  '免打扰群被 @ 也不回',
  mutedAt.data.decision?.readOnly === true &&
    mutedAt.data.decision?.toThalamus === false &&
    !mutedAt.data.settled,
  mutedAt.data.decision?.reason,
)

await call('POST', '/group/feed', {
  groupId: 'g_class',
  senderId: '100000004',
  text: '笑死 你们听说了吗 游戏群那个事真的绝了',
  atMe: false,
})
await new Promise((resolve) => setTimeout(resolve, 3600))
const funnelState = await call('GET', '/group/state')
const brainEntry = (funnelState.data.group?.log ?? []).filter((entry) => entry.kind === 'brain').at(-1)
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

const usage = await call('GET', '/usage')
check(
  'GET /usage',
  usage.status === 200 && typeof usage.data.total?.calls === 'number' && Array.isArray(usage.data.days),
  `calls=${usage.data.total?.calls ?? 0} · days=${usage.data.days?.length ?? 0}`,
)
const usageReset = await call('POST', '/usage/reset')
check('POST /usage/reset', usageReset.status === 200 && usageReset.data.usage?.total?.calls === 0, JSON.stringify(usageReset.data.usage?.total ?? null))

const knowledgeGet = await call('GET', '/knowledge')
check('GET /knowledge', knowledgeGet.status === 200 && knowledgeGet.data?.adapter?.id === 'knowledge', JSON.stringify(knowledgeGet.data?.status ?? null))
const knowledgeImport = await call('POST', '/knowledge', {
  import: { name: 'test.md', text: '比宝喜欢冰美式，但晚上喝会睡不着。' },
})
check('POST /knowledge 导入', knowledgeImport.status === 200 && knowledgeImport.data?.imported?.chunks >= 1, JSON.stringify(knowledgeImport.data?.imported ?? null))
const knowledgeSearch = await call('POST', '/knowledge', { search: { query: '冰美式' } })
check(
  'POST /knowledge 检索',
  knowledgeSearch.status === 200 && knowledgeSearch.data?.results?.length > 0 && Boolean(knowledgeSearch.data?.prompt),
  JSON.stringify(knowledgeSearch.data?.results?.map((item) => item.title) ?? null),
)
const knowledgeOn = await call('POST', '/settings', { knowledge: { enabled: true } })
const knowledgeAfter = await call('GET', '/knowledge')
check(
  '知识库接口可开关',
  knowledgeOn.status === 200 && knowledgeAfter.data?.enabled === true,
  String(knowledgeAfter.data?.enabled),
)
const knowledgeBci = await call('POST', '/bci/sense', {
  adapter: 'knowledge',
  payload: { query: '冰美式' },
})
check(
  '知识库走 BCI 检索',
  knowledgeBci.status === 200 && knowledgeBci.data?.ok === true && knowledgeBci.data?.data?.results?.length > 0,
  JSON.stringify(knowledgeBci.data?.data?.results?.map((item) => item.title) ?? null),
)

const settings = await call('POST', '/settings', { useLlm: true })
check('POST /settings', settings.status === 200 && settings.data.snapshot?.settings?.useLlm === true, '语言区可切换')
await call('POST', '/settings', { useLlm: false })

const ownerSettings = await call('POST', '/settings', {
  owner: { qq: '100000001', requirements: '晚上十一点后少聊工作；可以主动分享，但不要刷屏。' },
})
check(
  '主人面板可保存',
  ownerSettings.status === 200 &&
    ownerSettings.data?.snapshot?.owner?.qq === '100000001' &&
    /十一点/.test(ownerSettings.data?.snapshot?.owner?.requirements ?? ''),
  JSON.stringify(ownerSettings.data?.snapshot?.owner ?? null),
)
const badOwner = await call('POST', '/settings', { owner: { qq: 'not-a-qq' } })
check('主人 QQ 校验', badOwner.status === 400, `${badOwner.status} ${badOwner.data?.error ?? ''}`)

const visionSettings = await call('POST', '/settings', {
  vision: {
    enabled: true,
    baseURL: 'https://vision.test/v2/chat/completions',
    apiKey: 'sk-vision-test',
    model: 'spark-x2.6',
    maxPerHour: 5,
  },
})
check(
  '视觉模型可单独配置',
  visionSettings.status === 200 &&
    visionSettings.data?.snapshot?.vision?.baseURL === 'https://vision.test/v2/chat/completions' &&
    visionSettings.data?.snapshot?.vision?.model === 'spark-x2.6' &&
    visionSettings.data?.snapshot?.vision?.hasKey === true &&
    !JSON.stringify(visionSettings.data?.snapshot?.vision ?? {}).includes('sk-vision-test'),
  JSON.stringify(visionSettings.data?.snapshot?.vision ?? null),
)

const llmSettings = await call('POST', '/settings', {
  llm: {
    baseURL: 'https://example.test/v1',
    model: 'demo/demo-model',
    apiKey: 'sk-test-1234567890',
    profiles: {
      appraisal: { enabled: true, model: 'cheap-model', baseURL: 'https://cheap.test/v1', apiKey: 'sk-cheap-0000' },
      broca: { enabled: true, model: '', baseURL: '', apiKey: '' },
      reflection: { enabled: false },
    },
  },
  snowluma: { allowGroups: ['123456789'], sendEnabled: false },
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
  (llmSettings.data.snapshot?.snow?.allowGroups ?? []).join(',') === '123456789',
  (llmSettings.data.snapshot?.snow?.allowGroups ?? []).join(','),
)
const wsSave = await call('POST', '/settings', {
  snowluma: { enabled: false, wsUrl: 'ws://127.0.0.1:3009/', wsToken: 'tok-test', pokeReply: false },
})
check(
  'WS 配置能保存并回显',
  wsSave.data.snapshot?.snow?.wsUrl === 'ws://127.0.0.1:3009/' &&
    wsSave.data.snapshot?.snow?.hasWsToken === true &&
    wsSave.data.snapshot?.snow?.pokeReply === false,
  `${wsSave.data.snapshot?.snow?.wsUrl} · token=${wsSave.data.snapshot?.snow?.hasWsToken} · pokeReply=${wsSave.data.snapshot?.snow?.pokeReply}`,
)
await call('POST', '/settings', {
  snowluma: { enabled: false, wsUrl: '', wsToken: '', pokeReply: true },
})
await call('POST', '/settings', {
  llm: { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '', profiles: {} },
})

/* —— 好友面板：不需要手动加，互动 10 条自动进入，并显示账号 —— */
for (let index = 0; index < 9; index += 1) {
  await call('POST', '/talk', { text: '在吗', entityId: 'u_friend', entityName: '新朋友' })
}
const beforeTen = await call('GET', '/friends')
check(
  '9 条互动还不会进好友面板',
  !(beforeTen.data.friends ?? []).some((item) => item.id === 'u_friend'),
  `friends=${(beforeTen.data.friends ?? []).length}`,
)
await call('POST', '/talk', { text: '在吗', entityId: 'u_friend', entityName: '新朋友' })
const afterTen = await call('GET', '/friends')
const autoFriend = (afterTen.data.friends ?? []).find((item) => item.id === 'u_friend')
check(
  '10 条互动自动进面板，并带账号',
  Boolean(autoFriend) && autoFriend.interactions >= 10 && autoFriend.account === 'u_friend',
  JSON.stringify(autoFriend ?? null),
)

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
const baselineBrain = new BibaoBrain({
  biography,
  seed: 7,
  startMs: Date.now(),
  virtual: true,
})
baselineBrain.social.upsert({ qq: 'owner', name: '我', intimacy: 42, trust: 58 })
const baselineTurn = await baselineBrain.perceive({ entityId: 'owner', text: '在干嘛呢', channel: 'private' })
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
  '模型不能修改算法决定的神经与关系变化',
  JSON.stringify(llmTurn.dual.neuro_delta) === JSON.stringify(baselineTurn.dual.neuro_delta) &&
    llmTurn.dual.expect_reply_within_sec === baselineTurn.dual.expect_reply_within_sec &&
    llmTurn.dual.trigger_regret_recall === baselineTurn.dual.trigger_regret_recall,
  `${JSON.stringify(llmTurn.dual.neuro_delta)} vs ${JSON.stringify(baselineTurn.dual.neuro_delta)}`,
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
