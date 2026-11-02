#!/usr/bin/env node
/** 锚点自检：换分辨率坐标要跟着按比例走，且都落在窗口内。 */
import { anchorsFor, anchorsFromWindows } from '../core/layout.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

const small = anchorsFor({ x: 0, y: 0, w: 1280, h: 720 })
const big = anchorsFor({ x: 100, y: 50, w: 2560, h: 1440 })

// 商店五张卡等距、在窗口内
check('商店是五张', small.shop.length === 5)
check('商店在底部', small.shop.every((point) => point.y / 720 > 0.9))
check('商店等距', Math.abs((small.shop[1].x - small.shop[0].x) - (small.shop[4].x - small.shop[3].x)) < 3)

// 换分辨率：位置按比例放大，且不越界
check('换分辨率按比例', big.shop[0].x > small.shop[0].x * 1.8, `${small.shop[0].x} → ${big.shop[0].x}`)
check('不越界', big.shop.every((point) => point.x <= 100 + 2560 && point.y <= 50 + 1440))

// 棋盘 / 备战席 / 装备
check('棋盘 4×7', small.board.length === 4 && small.board[0].length === 7)
check('备战席 9 格', small.bench.length === 9)
check('装备 10 格', small.items.length === 10)
check('棋盘在窗口中部', small.board[1][3].y / 720 > 0.4 && small.board[1][3].y / 720 < 0.75)

// 从窗口列表里挑最大的那个 TFT
const picked = anchorsFromWindows([
  { title: 'TFT', visible: true, x: 0, y: 0, w: 400, hgt: 300 },
  { title: 'TFT', visible: true, x: 0, y: 0, w: 1280, hgt: 720 },
  { title: 'Other', visible: true, x: 0, y: 0, w: 3000, hgt: 2000 },
])
check('挑最大的游戏窗口', picked && picked.rect.w === 1280, JSON.stringify(picked?.rect))

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
