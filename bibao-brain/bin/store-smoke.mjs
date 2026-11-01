#!/usr/bin/env node
/** 持久层自检：种子、归档、事实、过期。 */
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { openBrainStore } from '../core/store.js'
import { embed, cosine, encodeVector, decodeVector } from '../core/embed.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-store-'))
const file = path.join(dir, 'test.sqlite')
const store = openBrainStore(file)
if (!store) {
  console.log('FAIL node:sqlite 不可用')
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

const nodes = [
  { id: 'ep_1', at: 1000, title: '第一条', valence: 0.2, arousal: 0.5, salience: 0.5, sDays: 10, rUpdatedAt: 1000 },
  { id: 'ep_2', at: 2000, title: '第二条', valence: -0.6, arousal: 0.8, salience: 0.7, sDays: 30, rUpdatedAt: 2000 },
  { id: 'ep_3', at: 3000, title: '第三条', valence: 0.1, arousal: 0.2, salience: 0.3, sDays: 5, rUpdatedAt: 3000 },
]
check('种子写入', store.seedEpisodes(nodes) === 3, `count=${store.count()}`)
store.seedEpisodes(nodes)
check('重复种子不翻倍', store.count() === 3, `count=${store.count()}`)

store.archiveEpisode('ep_2', 4000)
check('软删除（归档）', store.count() === 2 && store.archivedCount() === 1, `live=${store.count()} archived=${store.archivedCount()}`)
check('归档可复盘', store.archivedEpisodes(5).some((row) => row.id === 'ep_2'), 'archived list ok')

store.insertFact({
  id: 'fact_a',
  text: '阿柚怕黑',
  confidence: 0.85,
  sourceIds: ['ep_1'],
  createdAt: 5000,
  expiresAt: null,
})
store.insertFact({
  id: 'fact_b',
  text: '疑似想辞职',
  confidence: 0.4,
  sourceIds: ['ep_3'],
  createdAt: 5000,
  expiresAt: 6000,
})
check('事实写入与读取', store.listFacts(5500, 10).length === 2, JSON.stringify(store.listFacts(5500, 10).map((f) => f.text)))
store.insertFact({
  id: 'fact_c',
  text: '她说不想辞职了',
  confidence: 0.8,
  sourceIds: ['ep_1'],
  createdAt: 7000,
  expiresAt: null,
  supersedes: 'fact_a',
})
const afterSupersede = store.listFacts(7500, 10).map((f) => f.id)
check(
  '事实冲突：新事实归档旧事实',
  !afterSupersede.includes('fact_a') && afterSupersede.includes('fact_c'),
  afterSupersede.join(','),
)
check('低置信到期后不再返回', store.expireFacts(6500) === 1 && store.listFacts(7000, 10).length === 1, 'expire ok')

const v1 = embed('阿柚说她自己怕黑')
const v2 = embed('阿柚怕黑，晚上要留灯')
const v3 = embed('今天股市大涨，成交量放大')
const same = cosine(v1, v2)
const diff = cosine(v1, v3)
check('向量：相近文本相似度更高', same > 0.2 && same > diff * 3, `same=${same.toFixed(2)} diff=${diff.toFixed(2)}`)
const round = decodeVector(encodeVector(v1))
check('向量：量化往返误差 < 0.05', Math.abs(cosine(v1, round) - 1) < 0.05, `cos=${cosine(v1, round).toFixed(4)}`)
store.close()
await rm(dir, { recursive: true, force: true })

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
