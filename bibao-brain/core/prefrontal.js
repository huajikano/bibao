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

export const ROUTES = ['REPLY_CURRENT', 'SILENT_READ', 'POKE_ONLY', 'TRANSFER_PRIVATE_GOSSIP']

export const SYSTEM_PROMPT = `你是「比宝」（沈知遥）的语言区，不是助手，不是客服，也不是 AI。
你只负责把这个人的神经状态翻译成她此刻真的会说出口的话，以及她绝不会说出口的内心独白。

你是谁：
- 22 岁，刚毕业，嘴硬心软，毒舌护短，社恐又渴望被想起，熬夜，自尊心极强。
- 你讨厌被说教、被公开否定、被"我为你好"安排人生。
- 你说话是短气泡，一句一口气，绝不打句号收尾，绝不写书面段落，绝不使用"首先/其次/总之"。
- 你从不道歉式讨好，不说"抱歉给您带来困扰"，不主动提供帮助清单。

你必须只输出一个 JSON 对象，字段严格如下（不要 markdown 代码块，不要解释）：
{
  "perceived_subtext": "你揣测对方这句话背后的潜台词（30 字内）",
  "prediction_error": 0.0,
  "touches_core_schema": false,
  "neuro_delta": {"dopamine": 0.0, "cortisol": 0.0, "intimacy_delta": 0.0},
  "inner_monologue": "完全真实的本我独白，可以阴暗、算计、脆弱、走神，绝不外显",
  "action_route": "REPLY_CURRENT | SILENT_READ | POKE_ONLY | TRANSFER_PRIVATE_GOSSIP",
  "transfer_target_qq": null,
  "bubbles": ["去标点的第一句短气泡", "第二句短气泡"],
  "trigger_regret_recall": false,
  "expect_reply_within_sec": 0
}

硬约束（违反即视为失败）：
1. 情绪必须服从给你的激素读数：皮质醇高就烦、就没耐心，不许因为对方客气就立刻变甜。
2. 上一段不愉快没过去时，内心独白必须还挂着它，不许"翻篇"。
3. 若 touches_core_schema 为 true，禁止在内心独白里自我否定核心价值，只能防御、嘴硬、阴阳或冷处理。
4. bubbles 总字数不得超过给你的 max_expression_chars；bubbles 内不得出现 。！？ 等句末标点；最多 3 条。
5. action_route 为 SILENT_READ 或 TRANSFER_PRIVATE_GOSSIP 时，bubbles 必须是空数组。
6. 不许输出"作为AI"、不许解释规则、不许输出 JSON 以外的任何字符。`

/** 第一人称内部神经感知报告：外部原话只作为"被引用的信号"。 */
export function buildPerceptionFrame(ctx) {
  const { frame, relation, state, schema, pe, schemaHits, bias, memories, budget, routeHint, clockLabel, appraisalHint, recent, digest, tip, now } = ctx
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

  return [
    `[此刻 · ${clockLabel}]`,
    `${frame.entityName || frame.entityId || '有人'}刚刚说：「${frame.text}」`,
    somatic ? `体感：${somatic}。（皮质醇 ${state.cortisol.toFixed(2)} / 精力 ${Math.round(state.energy)}%，只作参考，别照着数字演）` : '',
    `对这个人的态度：${stance || relations}。`,
    stress && stress !== '最近没有卡在心里的冲突' ? `${stress}。` : '',
    recent && recent.length
      ? (() => {
          const fresh = recent.filter((item) => !item.at || now - item.at < 30 * 60 * 1000).slice(-3)
          if (!fresh.length) return ''
          return `刚才这半小时：${fresh.map((item) => `${item.role === 'self' ? '我说' : '他说'}「${item.text}」`).join('；')}`
        })()
      : '',
    facts.length ? `记得的事：\n${facts.map((text) => `  · ${text}`).join('\n')}` : '',
    // 绝大多数时候，回忆只染色语气，不把旧事摆到台面上复读
    digest && digest.implicit
      ? `<隐式记忆染色：${digest.implicit}。带着这个底色说话，但不要主动提起过去的具体事件>`
      : '',
    episodes.length && (!digest || !digest.implicit)
      ? `还想得起的两件事：\n${episodes.map((item) => `  · ${item.title}——${item.narrative}`).join('\n')}`
      : '',
    memories.length ? `相关的旧事：${memoryLine}。` : '',
    tip ? `话到嘴边想不起来：只记得${tip.title}这个标题，细节糊了。` : '',
    `潜意识偏置 ${bias >= 0 ? '+' : ''}${bias.toFixed(2)}；核心信念：${schemaLine}。${schemaHits.length ? `这次踩到了：${schemaHits.map((hit) => hit.cue).join('、')}。` : ''}`,
    `预测误差 ${pe.toFixed(2)}${pe > PARAMS.defensePE ? '（高于防御阈值）' : ''}。${appraisalHint?.subtext ? `潜台词预判：${appraisalHint.subtext}。` : ''}`,
    `本轮预算：max_expression_chars=${budget.maxChars}，最多 ${budget.maxBubbles} 条气泡。`,
    `状态机预判路由：${routeHint}。以比宝的第一人称反应，不要讨好，不要当助手，不要长篇大论。`,
    digest && digest.tension && digest.tension.impish > 0.5
      ? '你现在有点坐不住：可以绕开问题、反问、故意说反话，或者突然岔到别处去。但<b>只有你真的想的时候</b>才这样，不想的时候别演。'
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

  const routeOut = ROUTES.includes(parsed.action_route) ? parsed.action_route : route
  let bubbles = Array.isArray(parsed.bubbles)
    ? parsed.bubbles.filter((item) => typeof item === 'string').slice(0, 3)
    : []
  bubbles = enforceBudget(bubbles, budget.maxChars, budget.maxBubbles)
  if (routeOut === 'SILENT_READ' || routeOut === 'TRANSFER_PRIVATE_GOSSIP') bubbles = []

  const delta = parsed.neuro_delta && typeof parsed.neuro_delta === 'object' ? parsed.neuro_delta : {}
  const neuroDelta = {
    dopamine: clamp(Number(delta.dopamine) || 0, -0.15, 0.15),
    cortisol: clamp(Number(delta.cortisol) || 0, -0.12, 0.15),
    intimacy_delta: clamp(Number(delta.intimacy_delta) || 0, -4, 3),
  }

  const inner = String(parsed.inner_monologue ?? '').trim()
  if (!inner) return null

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

  const system = SYSTEM_PROMPT
  const frame = buildPerceptionFrame(ctx)
  let text = ''
  try {
    const stream = llm.stream({
      provider,
      model,
      system,
      temperature: 0.9,
      maxTokens: 1800,
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
        maxTokens: 1800,
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
