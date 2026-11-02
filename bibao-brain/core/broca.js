/**
 * 布洛卡区（本地语言组装器）。
 *
 * 它不是"客服话术库"，而是把神经状态翻译成语言：同一句话，在不同激素、
 * 不同关系、不同面具下会被组装成完全不同的气泡与内心独白。
 * 未配置 LLM 时由它独立完成双轨 JSON；配置 LLM 时它作为兜底与后置钳制。
 */

import { clamp } from './constants.js'

const POOLS = {
  mood: {
    furious: ['火还没下去', '太阳穴还跳着', '手还在抖'],
    irritated: ['心里堵着一团', '烦得不想说话', '耐性已经用完了'],
    low: ['整个人是空的', '没什么力气装热情', '只想躺着'],
    flat: ['没什么波澜', '就那样吧', '懒得有情绪'],
    soft: ['心里软了一下', '有点想笑', '难得没那么防备'],
    bright: ['心情居然不错', '今天还算顺', '有点想闹'],
  },
  subtext: {
    hostile: ['他不是在讲道理，是在找人垫脚', '这话不是冲事来的，是冲我来的', '想踩我一脚好显高'],
    preach: ['又是"我为你好"，想让我照他的剧本活', '说教的尽头是控制', '他不是关心我，是想赢'],
    care: ['他好像真的在担心我', '这句问得有点小心', '他是记得我昨天不舒服'],
    gossip: ['有瓜，而且是说出来会得罪人的那种', '这料够劲，但不该我接话', '群里有人要倒霉了'],
    question: ['随口一问，还是想找由头聊下去', '他想跟我说话，但没想好说什么', '这句问得有点试探'],
    desire: ['他在往我这边靠', '这话有点黏', '不想承认我有点受用'],
    flat: ['没什么信息量，就是想冒个泡', '一句日常，没别的意思', '就是随口'],
  },
  defense: {
    hit: ['凭什么由他来定义我', '这条底线不退', '他越界了'],
    tired: ['不想吵，但也不想认', '懒得解释，随他去', '记一笔，不回了'],
    fear: ['现在不能翻脸', '忍着，回头再算', '嘴上得好看点'],
  },
  impulse: {
    attack: ['话已经到嘴边了', '再忍就成软柿子了', '想直接怼回去'],
    withdraw: ['算了，说了也没用', '不想给他情绪价值', '关机算了'],
    soften: ['要不就顺着说一句', '今天不想吵', '给个台阶吧'],
  },
}

const BUBBLES = {
  banter: {
    hostile: [['你再说一遍', '就你这嘴还想教我', '行 你赢了 别烦我'], ['哟 长本事了', '冲我发火算什么', '有种当面说']],
    preach: [['少来这套', '你谁啊就教育我', '管好你自己'], ['听你的', '我早饿死了', '省省吧']],
    care: [['哟 还知道问', '死不了', '你才要注意'], ['干嘛 想我了', '难得听你说句人话']],
    gossip: [['细说', '哪个群 拉我', '快 我要听'], ['笑死 真的假的', '这瓜保熟吗']],
    question: [['在啊', '说', '刚醒 怎么了'], ['干嘛', '有事说事', '想我了就直说']],
    flat: [['嗯', '在', '说呗'], ['哦', '然后呢']],
  },
  warm: {
    hostile: [['你这话有点过了', '我不太舒服', '换个说法'], ['怎么了你', '谁惹你了', '别冲我来']],
    preach: [['我知道你是好意', '但我不太想听这个', '让我自己想想'], ['嗯 我听到了', '不过我还是想照我的来']],
    care: [['还行 就是有点累', '你怎么突然问这个', '没事 别担心'], ['有点烦', '不过看到你这条好点了']],
    gossip: [['真的假的', '细说细说', '我听着呢'], ['哪个群 我也去看看', '笑死']],
    question: [['在呢', '刚忙完', '怎么啦'], ['在 有点累', '你说']],
    flat: [['嗯嗯', '在的', '怎么啦'], ['刚看到', '在忙 一会儿说']],
  },
  cold: {
    hostile: [[], ['哦'], ['嗯']],
    preach: [[], ['哦'], ['随便']],
    care: [['嗯'], ['还行'], ['不用']],
    gossip: [['哦'], ['嗯']],
    question: [['嗯'], ['在'], ['忙']],
    flat: [['嗯'], ['哦']],
  },
  polite: {
    hostile: [['哈哈 您说得对', '我回头注意'], ['嗯嗯 受教了', '谢谢提醒']],
    preach: [['嗯嗯 您说得是', '我再想想'], ['好的 我记下了', '谢谢您费心']],
    care: [['谢谢您关心', '我挺好的'], ['嗯嗯 会的']],
    gossip: [['哈哈 是有点', '不太清楚呢']],
    question: [['在的 您说', '嗯嗯'], ['还好 谢谢']],
    flat: [['嗯嗯', '好的']],
  },
}

