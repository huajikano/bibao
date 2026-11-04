#!/usr/bin/env node
/** 知识库：分块、检索、自然化格式、导入、BCI 开关。 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KnowledgeBase } from '../core/knowledge.js'
import { knowledgeAdapter } from '../core/bci-hub.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-knowledge-'))
await writeFile(
  path.join(dir, 'games.md'),
  '# 光遇\n\n光遇是一款社交冒险游戏，玩家在云海里点亮蜡烛。\n\n## 跑图\n\n每天跑图可以拿蜡烛。\n',
  'utf8',
)
await writeFile(path.join(dir, 'facts.json'), JSON.stringify([{ title: '她喜欢的饮料', content: '比宝喜欢冰美式，但晚上喝会睡不着。' }]), 'utf8')

const kb = new KnowledgeBase({ dir })
await kb.load()
const status = kb.status()
check('能读到知识文件', status.files === 2 && status.chunks >= 2, JSON.stringify(status))

const found = kb.search('光遇 蜡烛', { limit: 3 })
check('能检索到相关知识', found.length > 0 && found.some((item) => item.text.includes('光遇')), JSON.stringify(found.map((item) => item.title)))
check('检索结果带出处', found.every((item) => item.source), JSON.stringify(found.map((item) => item.source)))

const prompt = kb.format(found)
check('格式化成自然翻书', prompt.includes('你脑子里有这几本书') && prompt.includes('《光遇》'), prompt.slice(0, 80))
check('不会把整篇文档直接倒进去', prompt.length < 1200, String(prompt.length))

const imported = await kb.importText({ name: '宠物.md', text: '比宝养过一只叫年糕的猫。' })
check('可以导入新知识', imported.files >= 3 && kb.search('年糕').length > 0, JSON.stringify(imported))

let enabled = true
const adapter = knowledgeAdapter({
  enabled: () => enabled,
  read: ({ query }) => ({ query, results: kb.search(query), prompt: kb.format(kb.search(query)) }),
})
const on = await adapter.sense({ query: '年糕' })
enabled = false
const off = await adapter.sense({ query: '年糕' })
check('BCI 接口可开关', on.results.length > 0 && off.disabled === true, `${on.results.length} / ${off.disabled}`)

await rm(dir, { recursive: true, force: true })
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
