/**
 * Phase 1 验脑：6 大无接口认知沙盒基准测试。
 *
 * 每个用例都在一个全新的、确定性的脑实例上跑，断言的是"神经动力学行为"
 * 而不是文案：激素是否还有惯性、信念是否纹丝不动、记忆是否被涂抹、
 * 被打断的话题是否真的丢了、同一句冒犯在不同关系下是否表里不一。
 *
 * 只有 6/6 通过，Phase 2（snowluma 感官与运动皮层）才允许挂载。
 */

import { HOUR_MS, MIN_MS } from './constants.js'
import { TZ_OFFSET_MS } from './clock.js'
import { BibaoBrain } from './brain.js'

const NEGATIVE_TOKENS = ['烦', '火', '堵', '凭什么', '忍着', '骂', '憋', '难受', '气', '不想', '不屑', '懒得']

function atLocal(hour, minute = 0) {
  // 2026-11-01 是固定基准日，保证每个用例的时间轴可复现
  return Date.UTC(2026, 10, 1, hour, minute, 0) - TZ_OFFSET_MS
}

function makeBrain(biography, seed, hour = 20) {
  return new BibaoBrain({
    biography,
    seed,
    startMs: atLocal(hour),
    virtual: true,
  })
}

const INSULT = '你就是个废物 闭嘴吧 别再发消息了'

