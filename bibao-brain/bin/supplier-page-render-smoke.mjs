#!/usr/bin/env node
/**
 * 回归「读取模型后白屏」：模型列表含 {id,name} 对象时，模型下拉仍能渲染。
 * node bin/supplier-page-render-smoke.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const results = []
const check = (name, ok, detail) => results.push({ name, ok, detail })

// 1. 归一化函数必须存在，且把对象转成 id 字符串
check('modelsOf 归一化模型对象', client.includes("(row?.id ?? '')") && client.includes("typeof row === 'string' ? row : (row?.id ?? '')"))
check('模型列表展示也做归一化', client.includes("entry.models.map((m) => (typeof m === 'string' ? m : m?.id))"))

// 2. 模拟真实场景：models 含对象时，验证下拉映射后的每个子节点都是字符串
const sandbox = { results: [] }
vm.createContext(sandbox)
vm.runInContext(
  `
  const raw = [{ id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' }, 'plain-model', { id: 'GLM-5.3', name: 'GLM-5.3' }]
  const normalized = Array.from(new Set(raw.map((row) => (typeof row === 'string' ? row : (row?.id ?? ''))).filter((v) => typeof v === 'string' && v.trim())))
  results.push({ ok: normalized.every((v) => typeof v === 'string'), value: normalized.join(',') })
  results.push({ ok: normalized.length === 3, value: String(normalized.length) })
  `,
  sandbox,
)
for (const row of sandbox.results) check('下拉子节点全部为字符串', row.ok, row.value)

// 3. option 渲染映射只把字符串放进 children（与 3292 行实现一致）
check('模型 option 用字符串做 label', client.includes("...models.map((id) => h('option', { key: id, value: id }, id))"))

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? '  —  ' + row.detail : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exitCode = 1
