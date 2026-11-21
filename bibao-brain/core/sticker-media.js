/** 收 QQ 图片和导入表情包时只接受有限大小的栅格图片，避免把文件路径交给下载器。 */
export const MAX_STICKER_BYTES = 3 * 1024 * 1024
const IMAGE_HOSTS = new Set([
  'multimedia.nt.qq.com', 'multimedia.nt.qq.com.cn',
  'gchat.qpic.cn', 'c2cpicdw.qpic.cn', 'offpic.ssp.qq.com', 'gxh.vip.qq.com',
])

export function stickerImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return ''
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}

export function stickerData({ buffer }) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_STICKER_BYTES) throw new Error('表情包须小于或等于 3 MB')
  const type = stickerImageType(buffer)
  if (!type) throw new Error('图片格式不受支持，须为 PNG、JPEG、GIF 或 WebP')
  return { buffer, type }
}

export function decodeStickerDataUrl(url) {
  const match = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(url)
  if (!match || match[1].length % 4 === 1) throw new Error('需要有效的图片 data URL')
  return stickerData({ buffer: Buffer.from(match[1], 'base64') })
}

export function stickerDataUrl({ type, buffer }) {
  return `data:${type};base64,${buffer.toString('base64')}`
}

function qqImageUrl(input) {
  try {
    const url = new URL(input)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !IMAGE_HOSTS.has(url.hostname)) return null
    url.protocol = 'https:'
    return url
  } catch { return null }
}

async function downloadImage(url, signal) {
  for (let hop = 0; hop <= 2; hop++) {
    const response = await fetch(url, { redirect: 'manual', signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      url = location ? qqImageUrl(new URL(location, url)) : null
      if (!url) throw new Error('图片跳转到非 QQ 图床地址')
      continue
    }
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_STICKER_BYTES || !response.body) {
      await response.body?.cancel()
      throw new Error(response.ok ? '图片为空或超过 3 MB' : `QQ 图片下载失败（HTTP ${response.status}）`)
    }
    const parts = []
    let length = 0
    for await (const part of response.body) {
      length += part.byteLength
      if (length > MAX_STICKER_BYTES) throw new Error('图片超过 3 MB')
      parts.push(part)
    }
    return stickerData({ buffer: Buffer.concat(parts, length) })
  }
  throw new Error('QQ 图片跳转次数过多')
}

/** 优先下载事件地址，过期或只有文件标识时用当前 OneBot 连接刷新。 */
export async function downloadQqSticker(image, bridge, signal) {
  const url = qqImageUrl(image.url)
  let failure
  if (url) {
    try { return await downloadImage(url, AbortSignal.any([signal, AbortSignal.timeout(6000)])) }
    catch (error) { failure = error }
  }
  if (image.fileId && bridge && !signal.aborted) {
    let data
    try { data = (await bridge.call('get_image', { file: image.fileId }, 6500))?.data }
    catch { throw new Error('OneBot 未能刷新这张图片的地址') }
    const refreshed = qqImageUrl(data?.url) ?? qqImageUrl(data?.file)
    if (refreshed && !signal.aborted && refreshed.href !== url?.href) {
      return downloadImage(refreshed, AbortSignal.any([signal, AbortSignal.timeout(6000)]))
    }
  }
  throw failure ?? new Error('事件未提供可下载的 QQ 图片地址')
}
