import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildGenerationPrompt, deriveRelations, parsePersonaJson, templatePersona, validatePersona } from '../core/persona.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

const tpl = templatePersona({ name: '阿岚', ageNow: 26, city: '杭州', tone: '嘴硬心软', wound: '怕被丢下', userName: '你', userRelation: '朋友' })
check('模板生成通过校验', tpl.ok, tpl.ok ? `${tpl.persona.events.length} 条事件 / ${tpl.persona.relations.length} 段关系` : tpl.errors.join('; '))
check('模板事件年龄单调', tpl.ok && tpl.persona.events.every((event, index, list) => index === 0 || list[index - 1].age <= event.age), 'sorted')
check('关系由事件推导（不是模型指定）', tpl.ok && tpl.persona.relations.every((row) => row.name && Number.isFinite(row.intimacy)), JSON.stringify(tpl.persona?.relations?.[0] ?? {}))

// 正面经历多的人，亲密度应该高于只被伤害的人
const warm = deriveRelations([
  { age: 10, valence: 0.8, arousal: 0.7, entities: ['甲'] },
  { age: 12, valence: 0.6, arousal: 0.5, entities: ['甲'] },
  { age: 14, valence: 0.7, arousal: 0.6, entities: ['甲'] },
])
const cold = deriveRelations([
  { age: 10, valence: -0.8, arousal: 0.9, entities: ['甲'] },
  { age: 12, valence: -0.7, arousal: 0.8, entities: ['甲'] },
  { age: 14, valence: -0.6, arousal: 0.7, entities: ['甲'] },
])
check('温暖关系亲密度更高', warm[0].intimacy > cold[0].intimacy, `warm=${warm[0].intimacy} cold=${cold[0].intimacy}`)
check('伤害关系敬畏更高', cold[0].powerFear > warm[0].powerFear, `warm=${warm[0].powerFear} cold=${cold[0].powerFear}`)

const bad = validatePersona(
  { events: [{ age: 99, title: 'x', narrative: '太短', valence: 5, arousal: 9, entities: [] }], relations: [] },
  { seed: { ageNow: 22 } },
)
check('非法候选被拒绝', bad.ok === false && bad.errors.length > 0, bad.errors.slice(0, 2).join('; '))

const prompt = buildGenerationPrompt({ name: '阿岚', ageNow: 26 })
check('提示词含 JSON 契约', prompt.system.includes('"events"') && prompt.user.includes('26'), `${prompt.system.length} chars`)

const parsed = parsePersonaJson('说明文字 {"events":[],"relations":[]} 其余')
check('能从噪声里抠出 JSON', parsed && Array.isArray(parsed.events), JSON.stringify(parsed).slice(0, 40))

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
