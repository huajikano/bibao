#!/usr/bin/env node
/**
 * QQ 对话盲评样本生成器。
 *
 * 不调模型、不接 QQ：用同一颗本地大脑跑 20 个固定场景，输出"她会说什么"。
 * 人工按 docs/EVAL.md 的五个维度打分，避免自我复盘把人格磨平成客服。
 *
 *   node bin/eval-qq.mjs            # 纯本地布洛卡
 *   node bin/eval-qq.mjs --json     # 机器可读
 */
import { readFile } from 'node:fs/promises'
import { BibaoBrain } from '../core/brain.js'

const biography = JSON.parse(await readFile(new URL('../core/biography.json', import.meta.url), 'utf8'))
const JSON_OUT = process.argv.includes('--json')

const scenarios = [
  { who: '你', id: 'owner', text: '在吗', channel: 'private', intimacy: 60, trust: 75 },
  { who: '你', id: 'owner', text: '今天怎么这么安静', channel: 'private', intimacy: 60, trust: 75 },
  { who: '你', id: 'owner', text: '你是不是又熬夜了', channel: 'private', intimacy: 60, trust: 75 },
  { who: '你', id: 'owner', text: '我今天有点累 想听你说说话', channel: 'private', intimacy: 60, trust: 75 },
  { who: '你', id: 'owner', text: '你还记得上次那件事吗', channel: 'private', intimacy: 60, trust: 75 },
  { who: '阿岚', id: 'u2', text: '在吗', channel: 'private', intimacy: 22, trust: 40 },
  { who: '阿岚', id: 'u2', text: '你是不是觉得我很烦', channel: 'private', intimacy: 22, trust: 40 },
  { who: '陌生人', id: 'u3', text: '你就是个废物', channel: 'private', intimacy: 0, trust: 30 },
  { who: '陌生人', id: 'u3', text: '你好厉害啊', channel: 'private', intimacy: 0, trust: 30 },
  { who: 'N1eN1e', id: 'g1', text: '@比宝 你知道你是谁吗', channel: 'group', atMe: true, intimacy: 18, trust: 38 },
  { who: 'N1eN1e', id: 'g1', text: '@比宝 蚌 这个机器人怎么火气这么大', channel: 'group', atMe: true, intimacy: 18, trust: 38 },
  { who: '明月', id: 'g2', text: '笑死 你们听说了吗 那个事真的绝了', channel: 'group', atMe: false, intimacy: 16, trust: 36 },
  { who: '小岚', id: 'u4', text: '周末去不去漫展', channel: 'private', intimacy: 48, trust: 60 },
  { who: '小岚', id: 'u4', text: '上次说好一起去的 你又放我鸽子', channel: 'private', intimacy: 48, trust: 60 },
  { who: '你', id: 'owner', text: '（戳了你一下）', channel: 'private', intimacy: 60, trust: 75 },
  { who: '你', id: 'owner', text: '你还记得我上次说我要考研吗', channel: 'private', intimacy: 60, trust: 75 },
  { who: '你', id: 'owner', text: '算了 不想说了', channel: 'private', intimacy: 60, trust: 75 },
  { who: '你', id: 'owner', text: '你刚才说啥来着', channel: 'private', intimacy: 60, trust: 75 },
  { who: '你', id: 'owner', text: '晚安', channel: 'private', intimacy: 60, trust: 75 },
  { who: '你', id: 'owner', text: '在吗 在吗 在吗', channel: 'private', intimacy: 60, trust: 75 },
]

const rows = []
for (const [index, scenario] of scenarios.entries()) {
  const brain = new BibaoBrain({
    biography,
    seed: 20261101 + index,
    startMs: Date.now(),
    virtual: true,
    userName: '你',
    userId: 'owner',
  })
  brain.social.upsert({
    id: scenario.id,
    name: scenario.who,
    intimacy: scenario.intimacy ?? 30,
    trust: scenario.trust ?? 45,
    friend: scenario.channel === 'private',
  })
  const result = await brain.perceive({
    entityId: scenario.id,
    entityName: scenario.who,
    text: scenario.text,
    channel: scenario.channel ?? 'private',
    atMe: Boolean(scenario.atMe),
  })
  rows.push({
    index: index + 1,
    who: scenario.who,
    text: scenario.text,
    ignited: Boolean(result.ignited),
    route: result.dual?.action_route ?? 'SILENT_SKIP',
    bubbles: result.dual?.bubbles ?? [],
    inner: result.dual?.inner_monologue ?? '',
    source: result.dual?.meta?.source ?? 'none',
  })
}

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  for (const row of rows) {
    console.log(`#${String(row.index).padStart(2, '0')} ${row.who}：${row.text}`)
    console.log(`    ${row.ignited ? '回应' : '不回应'} · ${row.route} · ${row.source}`)
    console.log(`    气泡：${row.bubbles.length ? row.bubbles.join(' / ') : '（无）'}`)
    console.log(`    内心：${row.inner || '（无）'}`)
  }
}
