#!/usr/bin/env node
/** 生活流：每天不能是同一套日程；周末、主题、空档和避重都要生效。 */
import { LifeStream } from '../core/life-stream.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const bio = {
  name: '比宝',
  ageNow: 16,
  oneLine: '爱玩的小女孩',
  relations: [],
  interests: ['光遇'],
}
const stream = new LifeStream({ seed: 20261101 })
const days = []
for (let index = 0; index < 5; index += 1) {
  // 2026-11-01 is Sunday; use 23:00 Asia/Shanghai
  const now = Date.UTC(2026, 9, 31 + index, 15, 0, 0)
  stream.ensureDay({ now, biography: bio, relations: [], interests: ['光遇'] })
  days.push({ now, events: stream.today(now), theme: stream.theme })
}
const texts = days.map((day) => day.events.map((item) => item.text).join('|'))
check('每天都有生活事件', days.every((day) => day.events.length >= 2), days.map((day) => day.events.length).join(','))
check('每天内容不完全相同', new Set(texts).size >= 4, `${new Set(texts).size}/5 种`)
check('周末主题会出现', days.some((day) => day.theme?.weekend === true), JSON.stringify(days.map((day) => day.theme?.weekend)))
check('有每日主题', days.every((day) => Boolean(day.theme?.label)), JSON.stringify(days.map((day) => day.theme?.label)))

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
