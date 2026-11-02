#!/usr/bin/env node
/** 表情包选择自检：情绪是底分，对话字面重合才是主要依据。 */
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StickerBook } from '../core/stickers.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'bibao-stickers-'))
const book = new StickerBook(dir)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

await book.add({ buffer: Buffer.concat([png, Buffer.from('a')]), gist: '加班加到崩溃 好累', mood: '无语' })
await book.add({ buffer: Buffer.concat([png, Buffer.from('b')]), gist: '笑死 这也行', mood: '笑' })
await book.add({ buffer: Buffer.concat([png, Buffer.from('c')]), gist: '生气 摔门就走', mood: '生气' })
check('收藏三张', (await book.stats()).count === 3, `count=${(await book.stats()).count}`)

const tired = await book.pick('日常', '今天加班到现在 真的好累')
const laugh = await book.pick('日常', '哈哈哈这也太搞笑了')
check('聊到加班会挑"累"那张', tired.gist.includes('加班'), tired.gist)
check('聊到好笑会挑"笑死"那张', laugh.gist.includes('笑死'), laugh.gist)

const same = await book.add({ buffer: Buffer.concat([png, Buffer.from('a')]), gist: '重复', mood: '无语' })
check('同图不重复入库', same?.dup === true && (await book.stats()).count === 3, `count=${(await book.stats()).count}`)

await book.remove(tired.id)
check('删除生效', (await book.stats()).count === 2, `count=${(await book.stats()).count}`)

await book.load()
check('索引可重载', (await book.stats()).count === 2, 'reloaded')

book.items = []
await rm(dir, { recursive: true, force: true })
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
