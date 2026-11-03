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

const mismatched = await book.pick('日常', '今天天气不错', { minScore: 1.0 })
check('不合适就不硬发', mismatched === null, mismatched?.gist ?? 'null')
const moodMatch = await book.pick('笑', '', { minScore: 1.0 })
check('情绪对得上才发', moodMatch?.mood === '笑', moodMatch?.gist ?? 'null')

await book.touch(laugh.id)
const autoCommon = (await book.load()).find((item) => item.id === laugh.id)
check('用够次数自动进常用', autoCommon?.category === 'common', autoCommon?.category ?? 'null')

const moved = await book.update(laugh.id, { category: 'dusty' })
check('可以手动移到吃灰', moved?.category === 'dusty' && moved?.categoryManual === true, moved?.category ?? 'null')
await book.touch(laugh.id)
const stillDusty = (await book.load()).find((item) => item.id === laugh.id)
check('手动分类不会被自动改回', stillDusty?.category === 'dusty', stillDusty?.category ?? 'null')
const categoryStats = await book.stats()
check('分类计数正确', categoryStats.byCategory.dusty === 1 && categoryStats.byCategory.default === 2, JSON.stringify(categoryStats.byCategory))

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
