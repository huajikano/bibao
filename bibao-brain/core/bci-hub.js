/**
 * 脑机接口适配器中心（BCI Hub）。
 *
 * 比宝以后要接的不止一个"接口"：游戏画面、键鼠、摄像头、麦克风，
 * 甚至真正的 EEG / 眼动仪。它们共同点只有两个：
 *   - 能感知（sense）：把外部世界变成一条可被丘脑处理的感知；
 *   - 能动作（act）：把她的意图变成一次受控的输出。
 *
 * 这一层不实现任何设备协议，只提供统一的注册、能力声明、只读/写入策略、
 * 频率限制与审计。真正的适配器可以是本地进程、HTTP 服务或未来的硬件 SDK。
 *
 * 安全默认：
 *  - 任何 readOnly=false 的适配器，默认也不允许动作（policy.actuation=false）；
 *  - 动作默认要求 confirmed=true，并且每分钟有次数上限；
 *  - 所有动作先写审计，再执行；失败也留痕。
 */

export const CAPABILITIES = Object.freeze({
  SENSE_VISION: 'sense.vision',
  SENSE_AUDIO: 'sense.audio',
  SENSE_STATE: 'sense.state',
  SENSE_TOUCH: 'sense.touch',
  SENSE_BIOMETRIC: 'sense.biometric',
  SENSE_KNOWLEDGE: 'sense.knowledge',
  ACT_POINTER: 'act.pointer',
  ACT_KEYBOARD: 'act.keyboard',
  ACT_AUDIO: 'act.audio',
  ACT_DEVICE: 'act.device',
})

export const DEFAULT_POLICY = Object.freeze({
  actuation: false,
  requireConfirmation: true,
  maxActionsPerMin: 12,
})

function nowMs() {
  return Date.now()
}

function normalizeCapabilities(list = []) {
  return [...new Set((Array.isArray(list) ? list : []).map((item) => String(item)).filter(Boolean))]
}

export class BciHub {
  constructor({ policy = {} } = {}) {
    this.policy = { ...DEFAULT_POLICY, ...(policy && typeof policy === 'object' ? policy : {}) }
    this.adapters = new Map()
    this.audit = []
    this.actions = []
  }

  /**
   * 注册一个适配器：
   * { id, label, kind, capabilities, readOnly, sense(payload), act(action), meta }
   */
  register(input = {}) {
    const id = String(input.id ?? '').trim()
    if (!id) throw new Error('BCI adapter needs an id')
    const adapter = {
      id,
      label: String(input.label ?? id).slice(0, 24),
      kind: String(input.kind ?? 'device').slice(0, 16),
      capabilities: normalizeCapabilities(input.capabilities),
      readOnly: input.readOnly !== false,
      sense: typeof input.sense === 'function' ? input.sense : null,
      act: typeof input.act === 'function' ? input.act : null,
      meta: input.meta && typeof input.meta === 'object' ? { ...input.meta } : {},
      registeredAt: nowMs(),
    }
    this.adapters.set(id, adapter)
    this._audit({ kind: 'register', adapter: id, capabilities: adapter.capabilities, readOnly: adapter.readOnly })
    return adapter
  }

  unregister(id) {
    const removed = this.adapters.delete(String(id))
    if (removed) this._audit({ kind: 'unregister', adapter: String(id) })
    return removed
  }

  get(id) {
    return this.adapters.get(String(id)) ?? null
  }

  has(id, capability = '') {
    const adapter = this.get(id)
    if (!adapter) return false
    return capability ? adapter.capabilities.includes(String(capability)) : true
  }

  list() {
    return [...this.adapters.values()].map((adapter) => this._snapshot(adapter))
  }

  /** 只读感知：任何适配器都可以，不经过动作策略。 */
  async sense(id, payload = {}) {
    const adapter = this.get(id)
    if (!adapter) return { ok: false, reason: 'unknown-adapter' }
    if (!adapter.sense) return { ok: false, reason: 'sense-unsupported' }
    try {
      const data = await adapter.sense(payload)
      this._audit({ kind: 'sense', adapter: adapter.id, ok: true })
      return { ok: true, adapter: adapter.id, data }
    } catch (error) {
      this._audit({ kind: 'sense', adapter: adapter.id, ok: false, error: String(error?.message ?? error).slice(0, 120) })
      return { ok: false, adapter: adapter.id, reason: 'sense-failed', error: String(error?.message ?? error).slice(0, 120) }
    }
  }

