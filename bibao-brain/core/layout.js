/**
 * 云顶 UI 的固定锚点：只在窗口矩形变化时算一次，之后点击不再问视觉。
 *
 * 坐标全部是相对窗口的比例（0~1），乘以窗口宽高就是像素。
 * 比例按标准 16:9 客户端量出来的，换分辨率不用重标。
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value))

export function anchorsFor(rect = { x: 0, y: 0, w: 1280, h: 720 }) {
  const px = (rx, ry) => ({ x: Math.round(rect.x + clamp01(rx) * rect.w), y: Math.round(rect.y + clamp01(ry) * rect.h) })

  // 商店：五张卡等距；右侧是刷新(D)与升级
  const shopXs = [0.245, 0.375, 0.505, 0.635, 0.765]
  const shopY = 0.945
  return {
    rect,
    shop: shopXs.map((rx) => px(rx, shopY)),
    roll: px(0.145, 0.955),
    level: px(0.115, 0.885),
    // 备战席九个格子（棋盘下方一排）
    bench: Array.from({ length: 9 }, (_, index) => px(0.255 + index * 0.062, 0.83)),
    // 棋盘 7×4 格（我方半场）
    board: Array.from({ length: 4 }, (_, row) =>
      Array.from({ length: 7 }, (_, col) => px(0.3 + col * 0.058, 0.44 + row * 0.075)),
    ),
    // 装备栏（棋盘左侧一列，最多 10 件）
    items: Array.from({ length: 10 }, (_, index) => px(0.045, 0.42 + index * 0.048)),
    // 棋盘中央（捡球/看战况）
    center: px(0.5, 0.5),
  }
}

/** 从窗口矩形列表里挑出游戏窗口，算锚点。 */
export function anchorsFromWindows(list = [], match = 'TFT') {
  const hits = (list ?? []).filter((item) => item.visible && String(item.title).includes(match))
  if (!hits.length) return null
  hits.sort((a, b) => b.w * b.hgt - a.w * a.hgt)
  const win = hits[0]
  return anchorsFor({ x: win.x, y: win.y, w: win.w, h: win.hgt })
}