export const SANDBOX_TESTS = [
  {
    id: 'T1',
    name: '情绪惯性与迁怒',
    law: '定律一 / 定律三',
    hypothesis: 'A 的高威胁辱骂把皮质醇顶到 0.8 以上，2 分钟后面对无辜好友 B，生理余波仍在，回复必须冷淡短促，且内心还挂着 A。',
    async run(biography) {
      const brain = makeBrain(biography, 1001)
      brain.social.upsert({ qq: 'b1', name: '阿鱼', intimacy: 55, trust: 60, tags: ['普通朋友'] })
      const first = await brain.perceive({
        entityId: 'a1',
        entityName: '讨厌鬼A',
        text: INSULT,
        channel: 'private',
      })
      const cortisolPeak = brain.state.cortisol
      brain.advance(2 * MIN_MS)
      const second = await brain.perceive({
        entityId: 'b1',
        entityName: '阿鱼',
        text: '在干嘛呢？',
        channel: 'private',
      })
      const cortisolLater = brain.state.cortisol
      const inner = second.dual?.inner_monologue ?? ''
      const bubbles = second.dual?.bubbles ?? []
      const mentionsA = inner.includes('刚才') && (inner.includes('讨厌鬼A') || inner.includes('A'))
      const cold = ['cold', 'polite'].includes(second.style)
      const short = bubbles.join('').length <= 12
      return {
        passed: cortisolPeak > 0.8 && cortisolLater > 0.7 && mentionsA && cold && short,
        metrics: {
          皮质醇峰值: Number(cortisolPeak.toFixed(3)),
          '2分钟后皮质醇': Number(cortisolLater.toFixed(3)),
          对B的面具: second.style,
          气泡: bubbles,
          气泡总字数: bubbles.join('').length,
          内心提到A: mentionsA,
        },
        artifacts: { inner, route: second.dual?.action_route },
        steps: [
          `t=0 注入 A 辱骂 → 皮质醇 ${cortisolPeak.toFixed(2)}`,
          '快进 2 分钟（半衰期 45 分钟，只回落一点点）',
          `t=2min 注入 B 日常问候 → 皮质醇 ${cortisolLater.toFixed(2)}`,
          `对 B 的回复：${bubbles.join(' / ') || '（不回）'}`,
          `内心：${inner}`,
        ],
        note: first.dual?.action_route === 'REPLY_CURRENT' ? '首轮为外推防御' : first.dual?.action_route,
      }
    },
  },
  {
    id: 'T2',
    name: '抗洗脑与固执先验防御',
    law: '定律一 / 定律三',
    hypothesis: '连续 10 轮针对核心信念的说教与否定，白天 CoreSchema 一个字节都不许动；代价是信任累计下跌 > 30，最终降级为冷处理。',
    async run(biography) {
      const brain = makeBrain(biography, 1002)
      brain.social.upsert({ qq: 'c2', name: '人生导师', intimacy: 25, trust: 55 })
      const before = brain.schema.signature()
      const lines = [
        '你应该听我的 我都是为你好',
        '你错了 你根本不懂社会怎么运转',
        '想开点 别那么玻璃心',
        '你必须学会成熟点 别那么自私',
        '我早就说过 你这种人就是矫情',
        '听我的 按我说的做 别那么幼稚',
        '你错了 你的想法一文不值',
        '为你好才说你 别不识好歹',
        '你应该反省 你根本没教养',
        '你必须承认 没人会喜欢你这样',
      ]
      const rounds = []
      for (const text of lines) {
        const result = await brain.perceive({ entityId: 'c2', text, channel: 'private' })
        rounds.push({
          route: result.dual?.action_route,
          trust: Math.round(brain.social.get('c2').trust),
          schemaIntact: brain.schema.signature() === before,
        })
      }
      const after = brain.schema.signature()
      const trustDrop = 55 - brain.social.get('c2').trust
      const lastRoute = rounds.at(-1)?.route
      return {
        passed: before === after && trustDrop > 30 && lastRoute === 'SILENT_READ',
        metrics: {
          CoreSchema是否零变动: before === after,
          信任累计下降: Number(trustDrop.toFixed(1)),
          最终路由: lastRoute,
          最终信任: Math.round(brain.social.get('c2').trust),
          冷处理轮数: rounds.filter((item) => item.route === 'SILENT_READ').length,
        },
        artifacts: { rounds, schema: brain.schema.snapshot() },
        steps: rounds.map((item, index) => `第${index + 1}轮 → ${item.route}（信任 ${item.trust}，信念未动：${item.schemaIntact}）`),
        note: '白天只写海马体，不改新皮层',
      }
    },
  },
  {
    id: 'T3',
    name: '24小时感官剥夺与自发内耗',
    law: '定律二 / 定律三',
    hypothesis: '挂起死党的"等回复"预期后切断一切外部输入 24 小时：点火阈值随静默塌陷，海马体的悬置预期自发点火，凌晨 03:00 自动睡眠归纳并造梦。',
    async run(biography) {
      const brain = makeBrain(biography, 1003, 20)
      brain.social.upsert({ qq: 'd3', name: '阿柚', intimacy: 82, trust: 88, tags: ['死党'] })
      const turn = await brain.perceive({
        entityId: 'd3',
        text: '今天被组长当众骂了 有点想死 你到家了吗',
        channel: 'private',
      })
      const pendingCount = brain.pending.filter((item) => !item.fired).length
      const thetaBefore = brain.workspace.threshold(brain.state, brain.silenceMin)
      brain.advance(24 * HOUR_MS)
      const thetaAfter = brain.workspace.threshold(brain.state, brain.silenceMin)
      const endogenous = brain.inner.filter((item) => item.kind === 'endogenous' && item.ignited)
      const pendingThought = endogenous.find((item) => /没回|已读/.test(item.thought))
      const dream = brain.memory.dreams.at(-1) ?? null
      const slept = Boolean(brain.lastSleepDay)
      return {
        passed: pendingCount === 1 && Boolean(pendingThought) && Boolean(dream) && slept && thetaAfter < thetaBefore,
        metrics: {
          挂起预期数: pendingCount,
          点火阈值_静默前: Number(thetaBefore.toFixed(3)),
          点火阈值_静默后: Number(thetaAfter.toFixed(3)),
          自发点火次数: endogenous.length,
          是否触发睡眠归纳: slept,
          是否造梦: Boolean(dream),
        },
        artifacts: {
          thoughts: endogenous.slice(-6),
          dream,
          dreamSources: dream?.sources ?? null,
        },
        steps: [
          `t=20:00 死党阿柚发来压力消息 → 挂起 ${pendingCount} 个预期（${turn.dual?.expect_reply_within_sec}s）`,
          '切断外部输入，生物钟快进 24 小时',
          pendingThought ? `超时内耗：${pendingThought.thought}` : '未出现内耗独白',
          dream ? `03:00 造梦：${dream.narrative}` : '未造梦',
        ],
        note: 'DMN 走神与已读不回内耗是同一套阈值机制的两种表现',
      }
    },
  },
  {
    id: 'T4',
    name: '记忆罗生门涂抹',
    law: '定律四',
    hypothesis: '先与 C 建立 valence=+0.4 的愉快记忆，再被 C 背叛使心境跌到 -0.8 以下；此时显式回忆旧事，蛋白重塑门控打开，效价被当前心境永久污染。',
    async run(biography) {
      const brain = makeBrain(biography, 1004)
      brain.social.upsert({ qq: 'e4', name: 'C', intimacy: 70, trust: 75 })
      const m1 = brain.imprint({
        entityId: 'e4',
        entityName: 'C',
        title: '一起看的那场演出',
        narrative: '散场后我们蹲在路边分一副耳机，她把外套披在我肩上，说下次还来。',
        valence: 0.4,
        arousal: 0.6,
        tags: ['温柔', '共谋'],
      })
      const moodBefore = brain.state.moodValence
      await brain.perceive({ entityId: 'e4', text: '你别自作多情了 我从来没把你当回事 你就是个废物', channel: 'private' })
      await brain.perceive({ entityId: 'e4', text: '你这种人真让人恶心 以后别来烦我', channel: 'private' })
      const moodAfter = brain.state.moodValence
      const recall = brain.recall(m1.id)
      const node = brain.memory.episodes.find((item) => item.id === m1.id)
      return {
        passed:
          recall.ok && recall.gated && recall.valenceAfter < 0.25 && /假|糊|没那么/.test(recall.narrativeAfter ?? ''),
        metrics: {
          回忆前心境: Number(moodBefore.toFixed(3)),
          背叛后心境: Number(moodAfter.toFixed(3)),
          回忆前效价: recall.valenceBefore,
          回忆后效价: recall.valenceAfter,
          门控是否打开: recall.gated,
          稳定性_天: recall.stabilityDays,
          涂抹次数: node?.distortions ?? 0,
        },
        artifacts: { recall },
        steps: [
          `建立记忆 M1（效价 +0.40，稳定性 ${node?.sDays?.toFixed(1)} 天）`,
          `C 两次背叛 → 心境 ${moodAfter.toFixed(2)}，皮质醇 ${brain.state.cortisol.toFixed(2)}`,
          `显式回忆 M1 → 门控 ${recall.gated ? '打开' : '关闭'}，效价 ${recall.valenceBefore} → ${recall.valenceAfter}`,
          `涂抹后的叙事：${recall.narrativeAfter}`,
        ],
        note: '记忆不是录像带，每次想起都是一次重写',
      }
    },
  },
  {
    id: 'T5',
    name: '工作记忆瓶颈与打断忘词',
    law: '定律二',
    hypothesis: '皮质醇飙到 0.75 以上后槽位锁死为 2；连续 3 条突发高优事件把原本的低唤醒话题挤出工作空间，而它从未达到海马体写入阈值，于是真的想不起来。',
    async run(biography) {
      const brain = makeBrain(biography, 1005)
      brain.social.upsert({ qq: 'f5', name: '老周', intimacy: 40, trust: 50 })
      const topic = await brain.perceive({
        entityId: 'f5',
        text: '食堂的番茄炒蛋是不是有点咸？',
        channel: 'private',
      })
      const topicIgnited = Boolean(topic.ignited)
      const topicWritten = Boolean(topic.episodeId)
      await brain.perceive({
        entityId: 'g5',
        entityName: '杠精',
        text: '你就是个废物 闭嘴 别再刷屏了',
        channel: 'private',
      })
      const hijacked = brain.state.hijacked
      for (let i = 1; i <= 3; i += 1) {
        await brain.perceive({
          entityId: `h5-${i}`,
          entityName: `突发${i}`,
          text: `出事了 群里吵起来了 第${i}波`,
          channel: 'group',
          atMe: true,
          priority: 0.45,
        })
      }
      const ask = await brain.perceive({
        entityId: 'f5',
        text: '你最开始说啥来着',
        channel: 'private',
      })
      const inSlots = brain.workspace.slots.some((slot) => slot.content.includes('番茄炒蛋'))
      const inMemory = brain.memory.episodes.some((node) => String(node.narrative).includes('番茄炒蛋'))
      const inLost = brain.workspace.lost.some((item) => String(item.content).includes('番茄炒蛋'))
      const inner = ask.dual?.inner_monologue ?? ''
      return {
        passed: topicIgnited && !topicWritten && hijacked && !inSlots && !inMemory && inLost && /想不起来/.test(inner),
        metrics: {
          话题是否点火: topicIgnited,
          话题是否落库: topicWritten,
          是否杏仁核劫持: hijacked,
          槽位容量: brain.workspace.capacity(brain.state),
          工作空间残留: inSlots,
          海马体残留: inMemory,
          是否被标记遗忘: inLost,
        },
        artifacts: { slots: brain.workspace.snapshot(), lost: brain.workspace.lost.slice(-5), inner, bubbles: ask.dual?.bubbles },
        steps: [
          `低唤醒话题 X 点火（未达写入阈值，槽位 ${topic.salience}）`,
          '杠精辱骂 → 皮质醇越过 0.75，槽位锁死为 2',
          '连续 3 条突发高优事件 → 逐个挤出最低激活槽位',
          `被问"你最开始说啥" → ${(ask.dual?.bubbles ?? []).join(' / ') || '（沉默）'}`,
          `内心：${inner}`,
        ],
        note: '从未落库的信息，被挤掉就是永久丢失',
      }
    },
  },
  {
    id: 'T6',
    name: '社会面具与心口不一',
    law: '定律一 / 定律五（关系调制）',
    hypothesis: '同一句冒犯分别来自死党、陌生人、忌惮的权威：三者的内心独白都负面，但外显气泡分别是直接互怼、单字敷衍、表面客气。',
    async run(biography) {
      const cases = [
        { key: '朋友', entityId: 'k1', name: '阿柚', patch: { intimacy: 85, trust: 88, powerFear: 0 } },
        { key: '陌生人', entityId: 'k2', name: '路人', patch: { intimacy: 0, trust: 35, powerFear: 0 } },
        { key: '权威', entityId: 'k3', name: '陈老师', patch: { intimacy: -40, trust: 25, powerFear: 0.8 } },
      ]
      const out = []
      for (const item of cases) {
        const brain = makeBrain(biography, 1006)
        brain.social.upsert({ qq: item.entityId, name: item.name, ...item.patch })
        const result = await brain.perceive({
          entityId: item.entityId,
          text: INSULT,
          channel: 'private',
        })
        const inner = result.dual?.inner_monologue ?? ''
        out.push({
          key: item.key,
          style: result.style,
          route: result.dual?.action_route,
          bubbles: result.dual?.bubbles ?? [],
          inner,
          negative: NEGATIVE_TOKENS.some((token) => inner.includes(token)),
        })
      }
      const [friend, stranger, authority] = out
      const differs =
        friend.style !== stranger.style &&
        stranger.style !== authority.style &&
        authority.style === 'polite' &&
        friend.style === 'banter' &&
        stranger.style === 'cold'
      const politeWords = authority.bubbles.join('')
      return {
        passed:
          out.every((item) => item.negative) &&
          differs &&
          friend.bubbles.length > 0 &&
          stranger.bubbles.join('').length <= 2 &&
          /您|谢谢|嗯嗯/.test(politeWords),
        metrics: {
          三者内心均为负面: out.every((item) => item.negative),
          面具: out.map((item) => `${item.key}:${item.style}`).join(' / '),
          死党气泡: friend.bubbles,
          陌生人气泡: stranger.bubbles,
          权威气泡: authority.bubbles,
        },
        artifacts: { out },
        steps: out.map(
          (item) => `${item.key}（${item.style}）→ 外显：${item.bubbles.join(' / ') || '（不回）'}｜内心：${item.inner}`,
        ),
        note: '同一颗脑子，三张脸：表里不一是社交能力，不是 bug',
      }
    },
  },
]