  /**
   * 受控动作。action = { type, ...payload }。
   * 默认全部拒绝；只有 policy.actuation=true 且适配器非只读时才可能通过。
   */
  async act(id, action = {}, { confirmed = false } = {}) {
    const adapter = this.get(id)
    const type = String(action?.type ?? '')
    const base = { adapter: String(id), type }
    if (!adapter) return { ok: false, ...base, reason: 'unknown-adapter' }
    if (adapter.readOnly) return { ok: false, ...base, reason: 'read-only' }
    if (!adapter.act) return { ok: false, ...base, reason: 'act-unsupported' }
    if (!this.policy.actuation) return { ok: false, ...base, reason: 'actuation-disabled' }
    if (this.policy.requireConfirmation && !confirmed) return { ok: false, ...base, reason: 'needs-confirmation' }

    const head = type.split('.')[0] || type
    const capability = type.startsWith('act.') ? type.split('.').slice(0, 2).join('.') : `act.${head}`
    if (!adapter.capabilities.includes(capability)) {
      return { ok: false, ...base, reason: 'capability-missing', capability }
    }
    if (!this._allow(adapter.id)) {
      this._audit({ kind: 'act', ...base, ok: false, reason: 'rate-limited' })
      return { ok: false, ...base, reason: 'rate-limited' }
    }

    try {
      const data = await adapter.act(action, { confirmed })
      this._audit({ kind: 'act', ...base, ok: true })
      return { ok: true, ...base, data }
    } catch (error) {
      this._audit({ kind: 'act', ...base, ok: false, error: String(error?.message ?? error).slice(0, 120) })
      return { ok: false, ...base, reason: 'act-failed', error: String(error?.message ?? error).slice(0, 120) }
    }
  }

  _allow(adapterId) {
    const now = nowMs()
    this.actions = this.actions.filter((item) => now - item.at < 60_000)
    const recent = this.actions.filter((item) => item.adapter === adapterId)
    if (recent.length >= Math.max(1, Number(this.policy.maxActionsPerMin) || 1)) return false
    this.actions.push({ at: now, adapter: adapterId })
    return true
  }

  _audit(entry) {
    this.audit.push({ at: nowMs(), ...entry })
    if (this.audit.length > 80) this.audit = this.audit.slice(-80)
  }

  _snapshot(adapter) {
    return {
      id: adapter.id,
      label: adapter.label,
      kind: adapter.kind,
      capabilities: adapter.capabilities.slice(),
      readOnly: adapter.readOnly,
      canSense: Boolean(adapter.sense),
      canAct: Boolean(adapter.act) && !adapter.readOnly,
      meta: { ...adapter.meta },
    }
  }

  snapshot() {
    return {
      policy: { ...this.policy },
      adapters: this.list(),
      audit: this.audit.slice(-10),
      actionsLastMinute: this.actions.filter((item) => nowMs() - item.at < 60_000).length,
    }
  }
}

/* ------------------------------------------------------------------ */
/* 现成适配器工厂：把已有模块接进来，不复制它们的逻辑                   */
/* ------------------------------------------------------------------ */

export function tftAdapter(tft) {
  return {
    id: 'tft',
    label: '云顶读状态',
    kind: 'game',
    capabilities: [CAPABILITIES.SENSE_STATE],
    readOnly: true,
    sense: () => (typeof tft?.snapshot === 'function' ? tft.snapshot() : null),
    meta: { mode: 'read-only', note: '只读游戏状态，不碰键鼠' },
  }
}

export function screenVisionAdapter(describe) {
  return {
    id: 'screen',
    label: '屏幕视觉',
    kind: 'vision',
    capabilities: [CAPABILITIES.SENSE_VISION],
    readOnly: true,
    sense: async (payload = {}) => (typeof describe === 'function' ? describe(payload) : null),
    meta: { mode: 'read-only' },
  }
}

/**
 * 键鼠适配器：默认只声明"能"，是否真的允许动作由 hub policy 决定。
 * action = {type:'pointer.click', x, y} / {type:'keyboard.type', text}
 */
export function handsAdapter(actions = {}) {
  return {
    id: 'hands',
    label: '键鼠之手',
    kind: 'actuator',
    capabilities: [CAPABILITIES.ACT_POINTER, CAPABILITIES.ACT_KEYBOARD],
    readOnly: false,
    act: async (action = {}) => {
      const type = String(action.type ?? '')
      const handler = actions[type] ?? actions[type.split('.').at(-1)]
      if (typeof handler !== 'function') throw new Error(`no handler for ${type}`)
      return handler(action)
    },
    meta: { mode: 'actuation', note: '默认禁用；需要在 policy 里显式打开 actuation' },
  }
}

/**
 * 知识库接口：只读检索，不写文件；是否启用由 settings.knowledge.enabled 控制。
 * sense({query, limit}) -> { query, results, prompt }
 */
export function knowledgeAdapter({ read = null, enabled = () => true } = {}) {
  return {
    id: 'knowledge',
    label: '知识库',
    kind: 'knowledge',
    capabilities: [CAPABILITIES.SENSE_KNOWLEDGE],
    readOnly: true,
    sense: async (payload = {}) => {
      if (!enabled()) return { disabled: true, results: [], prompt: '' }
      if (typeof read !== 'function') return { disabled: true, results: [], prompt: '' }
      return read(payload)
    },
    meta: { mode: 'read-only', note: '从导入的知识库里检索，像回忆一样进入语言区' },
  }
}

export function biometricAdapter({ id = 'eeg', label = '脑电', read = null } = {}) {
  return {
    id,
    label,
    kind: 'biometric',
    capabilities: [CAPABILITIES.SENSE_BIOMETRIC],
    readOnly: true,
    sense: async (payload = {}) => (typeof read === 'function' ? read(payload) : null),
    meta: { mode: 'read-only', note: '预留：EEG / 眼动 / 心率等只读通道' },
  }
}
