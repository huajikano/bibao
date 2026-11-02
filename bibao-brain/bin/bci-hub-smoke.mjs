#!/usr/bin/env node
/**
 * BCI Hub 冒烟：多个接口能注册、能感知，动作默认被三道闸拦住。
 */
import { BciHub, CAPABILITIES, tftAdapter, screenVisionAdapter, handsAdapter, biometricAdapter } from '../core/bci-hub.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

const tft = { snapshot: () => ({ phase: 'combat', gold: 32, health: 88, level: 7, shop: [] }) }
const hub = new BciHub()
hub.register(tftAdapter(tft))
hub.register(screenVisionAdapter(async () => ({ gist: '一个聊天窗口' })))
hub.register(biometricAdapter({ read: async () => ({ attention: 0.72, fatigue: 0.3 }) }))
let clicked = 0
hub.register(
  handsAdapter({
    'pointer.click': async (action) => {
      clicked += 1
      return { x: action.x, y: action.y }
    },
  }),
)

const list = hub.list()
check('四种适配器都注册了', list.length === 4, list.map((item) => item.id).join(','))
check('能力声明可查询', hub.has('screen', CAPABILITIES.SENSE_VISION) && hub.has('eeg', CAPABILITIES.SENSE_BIOMETRIC), '')

const state = await hub.sense('tft')
check('只读感知能拿到游戏状态', state.ok && state.data.phase === 'combat', JSON.stringify(state.data))
const eeg = await hub.sense('eeg')
check('预留的生物信号也能读', eeg.ok && eeg.data.attention === 0.72, JSON.stringify(eeg.data))
const unknown = await hub.sense('nope')
check('未知适配器不崩', unknown.ok === false && unknown.reason === 'unknown-adapter', unknown.reason)

const blocked = await hub.act('hands', { type: 'pointer.click', x: 10, y: 20 }, { confirmed: true })
check('默认策略禁止动作', blocked.ok === false && blocked.reason === 'actuation-disabled', blocked.reason)
check('被拦下时没有真的点', clicked === 0, `clicked=${clicked}`)

const open = new BciHub({ policy: { actuation: true, requireConfirmation: true, maxActionsPerMin: 2 } })
open.register(handsAdapter({ 'pointer.click': async () => ({ ok: true }) }))
open.register(tftAdapter(tft))
const needConfirm = await open.act('hands', { type: 'pointer.click' })
check('打开动作后仍要确认', needConfirm.ok === false && needConfirm.reason === 'needs-confirmation', needConfirm.reason)
const confirmed = await open.act('hands', { type: 'pointer.click' }, { confirmed: true })
check('确认后动作执行', confirmed.ok === true, JSON.stringify(confirmed))
const rate = await open.act('hands', { type: 'pointer.click' }, { confirmed: true })
const rate2 = await open.act('hands', { type: 'pointer.click' }, { confirmed: true })
check('每分钟动作有上限', rate.ok && rate2.ok === false && rate2.reason === 'rate-limited', `${rate.ok}/${rate2.ok}`)

const readonly = await open.act('tft', { type: 'pointer.click' }, { confirmed: true })
check('只读适配器永远不能动作', readonly.ok === false && readonly.reason === 'read-only', readonly.reason)
const audit = open.snapshot().audit
check('动作留审计', audit.some((item) => item.kind === 'act' && item.ok === true), `audit=${audit.length}`)

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
