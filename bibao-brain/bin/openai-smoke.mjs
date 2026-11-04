#!/usr/bin/env node
/** 直连端点兼容：baseURL 和用户直接粘贴的完整 /chat/completions URL 都能用。 */
import { createServer } from 'node:http'
import { chatCompletion } from '../core/openai.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const seen = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    let parsed = null
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = null
    }
    seen.push({ url: req.url, auth: req.headers.authorization, model: parsed?.model })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: '收到' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const key = 'test-key'
const model = 'spark-x2.6'

const base = await chatCompletion({
  baseURL: `http://127.0.0.1:${port}/v2`,
  apiKey: key,
  model,
  system: 's',
  user: 'u',
})
check('baseURL 自动补全路径', base === '收到' && seen[0]?.url === '/v2/chat/completions', seen[0]?.url ?? '')

const full = await chatCompletion({
  baseURL: `http://127.0.0.1:${port}/v2/chat/completions`,
  apiKey: key,
  model,
  system: 's',
  user: 'u',
})
check(
  '完整 URL 不重复拼接',
  full === '收到' && seen[1]?.url === '/v2/chat/completions',
  seen[1]?.url ?? '',
)
check('Bearer key 与 model 正确', seen[1]?.auth === `Bearer ${key}` && seen[1]?.model === model, `${seen[1]?.auth ?? ''} · ${seen[1]?.model ?? ''}`)

server.closeAllConnections?.()
await new Promise((resolve) => server.close(resolve))
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exitCode = failed ? 1 : 0
