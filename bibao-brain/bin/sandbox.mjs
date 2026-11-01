#!/usr/bin/env node
/**
 * 命令行验脑器：不依赖 Host、不依赖 QQ、不联网。
 * 用法：node bin/sandbox.mjs [T1 T2 ...]
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSandbox } from '../core/sandbox.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const biography = JSON.parse(await readFile(path.join(here, '..', 'core', 'biography.json'), 'utf8'))
const only = process.argv.slice(2).filter((item) => /^T\d$/.test(item))
const report = await runSandbox({ biography, only: only.length ? only : null })

for (const item of report.results) {
  const flag = item.passed ? 'PASS' : 'FAIL'
  console.log(`\n[${flag}] ${item.id} ${item.name}  (${item.durationMs}ms)`)
  for (const [key, value] of Object.entries(item.metrics)) {
    console.log(`   · ${key}: ${Array.isArray(value) ? value.join(' / ') : value}`)
  }
  if (!item.passed) {
    for (const step of item.steps) console.log(`   > ${step}`)
    if (item.error) console.log(`   ! ${item.error}`)
  }
}

console.log(
  `\n${report.passed}/${report.total} 通过 · ${report.durationMs}ms · Phase 2 ${report.phase2Unlocked ? '可挂载' : '仍锁死'}`,
)
process.exit(report.allPassed ? 0 : 1)
