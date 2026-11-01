/**
 * 轻量词法向量：中文按字 + 二元组、英文按词，FNV 哈希到 256 维再 L2 归一化。
 *
 * 不依赖任何外部 embedding 服务，纯本地、确定性、离线可用。
 * 它抓的是"字面相似"，不是真正的语义相似——但配合 R、情绪、关系一起打分，
 * 已经足够把"上次说的那件事"找回来。将来接上真 embedding，只要换掉 embed()。
 */

export const DIM = 256

const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619

function hashToken(token) {
  let hash = FNV_OFFSET
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

export function embed(text) {
  const vector = new Float32Array(DIM)
  const source = String(text ?? '').toLowerCase()
  if (!source) return vector

  for (const word of source.match(/[a-z0-9]+/g) ?? []) {
    vector[hashToken(word) % DIM] += 1
  }

  const cjk = source.replace(/[^\u4e00-\u9fa5]/g, '')
  for (let index = 0; index < cjk.length; index += 1) {
    vector[hashToken(cjk[index]) % DIM] += 0.6
    if (index + 1 < cjk.length) vector[hashToken(cjk.slice(index, index + 2)) % DIM] += 1
  }

  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm) || 1
  for (let index = 0; index < DIM; index += 1) vector[index] /= norm
  return vector
}

export function cosine(a, b) {
  if (!a || !b) return 0
  let dot = 0
  for (let index = 0; index < DIM; index += 1) dot += a[index] * b[index]
  return dot
}

const SCALE = 127

/** 存成 base64（int8 量化）：256 维 ≈ 344 字节，比 JSON 数组省 3 倍。 */
export function encodeVector(vector) {
  if (!vector) return ''
  const bytes = Buffer.alloc(DIM)
  for (let index = 0; index < DIM; index += 1) {
    bytes[index] = Math.max(-SCALE, Math.min(SCALE, Math.round((vector[index] ?? 0) * SCALE))) & 0xff
  }
  return bytes.toString('base64')
}

export function decodeVector(encoded) {
  if (!encoded) return null
  try {
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length !== DIM) return null
    const vector = new Float32Array(DIM)
    for (let index = 0; index < DIM; index += 1) {
      const value = bytes[index] > 127 ? bytes[index] - 256 : bytes[index]
      vector[index] = value / SCALE
    }
    return vector
  } catch {
    return null
  }
}