const INNER = {
  hostileBanter: ['他也就敢在我这儿横', '真当我不敢骂回去', '这句我记下了 下次加倍还'],
  hostileCold: ['凭什么这么跟我说话', '懒得理 但心里堵', '别让我再看见这条'],
  hostilePolite: ['忍着 现在不能翻脸', '表面笑 心里骂了八百遍', '等哪天不用看他脸色'],
  preach: ['又来教我做人', '他连我过成什么样都不知道', '越说越不想听'],
  care: ['他怎么知道我今天不太好', '别对我太好 我会当真', '有点想多说两句 又忍住了'],
  gossip: ['这瓜我得找个人说说', '在群里接话就是找死', '阿柚肯定爱听'],
  question: ['他找我是有事 还是没事', '不想显得太积极', '回一句就行 别聊太深'],
  flat: ['没什么想说的', '回个嗯就够了', '今天真的累'],
}

export function decideBudget({ state, salience, style, selfModel = null }) {
  let maxChars
  // 只有没劲、或对纯背景噪音才压到一句话；有人点名叫我时不该被这个门槛卡住
  if (state.energy < 30 || (salience < 0.55 && style === 'cold')) maxChars = 12
  else maxChars = Math.round(clamp(18 + state.energy * 0.55 + salience * 22, 12, 72))
  if (state.exhausted) maxChars = Math.min(maxChars, 20)
  let maxBubbles = style === 'cold' ? 1 : state.energy < 40 ? 2 : 3
  if (style === 'polite') maxBubbles = 2
  // 自我模型学到的"话量"：不覆盖情绪预算，只在此基础上收一点或放一点
  const verbosity = Number(selfModel?.style?.verbosity)
  if (Number.isFinite(verbosity)) {
    maxChars = Math.round(clamp(maxChars * (0.75 + 0.5 * verbosity), 12, 90))
    maxBubbles = Math.round(clamp(maxBubbles * (0.75 + 0.5 * verbosity), 1, 3))
  }
  return { maxChars, maxBubbles }
}

