#!/usr/bin/env node
/** 视觉端点兼容：完整 URL、拼接 JSON、SSE、纯文本都能读。 */
import { createServer } from 'node:http'
import { createVision } from '../core/vision.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': req.url?.startsWith('/sse') ? 'text/event-stream' : 'application/json' })
  if (req.url?.startsWith('/sse')) {
    res.end('data: {"choices":[{"delta":{"content":"红色"}}]}\n\ndata: [DONE]\n\n')
    return
  }
  if (req.url?.startsWith('/text')) {
    res.end('一只猫坐在窗边')
    return
  }
  // 模拟中转站把两个 JSON 对象拼在一起（用户遇到的 non-whitespace 报错）
  res.end('{"choices":[{"message":{"content":"红色"}}]}\n{"extra":true}')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const shared = { model: 'spark-x2.6', apiKey: 'test-key' }

const concatenated = createVision({ ...shared, baseURL: `http://127.0.0.1:${port}/v1/chat/completions` })
const first = await concatenated.describe(png, { prompt: '只说颜色', maxTokens: 20 })
check('完整 URL + 拼接 JSON', first.text === '红色', first.text)

const sse = createVision({ ...shared, baseURL: `http://127.0.0.1:${port}/sse` })
const second = await sse.describe(png, { prompt: '只说颜色', maxTokens: 20 })
check('SSE 响应', second.text === '红色', second.text)

const plain = createVision({ ...shared, baseURL: `http://127.0.0.1:${port}/text` })
const third = await plain.describe(png, { prompt: '描述一下', maxTokens: 20 })
check('纯文本响应', third.text.includes('一只猫'), third.text)

server.closeAllConnections?.()
await new Promise((resolve) => server.close(resolve))
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exitCode = failed ? 1 : 0
