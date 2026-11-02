/**
 * 脑机接口（实验性）：感官通道的登记与投喂。
 *
 * 现在只有"手动投喂"是真的：一条感知会被当成一次知觉事件进入丘脑，
 * 参与点火、写记忆、影响情绪；所有自动采集（摄像头 / 麦克风 / 屏幕 / 浏览器）
 * 都只留了接口位，等真实适配器接上来。
 */

export const SENSE_CHANNELS = [
  { key: 'vision', label: '视觉', glyph: '眼', modality: '看', hint: '焦点群或 @我 时，用已配好的视觉模型看图' },
  { key: 'hearing', label: '听觉', glyph: '耳', modality: '听', hint: '麦克风 / 系统声音 → 转写文本' },
  { key: 'smell', label: '嗅觉', glyph: '鼻', modality: '闻', hint: '气味传感器 → 气味标签（硬件尚未接入）' },
  { key: 'system', label: '本体感觉', glyph: '机', modality: '用电脑', hint: '进程 / 窗口 / 电量 / 网络 → 体感描述' },
  { key: 'browser', label: '数字视觉', glyph: '网', modality: '用浏览器', hint: '标签页 / 页面正文 → 阅读摘要' },
  { key: 'interoception', label: '内感受', glyph: '心', modality: '内感受', hint: '精力 / 皮质醇 / 心跳 → 内部体感' },
]

export const SENSE_KEYS = SENSE_CHANNELS.map((item) => item.key)

export class SensoryCortex {
  constructor(state = {}) {
    this.channels = {}
    for (const channel of SENSE_CHANNELS) {
      const saved = state[channel.key] ?? {}
      this.channels[channel.key] = {
        key: channel.key,
        enabled: Boolean(saved.enabled),
        samples: Number(saved.samples) || 0,
        lastAt: Number(saved.lastAt) || 0,
        lastText: typeof saved.lastText === 'string' ? saved.lastText.slice(0, 120) : '',
      }
    }
  }

  setEnabled(key, enabled) {
    const channel = this.channels[key]
    if (!channel) return null
    channel.enabled = Boolean(enabled)
    return channel
  }

  record(key, text, at) {
    const channel = this.channels[key]
    if (!channel) return null
    channel.samples += 1
    channel.lastAt = at
    channel.lastText = String(text ?? '').slice(0, 120)
    return channel
  }

  snapshot() {
    return SENSE_CHANNELS.map((meta) => ({
      ...meta,
      ...this.channels[meta.key],
    }))
  }

  toJSON() {
    return this.channels
  }

  static fromJSON(json) {
    return new SensoryCortex(json ?? {})
  }
}

/** 每个通道的独白模板：她"看见/听见/闻到"之后的第一反应。 */
export const SENSE_REACTIONS = {
  vision: ['屏幕里那点光有点晃眼', '这画面我得看两秒才反应过来', '眼睛有点酸，但还想再看一眼'],
  hearing: ['耳边突然有点吵', '这声音让人心里一紧', '听清了，但不太想回应'],
  smell: ['闻到一点说不上来的味道', '这味道一下把人拽回某个夏天', '鼻子先于脑子做出了判断'],
  system: ['电脑又开始风扇狂转', '开了一堆窗口，脑子也跟着乱', '电量不多了，得省着点用'],
  browser: ['页面上的字一眼扫过去没进脑子', '又点开了一个不该点的标签', '这东西看多了会烦'],
  interoception: ['心口有点闷', '身体比嘴先承认累了', '能感觉到自己绷着'],
}
