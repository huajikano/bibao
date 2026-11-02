#!/usr/bin/env node
/**
 * 反向 WS 冒烟：模拟 snowluma 的 wsClient 连上插件，
 * 推送一条事件，并响应插件发出的 get_login_info / send_group_msg 动作。
 */
import { OneBotWsServer } from '../core/onebot-ws-server.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const events = []
const statuses = []
const server = new OneBotWsServer({
  host: '127.0.0.1',
  port: 0,
  path: '/ws',
  token: 'test-token',
  onEvent: (event) => events.push(event),
  onStatus: (status) => statuses.push(status),
  logger: () => {},
})
await server.listen()
const url = `ws://127.0.0.1:${server.port}/ws?access_token=test-token`

const client = new WebSocket(url)
const clientActions = []
let messageId = 9001
client.addEventListener('message', (event) => {
  const payload = JSON.parse(String(event.data))
  if (!payload.action) return
  clientActions.push(payload.action)
  let data = {}
  if (payload.action === 'get_login_info') data = { user_id: 1924666072, nickname: '泠' }
  if (payload.action === 'get_group_list') data = [{ group_id: 576268399, group_name: '测试群', member_count: 3 }]
  if (payload.action === 'send_group_msg') data = { message_id: messageId++ }
  client.send(JSON.stringify({ status: 'ok', retcode: 0, data, echo: payload.echo }))
})
await new Promise((resolve) => client.addEventListener('open', resolve, { once: true }))
await server.waitForPeer(3000)
check('wsClient 能连上并握手', server.peer !== null && statuses.some((item) => item.connected === true), url)

client.send(
  JSON.stringify({
    post_type: 'message',
    message_type: 'group',
    group_id: 576268399,
    user_id: 703586373,
    self_id: 1924666072,
    message: [{ type: 'text', data: { text: '在吗' } }],
    time: Math.floor(Date.now() / 1000),
  }),
)
await new Promise((resolve) => setTimeout(resolve, 200))
check('事件能从 WS 客户端进来', events.length === 1 && events[0].post_type === 'message', `events=${events.length}`)
check('self_id 能从事件里认出来', server.selfId === '1924666072', server.selfId)

const login = await server.loginInfo()
check('动作走同一条 WS', login?.user_id === 1924666072 && clientActions.includes('get_login_info'), JSON.stringify(login))
const groups = await server.groupList()
check('群列表能通过 WS 取回', groups.length === 1 && groups[0].group_id === 576268399, `groups=${groups.length}`)
const sent = await server.sendGroup(576268399, '测试')
check('发消息动作能通过 WS 执行', sent === 9001 && clientActions.includes('send_group_msg'), `messageId=${sent}`)

client.close()
await new Promise((resolve) => setTimeout(resolve, 150))
server.close()
await new Promise((resolve) => setTimeout(resolve, 150))

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
