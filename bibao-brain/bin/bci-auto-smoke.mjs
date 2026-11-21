#!/usr/bin/env node
/** 自动感官回归：系统体感、内感受、屏幕权限与 BCI 超时。 */
import assert from 'node:assert/strict'
import { BciHub, CAPABILITIES } from '../core/bci-hub.js'
import { SystemProbe, systemSenseText, interoceptionSense, createScreenCaptureAdapter } from '../core/bci-auto.js'
import { SensoryCortex } from '../core/senses.js'

let passed = 0
const check = async (name, run) => { await run(); passed++; console.log('PASS ' + name) }

await check('系统体感只在高负载/低电/断网时进入意识', async () => {
  assert.equal(systemSenseText({ networkUp: false }).notable, true)
  assert.match(systemSenseText({ battery: 15 }).text, /15%/)
  assert.match(systemSenseText({ freeMemMB: 500 }).text, /内存/)
  assert.match(systemSenseText({ cpuPercent: 92 }).text, /风扇/)
  assert.match(systemSenseText({ uptimeMin: 5000 }).text, /83 小时/)
  const calm = systemSenseText({ battery: 80, freeMemMB: 4096, cpuPercent: 20, networkUp: true, uptimeMin: 20 })
  assert.equal(calm.notable, false)
  assert.equal(calm.text, '')
})

await check('系统采样包含 CPU 差值与电源/网络状态', async () => {
  let tick = 0
  const os = {
    cpus: () => {
      tick += 1
      return [{ times: { user: tick, nice: 0, sys: 0, idle: tick % 2 ? 1 : 9, irq: 0 } }]
    },
    freemem: () => 2048 * 1024 * 1024,
    totalmem: () => 8192 * 1024 * 1024,
    networkInterfaces: () => ({ eth: [{ internal: false, family: 'IPv4' }], loop: [{ internal: true, family: 'IPv4' }] }),
    uptime: () => 120,
  }
  const probe = new SystemProbe({ osModule: os, now: () => 400_000, power: async () => ({ battery: 77, activeWindow: '编辑器' }) })
  await probe.sample()
  await probe.sample()
  const metrics = await probe.sample()
  assert.equal(metrics.networkUp, true)
  assert.equal(metrics.battery, 77)
  assert.equal(metrics.activeWindow, '编辑器')
  assert.equal(metrics.freeMemMB, 2048)
  assert.ok(metrics.cpuPercent === null || (metrics.cpuPercent >= 0 && metrics.cpuPercent <= 100))
})

await check('内感受由神经状态转为可读体感', async () => {
  assert.match(interoceptionSense({ energy: 20 }).text, /撑不住/)
  assert.match(interoceptionSense({ energy: 80, cortisol: 0.8 }).text, /绷得紧/)
  assert.match(interoceptionSense({ energy: 80, moodValence: -0.6 }).text, /情绪低/)
  assert.match(interoceptionSense({ energy: 80, sleepDebtMin: 200 }).text, /蒙着一层雾/)
  assert.equal(interoceptionSense({ energy: 80, cortisol: 0.2, moodValence: 0.1 }).notable, false)
})

await check('屏幕适配器默认拒绝自动截屏，明确授权后才截', async () => {
  let captures = 0
  let receivedSignal = null
  const adapter = createScreenCaptureAdapter({
    automaticEnabled: () => false,
    capture: async () => {
      captures += 1
      return 'data:image/jpeg;base64,AAAA'
    },
    describe: async (_url, options) => {
      receivedSignal = options.signal
      return { text: '一个代码窗口' }
    },
  })
  await assert.rejects(() => adapter.sense({ automatic: true }), /明确启用/)
  assert.equal(captures, 0)
  let allowedCaptures = 0
  const allowed = createScreenCaptureAdapter({
    automaticEnabled: () => true,
    capture: async () => {
      allowedCaptures += 1
      return 'data:image/jpeg;base64,AAAA'
    },
    describe: async (_url, options) => {
      receivedSignal = options.signal
      return { text: '一个代码窗口' }
    },
  })
  const signal = new AbortController().signal
  const result = await allowed.sense({ automatic: true }, { signal })
  assert.equal(result.text, '一个代码窗口')
  assert.equal(result.gist, '一个代码窗口')
  assert.equal(allowedCaptures, 1)
  assert.equal(receivedSignal, signal)
  assert.doesNotMatch(JSON.stringify(result), /base64/)
})

await check('外部给图的屏幕读取不需要截屏权限', async () => {
  let captures = 0
  const adapter = createScreenCaptureAdapter({
    automaticEnabled: () => false,
    capture: async () => { captures += 1; return 'data:image/jpeg;base64,AAAA' },
    describe: async () => ({ text: '一张截图' }),
  })
  const result = await adapter.sense({ url: 'https://example.invalid/a.jpg' })
  assert.equal(result.source, 'provided')
  assert.equal(captures, 0)
})

await check('BCI 读取超时不会拖住宿主', async () => {
  const hub = new BciHub()
  hub.register({
    id: 'slow', label: '慢适配器', capabilities: [CAPABILITIES.SENSE_STATE], readOnly: true,
    sense: () => new Promise(() => {}),
  })
  const started = Date.now()
  const result = await hub.sense('slow', {}, { timeoutMs: 80 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'sense-timeout')
  assert.ok(Date.now() - started < 1000)
})

await check('适配器结果带通道标签，供上层回灌大脑', async () => {
  const hub = new BciHub()
  hub.register({ id: 's', label: '本体', capabilities: [CAPABILITIES.SENSE_STATE], readOnly: true, meta: { channel: 'system' }, sense: async () => ({ text: 'ok' }) })
  const result = await hub.sense('s')
  assert.equal(result.channel, 'system')
  assert.deepEqual(result.capabilities, ['sense.state'])
})

await check('感官接入开关可持久化读取', async () => {
  const cortex = new SensoryCortex({ system: { enabled: true, samples: 2 }, interoception: { enabled: false, samples: 1 } })
  assert.equal(cortex.isEnabled('system'), true)
  assert.equal(cortex.isEnabled('interoception'), false)
  assert.equal(cortex.isEnabled('vision'), false)
  cortex.setEnabled('vision', true)
  assert.equal(cortex.isEnabled('vision'), true)
})

console.log(`${passed} 项自动感官检查通过`)
