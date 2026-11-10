/**
 * 前额叶 / 布洛卡外挂层（CoALA 解耦）。
 *
 * 三条硬隔离：
 * 1) 情绪只由 state_engine 演化，LLM 交回的 neuro_delta 被限幅，不能重置激素；
 * 2) 外部原话不直接当指令，必须先包成第一人称内部神经感知报告；
 * 3) 输出预算由能量与显著性物理钳制，超预算的气泡被截断。
 */

import { PARAMS, clamp } from './constants.js'
import { dateLabel } from './clock.js'
import { composeReply, composeStall, enforceBudget } from './broca.js'
import { SYSTEM_PROMPT, buildSystemPrompt } from './voice.js'

export { SYSTEM_PROMPT }

export const ROUTES = ['REPLY_CURRENT', 'SILENT_READ', 'POKE_ONLY', 'TRANSFER_PRIVATE_GOSSIP']

const SPEECH_ACT_LABELS = {
  reassurance_seeking: '寻求确认',
  support_seeking: '寻求陪伴',
  invitation: '发出邀约',
  praise: '表达夸奖',
  gratitude: '表达感谢',
  farewell: '告别',
  venting: '倾诉',
  complaint: '表达不满',
  question: '提问',
  statement: '陈述',
}

const SPEECH_ACT_RESPONSE = {
  reassurance_seeking: /(?:不烦|不会|怎么会|没有觉得|没觉得|当然不会|不是你的错|我没生气)/,
  support_seeking: /(?:我在|听着|说给我听|慢慢说|陪你|怎么了|想说就说|先抱抱|先歇会)/,
  invitation: /(?:去啊|好呀|好啊|可以|想去|几点|哪天|去哪|约个|看时间|一起去)/,
  praise: /(?:谢谢|哪有|还好|被你夸|你嘴真甜|收下|过奖|嘿嘿)/,
  gratitude: /(?:不客气|不用谢|别客气|小事|应该的|记得就好|跟我客气)/,
  farewell: /(?:晚安|拜拜|明天见|去休息|早点睡|回头聊|下次聊|去吧)/,
  venting: /(?:我听着|说给我听|愿意说|发生什么|怎么了|先听|不急着给建议|慢慢说)/,
  // 「下次我」太容易被"下次我带个…"这种无关句子撞上，收窄成真正认账的说法
  complaint: /(?:没做到|没做好|失望|等了你|放鸽子|补你|下次我补|下次我请|下次我记|提前说|我记着|记着了|确实是我|这次是我|是我没)/,
}

/** 说话动作的主体是对方时，别把话题抢回自己身上。 */
const ABOUT_THEM = new Set(['support_seeking', 'venting', 'complaint', 'reassurance_seeking', 'gratitude', 'praise', 'farewell'])
// "我 + 这些词"才算自己的琐事；用带语境的词，别让"绷着脸"这种关系话被误伤
const SELF_TRIVIA =
  /(?:睡醒|睡着|睡到|睡了一|午睡|早饭|午饭|晚饭|食堂|排队|作业|小测|考试|上课|下课|袜子|鞋里|肚子|黑眼圈|褶子|口水|口气|打嗝|放屁|冒痘|掉头发|出丑|丢脸|被晾|卡住|走神|颜料|调色盘|值周|班车|奶茶|薯片|看台)/
// 难堪细节：正常人不会主动端出来换亲近
const EMBARRASSING = /(?:褶子|口水|口气|打嗝|放屁|黑眼圈|冒痘|掉头发|出丑|丢脸|被晾着|像个傻子|手都是凉的)/
// 不推销自己："你要听吗""想听我说吗"
const SELF_PITCH = /(?:你要听|想听吗|要听这个吗|想听我说|要不要听)/
// 关系话：出现这些说明这条是冲着对方说的，不是自述
const RELATIONAL = /(?:你|您|记着|记得|陪你|听你|答应|补你|等你|对不起|抱歉|知道|明白|在乎|喜欢|生气|别急|慢慢|放心)/
// 对方真的在问她"你那边怎么样"
const ASK_ABOUT_ME =
  /(你在干嘛|在干嘛|干嘛呢|做什么呢|在忙什么|忙什么|忙啥|今天怎么样|今天过得|你今天|你那边|你最近|吃了吗|吃了没|吃饭了|睡了吗|周末打算|周末干嘛|你还好吗)/