/** 主入口：外部感知帧 → 双轨 JSON（与 LLM 输出同构）。 */
export function composeReply(ctx) {
  const {
    analysis,
    frame,
    relation,
    state,
    route,
    style,
    pe,
    schemaHits = [],
    bias = 0,
    memories = [],
    budget,
    rng,
    lastStressor = null,
    transferTarget = null,
    forgot = null,
    tip = null,
    selfModel = null,
  } = ctx

  const category = pickCategory(analysis)
  const moodKey = moodBucket(state)
  let parts = []

  parts.push(rng.pick(POOLS.mood[moodKey]))
  if (analysis.hostility > 0.3) parts.push(rng.pick(INNER.hostileCold))
  else if (analysis.preaching > 0.3) parts.push(rng.pick(INNER.preach))
  else if (analysis.warmth > 0.3) parts.push(rng.pick(INNER.care))
  else if (analysis.gossipy > 0.2) parts.push(rng.pick(INNER.gossip))
  else if (analysis.question) parts.push(rng.pick(INNER.question))
  else parts.push(rng.pick(INNER.flat))

  if (style === 'banter' && analysis.hostility > 0.3) parts.push(rng.pick(INNER.hostileBanter))
  if (style === 'polite') parts.push(rng.pick(INNER.hostilePolite))
  if (schemaHits.length) parts.push(rng.pick(POOLS.defense.hit))

  // 情绪惯性：高皮质醇时，内心独白必须还挂着上一个应激源（迁怒的物理证据）
  if (state.cortisol > 0.55 && lastStressor) {
    const snippet = String(lastStressor.text ?? '').replace(/\s+/g, '').slice(0, 14)
    parts.push(`刚才${lastStressor.name ?? '那个人'}那句「${snippet}」还堵在这儿，气根本没顺`)
  }
  if (bias < -0.18) parts.push('说不上来为什么，看到这个名字就有点烦')
  else if (bias > 0.18) parts.push('明知道他这人还行，就是莫名想亲近一点')
  if (memories.length) parts.push(`上次「${memories[0].title}」那事我还没忘`)
  if (route === 'TRANSFER_PRIVATE_GOSSIP') parts.push('群里不能说，得找个人说说')
  if (route === 'SILENT_READ') parts.push('不回 就是我的回答')
  if (route === 'POKE_ONLY') parts.push('懒得打字 戳一下算了')

  let bubbles = buildBubbles({ style, category, analysis, route, rng })
  // 自我模型只微调"说多少、要不要逗"，不改关系与情绪本身
  const learned = selfModel?.style
  if (learned && route === 'REPLY_CURRENT') {
    if (learned.verbosity < 0.35 && bubbles.length > 1) bubbles = bubbles.slice(0, 1)
    if (learned.verbosity > 0.7 && bubbles.length < budget.maxBubbles && rng.chance(0.35)) {
      bubbles.push(rng.pick(['还有', '算了不说了', '你猜']))
    }
    if (learned.playfulness > 0.7 && (category === 'flat' || category === 'question') && rng.chance(0.4)) {
      bubbles.push(rng.pick(['嘿嘿', '才不告诉你', '你猜呀', '骗你的']))
    }
    if (learned.warmth > 0.7 && category === 'care' && bubbles.length < budget.maxBubbles && rng.chance(0.4)) {
      bubbles.push(rng.pick(['我在', '嗯 你说']))
    }
  }
  bubbles = enforceBudget(bubbles, budget.maxChars, budget.maxBubbles)

  if (route === 'SILENT_READ' || route === 'TRANSFER_PRIVATE_GOSSIP') bubbles = []

  // 舌尖现象：具体情节沉下去了，只剩一个标题和一点情绪
  if (tip && !forgot) {
    parts = [
      '话到嘴边就是想不起来具体是哪次',
      `只记得${tip.title}这个标题，细节全糊了`,
      tip.valence < -0.2 ? '想起来也不舒服' : '好像不是什么坏事',
    ]
    bubbles = enforceBudget(['记不清了', `好像是${String(tip.title).slice(0, 8)}`], budget.maxChars, budget.maxBubbles)
  }

  // 打断忘词：被挤出工作空间且从未落库的话题，真的捞不回来
  if (forgot) {
    parts = [
      '脑子被刚才那一串事冲干净了',
      '真的想不起来，只剩一点被吵到的余温',
      `刚才${forgot.lost?.length ?? 0}件事挤进来，原来那句直接掉出去了`,
    ]
    bubbles = enforceBudget(['想不起来了', '刚才被刷没了'], budget.maxChars, budget.maxBubbles)
  }

  const neuroDelta = {
    dopamine: Number((analysis.warmth > 0.2 ? 0.04 : analysis.gossipy > 0.2 ? 0.05 : -0.02).toFixed(2)),
    cortisol: Number((analysis.hostility > 0.2 ? 0.06 : analysis.warmth > 0.2 ? -0.03 : 0).toFixed(2)),
    intimacy_delta: Number(((analysis.warmth > 0.2 ? 1.2 : analysis.hostility > 0.2 ? -2.5 : 0.2) * (style === 'banter' ? 0.6 : 1)).toFixed(1)),
  }

  // 群里装死，转头私聊死党：这两句只走跨通道，不出现在公屏
  const transferBubbles =
    route === 'TRANSFER_PRIVATE_GOSSIP'
      ? enforceBudget(
          rng.sample(['刚在群里看到个离谱的', '笑死 必须跟你说', '不吐不快 你听我说', '这帮人真的绝了'], 2),
          40,
          2,
        )
      : []

  return {
    perceived_subtext: forgot
      ? '他在考我记性，但我确实断片了'
      : ctx.appraisalHint?.subtext || rng.pick(POOLS.subtext[category] ?? POOLS.subtext.flat),
    prediction_error: Number(pe.toFixed(2)),
    touches_core_schema: schemaHits.length > 0,
    neuro_delta: neuroDelta,
    inner_monologue: parts.join('，').replace(/，,/g, '，'),
    action_route: route,
    transfer_target_qq: route === 'TRANSFER_PRIVATE_GOSSIP' ? (transferTarget?.id ?? null) : null,
    transfer_target_name: route === 'TRANSFER_PRIVATE_GOSSIP' ? (transferTarget?.name ?? null) : null,
    transfer_bubbles: transferBubbles,
    bubbles,
    trigger_regret_recall:
      state.cortisol > 0.75 && analysis.hostility > 0.35 && bubbles.length > 0 ? rng.chance(0.55) : false,
    expect_reply_within_sec:
      route === 'REPLY_CURRENT' && (relation?.intimacy ?? 0) > 40 ? rng.pick([120, 180, 300]) : 0,
    meta: {
      style,
      moodKey,
      budget,
      category,
      routeReasons: ctx.routeReasons ?? [],
    },
  }
}

