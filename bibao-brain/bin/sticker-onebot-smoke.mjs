#!/usr/bin/env node
/** 从真实反向 WS 消息到收藏、文本回复与 OneBot 图片动作。所有数据和动作均为本地夹具。 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'
import { StickerBook } from '../core/stickers.js'
import { BibaoBrain } from '../core/brain.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-sticker-ob-'))
const selfId = 100000001
const senderId = 100000002
const focusGroup = 123456781
const otherGroup = 123456782
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const originalPerceive = BibaoBrain.prototype.perceive
const originalFetch = globalThis.fetch
const routes = new Map()
const cleanups = []
const actions = []
const downloads = []
const visionRequests = []
let failures = false
let peer
let checked = 0
let messageId = 100
let rejectText = false
let rejectImages = false
let imageSuffix = '/qq-gif'
const check = (name) => { checked++; console.log('PASS ' + name) }

async function until(read, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await read()
    if (result) return result
    await delay(35)
  }
  assert.fail('等待超时：' + label)
}

function inbound(type, args = {}) {
  const { groupId = focusGroup, userId = senderId, message } = args
  peer.send(JSON.stringify({
    post_type: 'message', message_type: type, self_id: selfId, user_id: userId,
    ...(type === 'group' ? { group_id: groupId } : {}), sender: { nickname: '测试用户' },
    time: Math.floor(Date.now() / 1000), message_id: messageId++, message,
  }))
}
const marker = (fields) => ({ type: 'image', data: { sub_type: 1, summary: '哈哈大笑', ...fields } })
const outgoing = () => actions.filter(({ action }) => action === 'send_private_msg' || action === 'send_group_msg')
const imageActions = () => outgoing().filter(({ params }) => params.message.some(part => part.type === 'image'))
const imageData = (suffix = '/qq-gif') => 'https://multimedia.nt.qq.com.cn' + suffix

async function call(endpoint, body) {
  const method = body === undefined ? 'GET' : 'POST'
  const route = routes.get('/api/bibao' + endpoint.split('?')[0])
  assert.ok(route?.methods.includes(method), endpoint)
  return route.fetch(new Request('http://127.0.0.1/api/bibao' + endpoint, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  }))
}
const shelf = async () => (await call('/stickers')).json()

try {
  const reserve = createServer()
  reserve.listen(0, '127.0.0.1')
  await once(reserve, 'listening')
  const port = reserve.address().port
  await new Promise(resolve => reserve.close(resolve))
  const wsUrl = `ws://127.0.0.1:${port}/ws`
  await writeFile(path.join(dir, `onebot_${selfId}.json`), JSON.stringify({ networks: { wsClients: [{ url: wsUrl, enabled: true }] } }))
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.hostname === 'multimedia.nt.qq.com.cn') {
      downloads.push(url.pathname)
      if (url.pathname === '/expired') return new Response(null, { status: 403 })
      if (url.pathname === '/redirect') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9/original' } })
      const buffer = url.pathname === '/qq-gif' ? gif : Buffer.concat([png, Buffer.from(url.pathname)])
      return new Response(buffer, { headers: { 'content-type': 'application/octet-stream' } })
    }
    if (url.hostname === 'vision.fixture.test') {
      visionRequests.push(JSON.parse(options.body))
      return Response.json({ choices: [{ message: { content: '{"kind":"photo","gist":"一张街景照片","mood":"日常","text":""}' } }] })
    }
    if (url.hostname === '127.0.0.1' && !['9', String(port)].includes(url.port)) return originalFetch(input, options)
    assert.fail('夹具之外的网络请求：' + url.origin)
  }
  apply({
    get: () => undefined,
    effect(factory) { const dispose = factory(); if (typeof dispose === 'function') cleanups.push(dispose); return () => {} },
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => {} } } },
  }, {
    stateFile: path.join(dir, 'brain-state.json'),
    gatePhase2: false,
    useLlm: false,
    vision: { enabled: false, baseURL: 'https://vision.fixture.test/v1', model: 'fixture/vision', apiKey: 'fixture-key' },
    snowluma: {
      enabled: true, configDir: dir, allowGroups: [String(focusGroup)], allowPrivate: false,
      sendEnabled: true, stickers: true, wsMode: 'reverse', selfId: String(selfId),
      wsServer: { enabled: true, host: '127.0.0.1', port, path: '/ws', token: 'fixture-token' },
    },
  })
  await until(async () => (await (await call('/snowluma/state')).json()).snow.mode === 'reverse', '反向 WS 监听')
  peer = new WebSocket(wsUrl + '?access_token=fixture-token')
  peer.addEventListener('message', event => {
    const request = JSON.parse(event.data)
    actions.push(request)
    let data = { message_id: messageId++ }
    if (request.action === 'get_login_info') data = { user_id: selfId, nickname: '比宝测试' }
    if (request.action === 'get_group_list') data = [focusGroup, otherGroup].map(group_id => ({ group_id, group_name: '测试群' + group_id }))
    if (request.action === 'get_image') data = { url: imageData(imageSuffix) }
    const image = request.params?.message?.some(part => part.type === 'image')
    const refused = request.action === 'send_group_msg' && (image ? rejectImages : rejectText)
    peer.send(JSON.stringify({ status: refused ? 'failed' : 'ok', retcode: refused ? 100 : 0, data, echo: request.echo }))
  })
  await until(async () => {
    const state = await (await call('/snowluma/state')).json()
    return state.snow.connected && state.group.groups.some(g => g.id === String(focusGroup) && g.layer === 'foveal')
  }, '焦点群就绪')

  inbound('group', { message: [marker({ url: imageData(), file: 'gif-one' })] })
  const first = await until(async () => (await shelf()).items[0], '入库')
  assert.equal(first.source, 'qq')
  assert.equal(first.mood, '笑')
  assert.equal(first.ext, 'gif')
  assert.equal(first.privateOnly, false)
  assert.doesNotMatch(JSON.stringify(first), /fileId|multimedia|privateTo/)
  assert.equal(visionRequests.length, 0)
  const image = await call('/stickers/file?id=' + first.id)
  assert.equal(image.headers.get('content-type'), 'image/gif')
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), gif)
  const consoleUrl = await until(async () => {
    try { return JSON.parse(await readFile(path.join(dir, 'boot-report.json'), 'utf8')).consoleUrl }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }, '独立控制台启动')
  const consoleEntry = new URL(consoleUrl)
  assert.equal(consoleEntry.hostname, '127.0.0.1')
  const session = await originalFetch(consoleEntry, { redirect: 'error', signal: AbortSignal.timeout(5000) })
  const cookie = session.headers.get('set-cookie')?.split(';')[0]
  await session.arrayBuffer()
  assert.ok(cookie?.startsWith('bibao_ui='))
  const preview = await originalFetch(consoleEntry.origin + '/api/bibao/stickers/file?id=' + first.id, { headers: { cookie }, signal: AbortSignal.timeout(5000) })
  assert.equal(preview.headers.get('content-type'), 'image/gif')
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), gif)
  check('真实 QQ 收图入口可在无视觉时收藏动图，独立控制台返回原始图片字节')

  inbound('group', { message: [marker({ url: imageData(), file: 'gif-one' })] })
  inbound('group', { message: [{ type: 'image', data: { url: imageData('/photo'), sub_type: 0 } }] })
  inbound('group', { message: [marker({ type: 'flash', url: imageData('/flash') })] })
  inbound('group', { groupId: otherGroup, message: [marker({ url: imageData('/unlisted') })] })
  inbound('private', { message: [marker({ url: imageData('/private') })] })
  inbound('group', { userId: selfId, message: [marker({ url: imageData('/own') })] })
  await until(async () => (await shelf()).activity.received === 2, '重复图片被识别')
  assert.deepEqual(downloads, ['/qq-gif'])
  assert.equal((await shelf()).items.length, 1)
  check('重复、自发、白名单外、未允许私聊、闪照和无视觉下的普通图不会入库')

  const text = '哈哈哈哈，这个猫猫表情太好笑啦！'
  const reactionSender = 100000004
  // Freeze the cognitive decision for this fixture so the test measures delivery, including its silence branch.
  BibaoBrain.prototype.perceive = async function (frame) {
    if (frame.channel !== 'group') return originalPerceive.call(this, frame)
    if (frame.entityId !== String(reactionSender) || !frame.text.includes(text)) return { ignited: false, reason: 'fixture silence' }
    const reply = '哈哈，这张猫好好笑'
    return { ignited: true, dual: { action_route: 'REPLY_CURRENT', bubbles: [reply] }, motor: [{ text: reply, delayMs: 0 }] }
  }
  rejectText = true
  const tryReply = async () => (await call('/snowluma/simulate', { groupId: focusGroup, senderId: reactionSender, text, atMe: true, send: true })).json()
  const denied = await tryReply()
  assert.equal(denied.outcome?.route, 'REPLY_CURRENT', JSON.stringify(denied.outcome))
  assert.equal(imageActions().length, 0)
  assert.equal((await shelf()).items[0].uses, 0)
  rejectText = false
  rejectImages = true
  await tryReply()
  assert.equal(imageActions().length, 1)
  assert.equal((await shelf()).items[0].uses, 0)
  assert.ok((await shelf()).activity.lastSendError)
  rejectImages = false
  inbound('group', { userId: reactionSender, message: [{ type: 'at', data: { qq: String(selfId) } }, { type: 'text', data: { text } }] })
  await until(async () => (await shelf()).items.find(item => item.id === first.id)?.uses === 1, '真实消息收到表情包回复')
  assert.equal(imageActions().length, 2)
  assert.equal(imageActions().at(-1).params.message[0].data.file, 'base64://' + gif.toString('base64'))
  assert.equal((await shelf()).items[0].uses, 1)
  assert.equal((await shelf()).activity.sent, 1)
  check('匹配当前笑意且文字已送达才补图，OneBot 确认后计数')
  await tryReply()
  assert.equal(imageActions().length, 2)
  check('同一会话冷却内继续发文字，表情包保持一张')

  imageSuffix = '/refreshed'
  inbound('group', { message: [marker({ url: imageData('/expired'), file: 'expired.png' })] })
  await until(async () => (await shelf()).items.length === 2, '刷新过期签名')
  assert.ok(actions.some(row => row.action === 'get_image' && row.params.file === 'expired.png'))
  assert.ok(downloads.includes('/refreshed'))
  inbound('group', { message: [marker({ url: imageData('/redirect') })] })
  await until(async () => (await shelf()).activity.lastCollectError, '拒绝非 QQ 域跳转')
  assert.equal((await shelf()).items.length, 2)
  check('过期图片可通过 get_image 刷新，下载拒绝非 QQ 域跳转')

  const deniedManual = await call('/stickers', { send: first.id, groupId: otherGroup })
  assert.equal(deniedManual.status, 400)
  const imported = await (await call('/stickers/import', { name: '抱抱.png', dataUrl: 'data:image/png;base64,' + png.toString('base64') })).json()
  assert.equal(imported.item?.source, 'manual')
  assert.equal(imported.item.mood, '安慰')
  assert.equal(visionRequests.length, 0)
  const restored = new StickerBook(path.join(dir, 'stickers'))
  assert.ok((await restored.load()).some(row => row.id === first.id && row.uses === 1))
  check('手动发送检查白名单，无视觉也能导入，使用计数可跨重启恢复')

  inbound('group', { message: `[CQ:image,file=cq.png,sub_type=1,summary=笑死,url=${imageData('/cq')}]` })
  await until(async () => (await shelf()).items.some(item => item.gist === '笑死'), 'CQ 字符串入库')
  assert.ok(downloads.includes('/cq'))
  check('CQ 字符串接收格式也能收藏带标记的表情')

  const visionPatch = await call('/settings', { vision: { enabled: true } })
  assert.equal(visionPatch.status, 200)
  inbound('group', { message: [{ type: 'image', data: { url: imageData('/vision-photo'), sub_type: 0 } }] })
  await until(() => visionRequests.length === 1, '群图视觉判断')
  assert.equal(visionRequests[0].reasoning_effort, undefined)
  assert.equal((await shelf()).items.length, 4)
  assert.equal((await shelf()).activity.saved, 3)
  check('视觉仅在启用时参与补充判断，照片保持未收藏')

  const privateBook = new StickerBook(path.join(dir, 'private-fixture'))
  const restricted = await privateBook.add({ buffer: png, gist: '哈哈大笑', mood: '笑', privateTo: String(senderId) })
  const reaction = { incoming: '哈哈哈哈', reply: '笑死了' }
  assert.equal(await privateBook.chooseReaction(reaction), null)
  assert.equal(await privateBook.chooseReaction({ ...reaction, privateTo: String(selfId) }), null)
  assert.equal((await privateBook.chooseReaction({ ...reaction, privateTo: String(senderId) }))?.id, restricted.id)
  assert.equal(await privateBook.chooseReaction({ ...reaction, privateTo: String(senderId), incoming: '不要发表情' }), null)
  await privateBook.update(restricted.id, { category: 'dusty' })
  assert.equal(await privateBook.chooseReaction({ ...reaction, privateTo: String(senderId) }), null)
  check('私聊素材只在原会话参与匹配，拒绝发图和手动吃灰优先')
} catch (error) {
  failures = true
  console.error(error)
} finally {
  peer?.close()
  for (const dispose of cleanups.reverse()) await dispose()
  BibaoBrain.prototype.perceive = originalPerceive
  globalThis.fetch = originalFetch
  // Host disposal schedules one final persistence pass before the temporary directory can be removed.
  await delay(200)
  const resolved = path.resolve(dir)
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('bibao-sticker-ob-')) {
    await rm(resolved, { recursive: true, force: true })
  }
}
console.log(`${checked} 项表情包 OneBot 端到端检查通过`)
process.exitCode = failures ? 1 : 0
