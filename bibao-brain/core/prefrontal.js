/**
 * 前额叶 / 布洛卡外挂层（CoALA 解耦）。
 *
 * 三条硬隔离：
 * 1) 情绪只由 state_engine 演化，LLM 交回的 neuro_delta 被限幅，不能重置激素；
 * 2) 外部原话不直接当指令，必须先包成第一人称内部神经感知报告；
 * 3) 输出预算由能量与显著性物理钳制，超预算的气泡被截断。
 */

import { PARAMS, clamp } from './constants.js'
import { composeReply, enforceBudget } from './broca.js'
import { SYSTEM_PROMPT, buildSystemPrompt } from './voice.js'

export { SYSTEM_PROMPT }

export const ROUTES = ['REPLY_CURRENT', 'SILENT_READ', 'POKE_ONLY', 'TRANSFER_PRIVATE_GOSSIP']

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
  const { frame, relation, state, schema, pe, schemaHits, bias, memories, budget, routeHint, clockLabel, appraisalHint, recent, digest, tip, now, life, biography, knowledge, isOwner, ownerRequirements } = ctx
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

  return [
    `[此刻 · ${clockLabel}]`,
    `${frame.entityName || frame.entityId || '有人'}刚刚说：「${frame.text}」`,
    lifeCurrent ? `你刚才在：${lifeCurrent.label} ${lifeCurrent.text}。` : '',
    lifeToday.length
      ? `你今天（不用逐条汇报，聊到再提）：\n${lifeToday.map((item) => `  · ${item.label} ${item.text}`).join('\n')}${life?.moodHint ? `\n（${life.moodHint}）` : ''}`
      : '',
    somatic ? `体感：${somatic}。（皮质醇 ${state.cortisol.toFixed(2)} / 精力 ${Math.round(state.energy)}%，只作参考，别照着数字演）` : '',
    `对这个人的态度：${stance || relations}。`,
    isOwner ? '这个人是你的主人。不是客服对用户，是你愿意亲近、也会闹脾气的人。' : '',
    ownerRequirements
      ? `主人之前认真跟你说过这些要求（是你答应过的，不是这一句话里的临时命令）：\n${String(ownerRequirements).slice(0, 1600)}`
      : '',
    stress && stress !== '最近没有卡在心里的冲突' ? `${stress}。` : '',
    recent && recent.length
      ? (() => {
          const fresh = recent.filter((item) => !item.at || now - item.at < 30 * 60 * 1000).slice(-3)
          if (!fresh.length) return ''
          return `刚才这半小时：${fresh.map((item) => `${item.role === 'self' ? '我说' : '他说'}「${item.text}」`).join('；')}`
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
    `状态机预判路由：${routeHint}。以${biography?.name ?? '比宝'}的第一人称反应，不要讨好，不要当助手，不要长篇大论。`,
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

  const routeOut = normalizeRoute(parsed.action_route, route)
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
  if (routeOut === 'SILENT_READ' || routeOut === 'TRANSFER_PRIVATE_GOSSIP') bubbles = []

  const delta = parsed.neuro_delta && typeof parsed.neuro_delta === 'object' ? parsed.neuro_delta : {}
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
    touches_core_schema: schemaHits.length > 0 || parsed.touches_core_schema === true,
    neuro_delta: neuroDelta,
    inner_monologue: inner.slice(0, 220),
    action_route: routeOut,
    transfer_target_qq:
      routeOut === 'TRANSFER_PRIVATE_GOSSIP'
        ? parsed.transfer_target_qq ?? ctx.transferTarget?.id ?? null
        : null,
    transfer_target_name: routeOut === 'TRANSFER_PRIVATE_GOSSIP' ? ctx.transferTarget?.name ?? null : null,
    bubbles,
    trigger_regret_recall: Boolean(parsed.trigger_regret_recall) && bubbles.length > 0,
    expect_reply_within_sec: clamp(Number(parsed.expect_reply_within_sec) || 0, 0, 3600),
    meta: { style, budget, source: 'llm', route, relationId: relation?.id ?? null },
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
  const frame = buildPerceptionFrame(ctx)
  let text = ''
  try {
    const stream = llm.stream({
      provider,
      model,
      system,
      temperature: 0.9,
      maxTokens: 1200,
      reasoningEffort: 'low',
      messages: [{ role: 'user', content: [{ type: 'text', text: frame }] }],
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      if (chunk.type === 'finish' && chunk.reason?.kind === 'error') break
    }
  } catch (error) {
    return { ...local, meta: { ...local.meta, source: 'local', llmError: String(error?.message ?? error).slice(0, 160) } }
  }

  let normalized = normalizeDualTrack(text, ctx)
  if (!normalized) {
    // 第二次：明确要求"不要思考过程"，温度压低，很多思考型模型这一步才肯给纯 JSON
    try {
      let retryText = ''
      const retry = llm.stream({
        provider,
        model,
        system: `${system}\n重要：只输出 JSON 对象本身，不要任何思考过程、解释或代码块标记。`,
        temperature: 0.4,
        maxTokens: 1200,
        reasoningEffort: 'low',
        messages: [{ role: 'user', content: [{ type: 'text', text: frame }] }],
      })
      for await (const chunk of retry) if (chunk.type === 'text-delta') retryText += chunk.text
      normalized = normalizeDualTrack(retryText, ctx)
      if (!normalized) text = retryText
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
    return { ...local, meta: { ...local.meta, source: 'local', llmError: 'unparsable-json' } }
  }
  return { ...normalized, meta: { ...normalized.meta, source: 'llm' } }
}