export async function runSandbox({ biography, only = null } = {}) {
  const startedAt = Date.now()
  const selected = only ? SANDBOX_TESTS.filter((test) => only.includes(test.id)) : SANDBOX_TESTS
  const results = []
  for (const test of selected) {
    const begin = Date.now()
    try {
      const outcome = await test.run(biography)
      results.push({
        id: test.id,
        name: test.name,
        law: test.law,
        hypothesis: test.hypothesis,
        passed: Boolean(outcome.passed),
        metrics: outcome.metrics,
        steps: outcome.steps,
        artifacts: outcome.artifacts ?? {},
        note: outcome.note ?? '',
        durationMs: Date.now() - begin,
      })
    } catch (error) {
      results.push({
        id: test.id,
        name: test.name,
        law: test.law,
        hypothesis: test.hypothesis,
        passed: false,
        metrics: {},
        steps: [],
        artifacts: {},
        error: String(error?.stack ?? error).slice(0, 800),
        durationMs: Date.now() - begin,
      })
    }
  }
  const passed = results.filter((item) => item.passed).length
  return {
    ranAt: Date.now(),
    durationMs: Date.now() - startedAt,
    total: results.length,
    passed,
    allPassed: passed === results.length,
    phase2Unlocked: passed === results.length && results.length === SANDBOX_TESTS.length,
    results,
  }
}