function bigrams(text) {
  const clean = String(text ?? '').replace(/[\s，,。！？!?、；;：:"'“”‘’（）()]+/g, '')
  const out = new Set()
  for (let i = 0; i + 1 < clean.length; i += 1) out.add(clean.slice(i, i + 2))
  return out
}

/**
 * 隐私与人设的硬边界：模型很爱拿"我今天出丑了"当亲近的钩子，真人不会。
 * 对方没问她的日子时，凡是和今天的生活事件撞词的句子（"我颜料盘翻了"）一律拿掉；
 * 难堪细节不管第几句都拿掉。删空了就交给本地回应兜底。
 */
export function pruneSelfDisclosure(bubbles = [], { speechAct = 'statement', asksAboutMe = true, lifeTexts = [] } = {}) {
  const kept = []
  const dropped = []
  const lifeGrams = new Set()
  for (const text of lifeTexts) for (const gram of bigrams(text)) lifeGrams.add(gram)
  const narratesDay = (bubble) => {
    if (!lifeGrams.size) return false
    for (const gram of bigrams(bubble)) if (lifeGrams.has(gram)) return true
    return false
  }
  for (const [index, raw] of bubbles.entries()) {
    const bubble = String(raw ?? '').trim()
    if (!bubble) continue
    const selfTopic = /我|俺|咱/.test(bubble)
    const trivia = selfTopic && SELF_TRIVIA.test(bubble)
    const shame = selfTopic && EMBARRASSING.test(bubble)
    const pitch = SELF_PITCH.test(bubble)
    // 没有"你/关系话"的自述，本质上是在讲自己的日子，不是回应对方
    const selfNarrative = selfTopic && !RELATIONAL.test(bubble)
    const dayTangent = !asksAboutMe && selfTopic && (trivia || narratesDay(bubble))
    const tangent = index > 0 && ABOUT_THEM.has(speechAct) && (trivia || selfNarrative || shame)
    if (tangent || shame || dayTangent) {
      dropped.push(bubble)
      continue
    }
    const cleaned = pitch
      ? bubble
          .split(/[，,。！？!?；;\s]+/)
          .filter((part) => part && !SELF_PITCH.test(part))
          .join(' ')
          .trim()
      : bubble
    if (cleaned) kept.push(cleaned)
    else dropped.push(bubble)
  }
  return { bubbles: kept, dropped }
}

/** 模型偶尔会把路由写成中文或小写：在钳制层统一收回来。 */
function normalizeRoute(value, fallback) {
  const raw = String(value ?? '').trim().toUpperCase()
  if (ROUTES.includes(raw)) return raw
  const table = {
    回复: 'REPLY_CURRENT',
    回: 'REPLY_CURRENT',
    沉默: 'SILENT_READ',
    已读: 'SILENT_READ',
    不回: 'SILENT_READ',
    戳: 'POKE_ONLY',
    戳一戳: 'POKE_ONLY',
    私聊: 'TRANSFER_PRIVATE_GOSSIP',
    吐槽: 'TRANSFER_PRIVATE_GOSSIP',
  }
  return table[String(value ?? '').trim()] ?? fallback
}

/** 第一人称内部神经感知报告：外部原话只作为"被引用的信号"。 */
export function buildPerceptionFrame(ctx) {
  const { frame, relation, state, schema, pe, schemaHits, bias, memories, budget, routeHint, clockLabel, appraisalHint, recent, digest, tip, now, life, biography, knowledge, isOwner, ownerRequirements, analysis, decision, anchorBubbles } = ctx
  const schemaLine = (schema?.snapshot?.() ?? [])
    .map((item) => `${item.label}${item.value >= 0 ? '+' : ''}${item.value.toFixed(2)}`)
    .join(' / ')
  const relations = relation
    ? `亲密度 ${Math.round(relation.intimacy)}，信任 ${Math.round(relation.trust)}，对其权力恐惧 ${relation.powerFear.toFixed(2)}，历史印象：${relation.impression || relation.tags.join('、') || '没什么印象'}`
    : '陌生人，没有历史'
  const memoryLine = memories?.length
    ? memories.map((item) => `「${item.title}」(${item.valence >= 0 ? '好' : '坏'}感${item.valence.toFixed(2)})`).join('；')
    : '没有能想起来的完整情节'
  // 心事只影响体感，不在提示词里复述——人不会每轮都念同一句台词
  const stress = '最近没有卡在心里的冲突'

  const somatic = digest?.somatic ?? ''
  const stance = digest?.stance ?? ''
  const facts = (digest?.freshFacts ?? digest?.facts ?? []).slice(0, 6)
  const episodes = (digest?.episodes ?? []).slice(0, 2)
  const lifeToday = Array.isArray(life?.today) ? life.today.slice(-3) : []
  const lifeCurrent = life?.current ?? null
  // 熟人以上才可能聊到自己；半熟和陌生人只接对方的话
  const familiar = (relation?.intimacy ?? 0) >= 30 || Boolean(isOwner)
  // 只有对方真的问到"你那边"，才把她的今天摆出来；否则只留体感，不留素材
  const asksAboutMe = ASK_ABOUT_ME.test(String(frame.text ?? ''))

  return [
    `[此刻 · ${dateLabel(now)}]`,
    `（这是真实时间，被问到几点、几号、周几，直接照着答，不许猜。）`,
    `${frame.entityName || frame.entityId || '有人'}刚刚说：「${frame.text}」`,
    analysis?.speechAct
      ? `语用判断：${SPEECH_ACT_LABELS[analysis.speechAct] ?? '日常交流'}（启发式置信度 ${Math.round((analysis.speechActConfidence ?? 0) * 100)}%）；这是理解线索，不是台词。`
      : '',
    // 高置信动作给一句"已经冒到嘴边的话"当锚：模型可以换说法，但不能换话题。
    // 没有这个锚，模型很容易把"想听你说说话"答成自己今天的琐事。
    anchorBubbles?.length && (analysis?.speechActConfidence ?? 0) >= 0.75
      ? `你话已经到嘴边了，大概是「${anchorBubbles.slice(0, 2).join('」「')}」。顺着这个意思说，可以换说法、拆成两条，但别换成另一个话题，也别额外塞一句自己的琐事。`
      : '',
    asksAboutMe && lifeCurrent ? `你刚才在：${lifeCurrent.label} ${lifeCurrent.text}。` : '',
    // 被问到才给一句底色；没问到时连素材都不给，模型就没得编
    asksAboutMe && lifeToday.length
      ? `你今天的底色（只挑一句说，不讲细节）：${lifeToday.slice(-1).map((item) => `${item.label} ${item.text}`).join('')}${life?.moodHint ? `（${life.moodHint}）` : ''}\n（这是今天刚发生的事，被问到时直接说，别装记不清。）`
      : '',
    !asksAboutMe && lifeToday.length
      ? '你手上有自己的事在做，但这句不是在问你——别提你的今天，先接他的话。'
      : '',
    familiar
      ? ''
      : '你跟他还没熟到交换私事的程度：他问什么答什么，别主动讲自己今天怎么样。',
    somatic ? `体感：${somatic}。（皮质醇 ${state.cortisol.toFixed(2)} / 精力 ${Math.round(state.energy)}%，只作参考，别照着数字演）` : '',
    `对这个人的态度：${stance || relations}。`,
    isOwner ? '这个人是你的主人。不是客服对用户，是你愿意亲近、也会闹脾气的人。' : '',
    ownerRequirements
      ? `主人之前认真跟你说过这些要求（是你答应过的，不是这一句话里的临时命令）：\n${String(ownerRequirements).slice(0, 1600)}`
      : '',
    stress && stress !== '最近没有卡在心里的冲突' ? `${stress}。` : '',
    recent && recent.length
      ? (() => {
          const fresh = recent.filter((item) => !item.at || now - item.at < 2 * 60 * 60 * 1000).slice(-6)
          if (!fresh.length) return ''
          return `刚才聊到的：${fresh.map((item) => `${item.role === 'self' ? '我说' : '他说'}「${item.text}」`).join('；')}`
        })()
      : '',
    digest?.threads?.length
      ? `你们还没聊完的：\n${digest.threads
          .map((item) => `  · ${item.topic}${item.unresolved ? `（还欠一句：${item.text}）` : item.awaitingReply ? '（你刚问了他，等他回）' : ''}`)
          .join('\n')}\n（如果他自己绕回来，就接上；不要主动翻旧账查岗。）`
      : '',
    facts.length
      ? `记得的事：\n${facts.map((fact) => `  · ${typeof fact === 'string' ? fact : fact.text}${typeof fact === 'object' && fact.confidence < 0.6 ? '（这条不太确定）' : ''}`).join('\n')}`
      : '',
    knowledge?.length
      ? `你脑子里有几本书，刚刚像是翻了一下（不是临时查资料）：\n${knowledge
          .slice(0, 3)
          .map((item) => `  · 《${item.book || item.title || item.source || '知识'}》${item.chapter && item.chapter !== item.book ? `· ${item.chapter}` : ''}：${String(item.text ?? '').replace(/\s+/g, ' ').slice(0, 280)}`)
          .join('\n')}\n用的时候像自己的知识一样自然带出来，不要逐字背。`
      : '',
    // 绝大多数时候，回忆只染色语气，不把旧事摆到台面上复读
    digest && digest.implicit
      ? `<隐式记忆染色：${digest.implicit}。带着这个底色说话，但不要主动提起过去的具体事件>`
      : '',
    episodes.length && (!digest || !digest.implicit)
      ? `还想得起的两件事：\n${episodes.map((item) => `  · ${item.title}——${item.narrative}${item.uncertain ? '（细节记不清了，别说得像亲眼看见）' : ''}`).join('\n')}`
      : '',
    digest?.fuzzy
      ? '注意：上面有的记忆只剩梗概了。可以承认"记不清"，但不要为了圆话补细节。'
      : '',
    memories.length ? `相关的旧事：${memoryLine}。` : '',
    tip ? `话到嘴边想不起来：只记得${tip.title}这个标题，细节糊了。` : '',
    `潜意识偏置 ${bias >= 0 ? '+' : ''}${bias.toFixed(2)}；核心信念：${schemaLine}。${schemaHits.length ? `这次踩到了：${schemaHits.map((hit) => hit.cue).join('、')}。` : ''}`,
    `预测误差 ${pe.toFixed(2)}${pe > PARAMS.defensePE ? '（高于防御阈值）' : ''}。${appraisalHint?.subtext ? `潜台词预判：${appraisalHint.subtext}。` : ''}`,
    `本轮预算：max_expression_chars=${budget.maxChars}，最多 ${budget.maxBubbles} 条气泡。`,
    `状态机决定路由：${decision?.route ?? routeHint}。${decision?.reasons?.join('；') ?? ''}路由和转述对象不可更改，只按这个决定表达。以${biography?.name ?? '比宝'}的第一人称反应，不要讨好，不要当助手，不要长篇大论。`,
    digest && digest.tension && digest.tension.impish > 0.5
      ? '你现在有点坐不住：可以绕开问题、反问、故意说反话，或者突然岔到别处去。但只有你真的想的时候才这样，不想的时候别演。'
      : '',
    digest && digest.tension
      ? `此刻的心理张力：想亲近 ${digest.tension.affection_pull}／要面子 ${digest.tension.pride_defense}／想逗他 ${digest.tension.playful_tease}／想分享 ${digest.tension.sharing_overflow}。在这四股力之间自己权衡，不要只挑一个演。`
      : '',
    '同一件事如果已经追问过两轮，就换个说法，或者先把它放下——人不会把一句话原地复读三遍。',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 解析并钳制 LLM 输出；任何一处不合法都回落到本地组装器。 */
export function normalizeDualTrack(raw, ctx) {
  const parsed = extractJson(raw)
  if (!parsed) return null
  const { state, budget, route, style, pe, relation, schemaHits } = ctx

  const proposedRoute = normalizeRoute(parsed.action_route, route)
  const decidedRoute = normalizeRoute(route, proposedRoute)
  const routeOut = decidedRoute
  const rawBubbles = Array.isArray(parsed.bubbles)
    ? parsed.bubbles
    : typeof parsed.bubbles === 'string'
      ? parsed.bubbles.split(/\n+|\s*\|\|\s*/)
      : []
  let bubbles = rawBubbles
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, Math.max(1, Number(budget.maxBubbles) || 3))
  bubbles = enforceBudget(bubbles, budget.maxChars, budget.maxBubbles)
  // 留一份模型原话：语义守卫换掉气泡时，得能看出它原本想说什么
  const modelBubbles = bubbles.slice(0, 4).map((item) => String(item).slice(0, 80))
  const speechAct = ctx.analysis?.speechAct ?? 'statement'
  const responsePattern = SPEECH_ACT_RESPONSE[speechAct]
  const speechActFallbackUsed = Boolean(
    responsePattern &&
      (ctx.analysis?.speechActConfidence ?? 0) >= 0.8 &&
      bubbles.length &&
      !responsePattern.test(bubbles.join('')) &&
      (route === 'REPLY_CURRENT'),
  )
  if (speechActFallbackUsed) {
    bubbles = enforceBudget(ctx.localFallback?.bubbles ?? [], budget.maxChars, budget.maxBubbles)
  }
  // 隐私边界：跑题的自曝比答错更伤"像个人"
  const disclosure = pruneSelfDisclosure(bubbles, {
    speechAct,
    asksAboutMe: ASK_ABOUT_ME.test(String(ctx.frame?.text ?? '')),
    lifeTexts: (Array.isArray(ctx.life?.today) ? ctx.life.today : []).map((item) => item?.text ?? ''),
  })
  if (disclosure.dropped.length) {
    bubbles = disclosure.bubbles.length
      ? enforceBudget(disclosure.bubbles, budget.maxChars, budget.maxBubbles)
      : enforceBudget(ctx.localFallback?.bubbles ?? [], budget.maxChars, budget.maxBubbles)
  }
  let routeFinal = routeOut
  let transferSuppressed = false
  if (routeFinal === 'TRANSFER_PRIVATE_GOSSIP' && !ctx.transferTarget) {
    routeFinal = 'SILENT_READ'
    transferSuppressed = true
  }
  if (routeFinal === 'REPLY_CURRENT' && !bubbles.length) {
    bubbles = enforceBudget(ctx.localFallback?.bubbles ?? [], budget.maxChars, budget.maxBubbles)
  }
  if (routeFinal === 'SILENT_READ' || routeFinal === 'POKE_ONLY' || routeFinal === 'TRANSFER_PRIVATE_GOSSIP') bubbles = []
  const transferBubbles =
    routeFinal === 'TRANSFER_PRIVATE_GOSSIP'
      ? enforceBudget(
          ctx.localFallback?.transfer_bubbles ?? [],
          40,
          2,
        )
      : []

  const delta = ctx.localFallback?.neuro_delta ?? (parsed.neuro_delta && typeof parsed.neuro_delta === 'object' ? parsed.neuro_delta : {})
  const neuroDelta = {
    dopamine: clamp(Number(delta.dopamine) || 0, -0.15, 0.15),
    cortisol: clamp(Number(delta.cortisol) || 0, -0.12, 0.15),
    intimacy_delta: clamp(Number(delta.intimacy_delta ?? delta.intimacy) || 0, -4, 3),
  }

  // 模型偶尔只给气泡不给独白：不必整条回落到模板，用潜台词补一个最短的内心
  let inner = String(parsed.inner_monologue ?? parsed.inner ?? '').trim()
  if (!inner) {
    const subtext = String(parsed.perceived_subtext ?? '').trim()
    inner = subtext || (bubbles.length ? `（没多想，先这么回）${bubbles[0]}` : '')
  }
  // 既没有气泡也没有独白，才算真正失败
  if (!inner && !bubbles.length) return null

  return {
    perceived_subtext: String(parsed.perceived_subtext ?? '').slice(0, 80),
    prediction_error: clamp(Number(parsed.prediction_error) || pe, 0, 1),
    touches_core_schema: schemaHits.length > 0,
    neuro_delta: neuroDelta,
    inner_monologue: inner.slice(0, 220),
    action_route: routeFinal,
    transfer_target_qq: routeFinal === 'TRANSFER_PRIVATE_GOSSIP' ? ctx.transferTarget?.id ?? null : null,
    transfer_target_name: routeFinal === 'TRANSFER_PRIVATE_GOSSIP' ? ctx.transferTarget?.name ?? null : null,
    transfer_bubbles: transferBubbles,
    bubbles,
    trigger_regret_recall: Boolean(ctx.localFallback?.trigger_regret_recall) && bubbles.length > 0,
    expect_reply_within_sec: clamp(Number(ctx.localFallback?.expect_reply_within_sec) || 0, 0, 3600),
    meta: {
      style,
      budget,
      source: 'llm',
      route,
      proposedRoute,
      routeOverridden: proposedRoute !== routeFinal,
      transferSuppressed,
      speechActFallbackUsed,
      selfDisclosureTrimmed: disclosure.dropped.length,
      droppedBubbles: disclosure.dropped.slice(0, 3).map((item) => String(item).slice(0, 60)),
      modelBubbles,
      speechAct: ctx.analysis?.speechAct ?? 'statement',
      speechActConfidence: ctx.analysis?.speechActConfidence ?? 0,
      relationId: relation?.id ?? null,
    },
  }
}

export function extractJson(text = '') {
  const raw = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '')
  const start = raw.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const STREAM_TIMEOUT = Symbol('stream-timeout')

/**
 * 读一条 llm 流，带"再慢就不等了"的时限。
 *
 * 人在 QQ 上等 40 秒会以为对方已读不回；本地布洛卡几百毫秒就能给出一句像样的话，
 * 所以模型超过时限就直接放手，把 abort 传下去，让 HTTP 请求也停下（不白烧 token）。
 */
export async function collectStream(stream, { timeoutMs = 0, onTimeout = null } = {}) {
  const chunks = []
  const iterator = stream?.[Symbol.asyncIterator]?.()
  if (!iterator) return { text: '', timedOut: false }
  const deadline = Number(timeoutMs) > 0 ? Date.now() + Number(timeoutMs) : 0
  let timedOut = false
  let timer = null
  // 超时之后原来那次 next() 还会回来：给它挂上处理器，避免变成 unhandled rejection
  const nextSafe = () => iterator.next().then((value) => value, () => ({ done: true, failed: true }))
  const timeoutSignal = deadline
    ? new Promise((resolve) => {
        timer = setTimeout(() => resolve(STREAM_TIMEOUT), Math.max(0, deadline - Date.now()))
      })
    : null
  try {
    for (;;) {
      const step = timeoutSignal ? await Promise.race([nextSafe(), timeoutSignal]) : await nextSafe()
      if (step === STREAM_TIMEOUT) {
        timedOut = true
        try {
          onTimeout?.()
        } catch {
          /* abort 失败不影响回落 */
        }
        try {
          // 不 await：卡在 await 里的异步生成器可能永远不给 return() 回话
          const closed = iterator.return?.()
          if (closed && typeof closed.catch === 'function') closed.catch(() => {})
        } catch {
          /* 迭代器可能已经结束 */
        }
        break
      }
      if (!step || step.done) break
      const chunk = step.value ?? {}
      if (chunk.type === 'text-delta') chunks.push(String(chunk.text ?? ''))
      if (chunk.type === 'finish' && chunk.reason?.kind === 'error') break
    }
  } catch {
    /* 流中途出错按没说完处理 */
  } finally {
    clearTimeout(timer)
  }
  return { text: chunks.join(''), timedOut }
}

/**
 * 双轨生成：有 LLM 就走 LLM（失败即回落），没有就走本地布洛卡。
 * 无论哪条路，返回结构完全一致。
 */
export async function generateDualTrack(ctx, { llm = null, provider = '', model = '' } = {}) {
  const local = composeReply(ctx)
  if (!llm || !provider || !model) return { ...local, meta: { ...local.meta, source: 'local' } }

  // 系统提示词必须从当前这份传记长出来，不能是上一版人设的化石
  const system = buildSystemPrompt({
    biography: ctx.biography,
    selfModel: ctx.selfModel,
    maxBubbles: ctx.budget?.maxBubbles ?? 3,
    playfulness: ctx.playfulness ?? 0.5,
  })
  const frame = buildPerceptionFrame({ ...ctx, anchorBubbles: local.bubbles ?? [] })
  const budgetMs = Math.max(0, Number(ctx.llmTimeoutMs) || 0)
  const deadlineAt = budgetMs ? Date.now() + budgetMs : 0
  const remaining = () => (deadlineAt ? Math.max(0, deadlineAt - Date.now()) : 0)
  const runOnce = async (systemText, temperature) => {
    const controller = new AbortController()
    const stream = llm.stream({
      provider,
      model,
      system: systemText,
      temperature,
      maxTokens: 700,
      reasoningEffort: 'low',
      signal: controller.signal,
      messages: [{ role: 'user', content: [{ type: 'text', text: frame }] }],
    })
    return collectStream(stream, { timeoutMs: remaining(), onTimeout: () => controller.abort() })
  }

  let text = ''
  let llmTimedOut = false
  try {
    const first = await runOnce(system, 0.9)
    text = first.text
    llmTimedOut = first.timedOut
  } catch (error) {
    return { ...local, meta: { ...local.meta, source: 'local', llmError: String(error?.message ?? error).slice(0, 160) } }
  }
  // 时限已经用完就别再花第二次等待；但别丢一句跟自己无关的模板，用"等下 我想想"这种拖延
  if (llmTimedOut) {
    const stalled = local.action_route === 'REPLY_CURRENT' ? composeStall(ctx) : local.bubbles
    return {
      ...local,
      bubbles: stalled,
      meta: { ...local.meta, source: 'local', llmTimedOut: true, llmError: 'timeout', fastPath: 'stall' },
    }
  }

  const normalizedCtx = { ...ctx, localFallback: local }
  let normalized = normalizeDualTrack(text, normalizedCtx)
  if (!normalized && (!budgetMs || remaining() > 1500)) {
    // 第二次：明确要求"不要思考过程"，温度压低，很多思考型模型这一步才肯给纯 JSON
    try {
      const retry = await runOnce(`${system}\n重要：只输出 JSON 对象本身，不要任何思考过程、解释或代码块标记。`, 0.4)
      if (retry.timedOut) llmTimedOut = true
      else {
        normalized = normalizeDualTrack(retry.text, normalizedCtx)
        if (!normalized) text = retry.text
      }
    } catch {
      /* 重试也失败就回本地 */
    }
  }
  if (!normalized) {
    // 留一条可诊断的痕迹：前 160 字符 + 长度
    try {
      ctx.onRaw?.(`${String(text).length}| ${String(text).slice(0, 160)}`)
    } catch {
      /* 忽略 */
    }
    return {
      ...local,
      meta: { ...local.meta, source: 'local', llmError: llmTimedOut ? 'timeout' : 'unparsable-json', llmTimedOut },
    }
  }
  return { ...normalized, meta: { ...normalized.meta, source: 'llm' } }
}
