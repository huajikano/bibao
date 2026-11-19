#!/usr/bin/env node
/** Offline regression for registered providers without a settings namespace. */
import assert from 'node:assert/strict'
import { readDshModelCatalog } from '../core/model-catalog.js'

let passed = 0
const check = async (name, run) => { await run(); passed++; console.log('PASS ' + name) }
const registered = [{ id: 'zcode', name: 'ZCode（智谱）' }]
const models = [{ id: 'GLM-5.3', name: 'GLM-5.3' }, { id: 'GLM-5.3-Flash', name: 'GLM-5.3-Flash' }]

await check('ZCode 无设置命名空间也能显示真实适配器模型', async () => {
  let requested
  const result = await readDshModelCatalog({
    listProviders: () => registered,
    listConfigurableProviders: () => [],
    listModels: async (provider) => { requested = provider; return models },
    discoverModels: async () => { throw new Error('must not discover a saved adapter') },
  }, { provider: 'zcode' })
  assert.equal(requested, 'zcode')
  assert.deepEqual(result.models, models)
  assert.equal(result.note, '')
  assert.equal(result.providers[0].active, true)
})
await check('没有可配置来源目录的宿主仍能读取已注册模型', async () => {
  const result = await readDshModelCatalog({ listProviders: () => registered, listModels: async () => models }, { provider: 'zcode' })
  assert.deepEqual(result.models, models)
})
await check('已注册来源优先适配器，不走设置页端点发现', async () => {
  const result = await readDshModelCatalog({
    listProviders: () => registered,
    listConfigurableProviders: () => [{ provider: 'zcode', displayName: 'ZCode（智谱）', settingsNs: 'llm.zcode' }],
    listModels: async () => models,
    discoverModels: async () => { throw new Error('unexpected discovery') },
  }, { provider: 'zcode' })
  assert.deepEqual(result.models, models)
})
await check('空目录保留登录/禁用含义，不伪造或绕过模型开关', async () => {
  const result = await readDshModelCatalog({
    listProviders: () => registered,
    listConfigurableProviders: () => [{ provider: 'zcode', settingsNs: 'llm.zcode' }],
    listModels: async () => [],
    discoverModels: async () => { throw new Error('must not bypass empty registered catalog') },
  }, { provider: 'zcode' })
  assert.deepEqual(result.models, [])
  assert.match(result.note, /登录状态和模型开关/)
})
await check('读取失败返回可见提示而非无解释的空白', async () => {
  const result = await readDshModelCatalog({ listProviders: () => registered, listModels: async () => { throw new Error('adapter unavailable') } }, { provider: 'zcode' })
  assert.deepEqual(result.models, [])
  assert.match(result.note, /adapter unavailable/)
})
await check('兼容可配置来源发现并传递取消信号', async () => {
  const controller = new AbortController()
  const result = await readDshModelCatalog({
    listProviders: () => [],
    listConfigurableProviders: () => [{ provider: 'saved', settingsNs: 'llm.saved' }],
    discoverModels: async (namespace, request, signal) => {
      assert.equal(namespace, 'llm.saved'); assert.equal(request.provider, 'saved'); assert.equal(signal, controller.signal)
      return [{ id: 'model-a' }]
    },
  }, { provider: 'saved', signal: controller.signal })
  assert.deepEqual(result.models, [{ id: 'model-a', name: 'model-a' }])
})
await check('未配置来源与未知来源都有明确提示', async () => {
  const service = { listProviders: () => [], listConfigurableProviders: () => [{ provider: 'unconfigured', settingsNs: '' }] }
  assert.match((await readDshModelCatalog(service, { provider: 'unconfigured' })).note, /未配置完成/)
  assert.match((await readDshModelCatalog(service, { provider: 'missing' })).note, /没有这个模型来源/)
})
await check('模型目录只回传展示元数据，过滤重复与无效项', async () => {
  const result = await readDshModelCatalog({
    listProviders: () => registered,
    listModels: async () => [{ id: 'model-a', name: 'A', apiKey: 'private' }, { id: 'model-a' }, {}, null],
  }, { provider: 'zcode' })
  assert.deepEqual(result.models, [{ id: 'model-a', name: 'A' }])
})
await check('来源合并去重，账户来源仍排在首位', async () => {
  const result = await readDshModelCatalog({
    listProviders: () => [...registered, { id: 'deepseek-account', name: '账户' }, ...registered],
    listConfigurableProviders: () => [{ provider: 'zcode', settingsNs: '' }, { provider: 'zcode', settingsNs: '' }],
  })
  assert.deepEqual(result.providers.map((row) => row.provider), ['deepseek-account', 'zcode'])
})
console.log(`\n${passed}/${passed} 通过`)