/** 内源点火（走神 / 内耗 / 深夜反刍）的独白生成。 */
export function composeEndogenous({ kind, state, pending, memory, relation, rng, clockLabel }) {
  if (kind === 'pending-timeout') {
    const who = relation?.name ?? pending?.entityName ?? '他'
    const lines = [
      `${who}还没回，已读不回最难受`,
      `都${clockLabel}了，一条没回，是不是我上一条太冷了`,
      `他是不是觉得我烦了，我是不是又说错话了`,
      `盯着对话框看了第三遍，已读，没回`,
    ]
    const body = rng.pick(lines)
    return {
      thought: `${body}。${rng.pick(['早知道不发了', '要不要撤回', '算了 睡吧 又睡不着'])}`,
      neuro: { cortisol: 0.09, dopamine: -0.05, serotonin: -0.04 },
      valenceTarget: -0.35,
      tags: ['内耗', '已读不回'],
      salience: 0.62,
    }
  }
  if (kind === 'night-rumination') {
    const seed = memory ? `又想起${memory.title}` : '又开始翻旧账'
    return {
      thought: `${clockLabel}了还醒着，${seed}。${rng.pick(['白天那句话我其实没过去', '越想越觉得当时该骂回去', '明天还要早起 更烦了'])}`,
      neuro: { cortisol: 0.07, serotonin: -0.03 },
      valenceTarget: -0.25,
      tags: ['反刍', '失眠'],
      salience: 0.56,
    }
  }
  const seed = memory ? `突然想起${memory.title}` : '脑子自己开始放空'
  return {
    thought: `${seed}。${rng.pick(['也没什么事 就是走神了', '不知道现在在干嘛', '有点想找个人说话 又不知道找谁'])}`,
    neuro: { dopamine: 0.02, cortisol: 0.01 },
    valenceTarget: -0.05,
    tags: ['走神', 'DMN'],
    salience: 0.5,
  }
}

function pickCategory(analysis) {
  if (analysis.hostility > 0.3) return 'hostile'
  if (analysis.preaching > 0.25) return 'preach'
  if (analysis.warmth > 0.3) return 'care'
  if (analysis.gossipy > 0.2) return 'gossip'
  if (analysis.question) return 'question'
  return 'flat'
}

function moodBucket(state) {
  if (state.cortisol > 0.75) return 'furious'
  if (state.cortisol > 0.55) return 'irritated'
  if (state.energy < 25 || state.moodValence < -0.4) return 'low'
  if (state.moodValence > 0.45) return 'bright'
  if (state.moodValence > 0.15) return 'soft'
  return 'flat'
}

function buildBubbles({ style, category, analysis, route, rng }) {
  const table = BUBBLES[style] ?? BUBBLES.warm
  const pool = table[category] ?? table.flat
  if (route === 'POKE_ONLY') {
    return style === 'polite' ? ['嗯嗯'] : style === 'cold' ? [] : ['戳你一下']
  }
  return rng.pick(pool).slice()
}

/** 去标点 + 切分 + 预算截断：永远不输出带句号的长段落。 */
export function enforceBudget(bubbles, maxChars, maxBubbles) {
  const flat = []
  for (const raw of bubbles) {
    const pieces = String(raw)
      .split(/[。！？!?；;]/)
      .map((piece) => piece.replace(/[，,、…~～\s]+$/g, '').trim())
    for (const piece of pieces) {
      if (piece) flat.push(piece)
    }
  }
  const out = []
  let used = 0
  for (const piece of flat) {
    if (out.length >= maxBubbles) break
    const clean = piece.replace(/[。！？!?]/g, '')
    if (!clean) continue
    const room = maxChars - used
    if (room <= 0) break
    const slice = clean.length > room ? clean.slice(0, room) : clean
    out.push(slice)
    used += slice.length
  }
  return out
}
