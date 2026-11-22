#!/usr/bin/env node
/**
 * 双轨输出解析：思考型模型（如 GLM-5.3-Flash）常见的几种"不标准 JSON"与流形态。
 * node bin/dual-track-parse-smoke.mjs
 */
import assert from 'node:assert/strict'
import { extractJson, collectStream } from '../core/prefrontal.js'

const results = []
const check = (name, run) => {
  try {
    run()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, detail: error.message })
  }
}

const expectBubbles = (text, bubbles = ['嗯']) => {
  const parsed = extractJson(text)
  assert.ok(parsed, 'should parse')
  assert.deepEqual(parsed.bubbles, bubbles)
}

check('标准 JSON', () => expectBubbles('{"bubbles":["嗯"]}'))
check('带代码块围栏', () => expectBubbles('```json\n{"bubbles":["嗯"]}\n```'))
check('前面有解释文字', () => expectBubbles('好的，这是结果：\n{"bubbles":["嗯"]}'))
check('BOM 开头也能解析', () => expectBubbles('\uFEFF{"bubbles":["嗯"]}'))
check('对象末尾多余逗号', () => expectBubbles('{"bubbles":["嗯"],}'))
check('数组末尾多余逗号', () => expectBubbles('{"bubbles":["嗯",]}'))
check('字符串里有裸换行', () => expectBubbles('{"bubbles":["嗯\n好的"]}', ['嗯\n好的']))
check('字符串里有裸制表符', () => expectBubbles('{"bubbles":["嗯\t好"]}', ['嗯\t好']))
check('正常转义不被破坏', () => expectBubbles('{"bubbles":["他说\\"好\\""]}', ['他说"好"']))
check('没有 JSON 时返回 null', () => assert.equal(extractJson('我直接说了句话'), null))
check('坏 JSON 不被硬凑', () => assert.equal(extractJson('{"bubbles":["嗯"'), null))

const textOf = async (chunks) => (await collectStream((async function* () { for (const chunk of chunks) yield chunk })(), { timeoutMs: 0 })).text

const cases = [
  ['text-delta 正常拼接', [{ type: 'text-delta', text: '{"bubbles":' }, { type: 'text-delta', text: '["嗯"]}' }], '{"bubbles":["嗯"]}'],
  ['只发 block-end 也能拿到全文', [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'block-end', index: 0, block: { type: 'text', text: '{"bubbles":["嗯"]}' } }], '{"bubbles":["嗯"]}'],
  ['两者都有时不重复拼接', [{ type: 'text-delta', text: '{"bubbles":["嗯"]}' }, { type: 'block-end', index: 0, block: { type: 'text', text: '{"bubbles":["嗯"]}' } }], '{"bubbles":["嗯"]}'],
]
for (const [name, chunks, expected] of cases) {
  try {
    assert.equal(await textOf(chunks), expected)
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, detail: error.message })
  }
}

// 解析 + 流组合：思考型模型常见形态（思考内容不进正文，正文夹带裸换行）
try {
  const streamed = await textOf([
    { type: 'reasoning-delta', text: '先想想…' },
    { type: 'text-delta', text: '{"bubbles":["在啊\n刚忙完"],"action_route":"REPLY_CURRENT",}' },
  ])
  const parsed = extractJson(streamed)
  assert.deepEqual(parsed.bubbles, ['在啊\n刚忙完'])
  results.push({ name: '思考型模型的常见输出能解析', ok: true })
} catch (error) {
  results.push({ name: '思考型模型的常见输出能解析', ok: false, detail: error.message })
}

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
