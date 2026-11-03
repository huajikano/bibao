/**
 * 比宝 · 拟人认知核心（Host 半）
 *
 * 职责：
 * - 持有唯一一颗大脑实例（认知内核 + 生物钟 + 记忆 + 社会关系）；
 * - 把大脑暴露成同源 /api/bibao/* JSON 接口，供侧边栏面板读取与操作；
 * - 跑通 Phase 1 的 6 大沙盒验脑，并把"验脑结果"当作 Phase 2 的物理闸门；
 * - 持久化（原子写），进程重启后大脑继续衰老。
 *
 * 这里没有任何 QQ / snowluma 协议代码：Phase 2 的感官与嘴由后续适配层挂载。
 */

import { copyFile, appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BibaoBrain } from './core/brain.js'
import { GroupAttentionFunnel, defaultGroups } from './core/group.js'
import { runSandbox } from './core/sandbox.js'
import { SnowlumaBridge, wsUrlWithToken } from './core/snowluma.js'
import { OneBotWsServer } from './core/onebot-ws-server.js'
import { createDirectLlm } from './core/openai.js'
import { TokenMeter, meterLlm } from './core/usage.js'
import { openBrainStore } from './core/store.js'
import { createVision } from './core/vision.js'
import { StickerBook } from './core/stickers.js'
import { TftAdapter, MotorModel } from './core/bci.js'
import { BciHub, tftAdapter, screenVisionAdapter, biometricAdapter } from './core/bci-hub.js'
import { ensureHands, handsAlive } from './core/hands.js'
import { createHash } from 'node:crypto'
import { decideTft } from './core/tft.js'
import { anchorsFor, anchorsFromWindows } from './core/layout.js'
import { planPlacements, planPickups, planDeploys } from './core/board.js'
import { pickItemFor } from './core/items.js'
import { planPositioning } from './core/position.js'
import { traitBonus } from './core/traits.js'
import { InputAgent } from './core/input.js'
import { buildGenerationPrompt, parsePersonaJson, templatePersona, validatePersona } from './core/persona.js'
import { renderUiHtml } from './core/webui.js'

export const name = 'bibao-brain'
export const inject = ['connection']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROUTE = '/api/bibao'

const DEFAULTS = {
  userName: '你',
  userId: 'owner',
  useLlm: false,
  provider: '',
  model: '',
  stateFile: '',
  gatePhase2: true,
  // 两个行为旋钮：1 = 现在的表现（记忆力最好 / 想说什么就说什么）
  tuning: { memoryStrength: 1, talkativeness: 1 },
  // 成长：自我复盘与生活流；关掉任何一项都不会影响纯认知内核
  growth: { selfReview: true, life: true },
  // 主动分享：默认关闭，且只发私聊；打开后每天最多一条
  outreach: { enabled: false, minSilenceMin: 360, maxPerDay: 1, minIntimacy: 55, cooldownHours: 8 },
  // 视觉：直接用 DSH 里已经配好的 OpenAI 兼容端点，不内置本地模型
  vision: { enabled: false, model: '', maxPerHour: 20 },
  // 手：默认关着；开着就会真的动鼠标键盘
  game: { control: false, layout: null, autoStart: false },
  llm: {
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat',
  },
  snowluma: {
    enabled: false,
    sendEnabled: false,
    // 留空 = 自动找 snowluma 配置（环境变量 / 当前目录 / 同级目录 / 家目录）
    // 不把作者本机路径写进默认值
    configDir: '',
    httpBase: '',
    httpToken: '',
    wsUrl: '',
    wsToken: '',
    selfId: '',
    maxReplyChars: 60,
    // 白名单为空 = 谁也不理；首次安装必须自己填群号
    allowGroups: [],
    allowPrivate: false,
    // 戳一戳：先感知；回应二选一（戳回去 / 表情包），不生成文字
    pokeReact: true,
    // 兼容旧字段名：现在表示"允许用表情包回应"
    pokeReply: true,
    // 戳一戳是直接对着她，默认不按群白名单拦；不想在某个群回可以把这项关掉
    pokeAnyGroup: true,
    // 被戳后戳回去一下（只一下）；同一对象 20 秒内不重复
    pokeBack: true,
    // auto：snowluma 的 wsClients 开着就反向监听；client：连 snowluma 的 3001；reverse：强制反向监听
    wsMode: 'auto',
    wsServer: { enabled: false, host: '127.0.0.1', port: 8080, path: '/ws', token: '' },
  },
}

const DEMO_MEMBERS = [
  { id: '100000002', name: '阿柚', tags: ['死党'] },
  { id: '100000004', name: '老周', tags: ['室友'] },
  { id: '100000005', name: '一只鹿', tags: ['网友'] },
  { id: '100000007', name: '陈老师', tags: ['班主任'] },
  { id: '100000008', name: '杠精小王', tags: [] },
]

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  settings.snowluma = { ...DEFAULTS.snowluma, ...(config?.snowluma ?? {}) }
  settings.snowluma.wsServer = { ...DEFAULTS.snowluma.wsServer, ...(config?.snowluma?.wsServer ?? {}) }
  settings.llm = { ...DEFAULTS.llm, ...(config?.llm ?? {}) }
  settings.tuning = { ...DEFAULTS.tuning, ...(config?.tuning ?? {}) }
  settings.growth = { ...DEFAULTS.growth, ...(config?.growth ?? {}) }
  settings.outreach = { ...DEFAULTS.outreach, ...(config?.outreach ?? {}) }
  settings.vision = { ...DEFAULTS.vision, ...(config?.vision ?? {}) }
  settings.game = { ...DEFAULTS.game, ...(config?.game ?? {}) }
  const dataDir = path.dirname(
    settings.stateFile || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'bibao', 'brain-state.json'),
  )
  const stateFile = settings.stateFile || path.join(dataDir, 'brain-state.json')
  const settingsFile = path.join(dataDir, 'settings.json')
  const usage = new TokenMeter({ file: path.join(dataDir, 'usage.json') })
  const visionUsage = (row = {}) =>
    usage.record({
      logic: 'vision',
      provider: 'direct',
      model: settings.vision.model,
      source: 'vision',
      input: row.input,
      output: row.output,
      cacheRead: row.cacheRead,
      cacheCreation: row.cacheCreation,
      latencyMs: row.latencyMs,
      estimated: row.estimated,
    })

  let biography = null
  let brain = null
  let store = null
  // AI 生成的人物草稿：应用时只发 id，避免把几 KB 的 JSON 塞进 URL（会 431）
  let personaDraft = null
  let personaDraftId = ''
  let vision = null
  let stickers = null
  const tft = new TftAdapter()
  const motor = new MotorModel()
  // 多脑机接口的发现层：现在只有只读通道；真正的动作要显式打开 policy
  const bci = new BciHub({ policy: { actuation: false, requireConfirmation: true, maxActionsPerMin: 12 } })
  bci.register(tftAdapter(tft))
  bci.register(
    screenVisionAdapter(async (payload = {}) => {
      if (!vision) return { ok: false, reason: 'vision-not-ready' }
      const url = String(payload.url ?? payload.imageUrl ?? '')
      if (!url) return { ok: false, reason: 'no-image-url' }
      const described = await vision.describe(url, { prompt: String(payload.prompt ?? '') })
      return { text: String(described?.text ?? '').slice(0, 800), gist: String(described?.text ?? '').slice(0, 80) }
    }),
  )
  bci.register(
    biometricAdapter({
      read: async () => ({
        energy: Math.round(brain?.state.energy ?? 0),
        cortisol: Number((brain?.state.cortisol ?? 0).toFixed(2)),
        mood: Number((brain?.state.moodValence ?? 0).toFixed(2)),
        note: '由内在状态导出的只读近似，不是真实 EEG/眼动硬件',
      }),
    }),
  )
  let inputAgent = null
  let handsTimer = null
  let outreachTimer = null
  const auto = { running: false, step: 0, log: [], startedAt: 0, lastError: '', bought: 0 }
  let visionHour = { hour: -1, count: 0 }
  const pokeSeen = new Set()
  const pokeCooldown = new Map()
  const pokeActionCooldown = new Map()
  const stickerCooldown = new Map()
  let funnel = null
  let gate = null
  let loading = null
  let saveTimer = null
  const timers = new Set()
  const diag = { bootedAt: Date.now(), state: 0, lastStateAt: 0, talk: 0, group: 0, sandbox: 0, lastPath: '', lastUa: '' }
  let diagTimer = null

  function noteDiag(routePath, request) {
    diag.lastPath = routePath
    diag.lastAt = Date.now()
    if (routePath === '/state') {
      diag.state += 1
      diag.lastStateAt = Date.now()
      diag.lastUa = String(request?.headers?.get?.('user-agent') ?? '').slice(0, 120)
    }
    if (routePath === '/talk') diag.talk += 1
    if (routePath.startsWith('/group')) diag.group += 1
    if (routePath === '/sandbox/run') diag.sandbox += 1
    if (diagTimer) return
    diagTimer = setTimeout(() => {
      diagTimer = null
      writeFile(path.join(dataDir, 'diag.json'), JSON.stringify(diag, null, 2), 'utf8').catch(() => {})
    }, 1500)
    if (typeof diagTimer.unref === 'function') diagTimer.unref()
  }

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  const fail = (message, status = 500, extra = {}) => json({ error: message, ...extra }, status)

  /** POST body：优先读 JSON，读不到再读查询串里的 payload（有的链路会吃掉 body）。 */
  async function readBody(request) {
    let body = null
    try {
      body = await request.clone().json()
    } catch {
      body = null
    }
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      try {
        const payload = new URL(request.url).searchParams.get('payload')
        if (payload) body = JSON.parse(payload)
      } catch {
        /* 查询串里也没有合法 JSON */
      }
    }
    return body && typeof body === 'object' ? body : {}
  }

  async function loadBiography() {
    if (biography) return biography
    // 用户改过的人生优先：~/.dsh/bibao/biography.json，其次才是包内原始传记
    try {
      biography = JSON.parse(await readFile(path.join(dataDir, 'biography.json'), 'utf8'))
      biography.__source = 'override'
      return biography
    } catch {
      /* 没有覆盖文件 */
    }
    biography = JSON.parse(await readFile(path.join(HERE, 'core', 'biography.json'), 'utf8'))
    biography.__source = 'builtin'
    return biography
  }

  /** 用一份传记重新出生：/reset 与 /biography 共用同一条路径。 */
  function friendList() {
    const rows = brain.social.snapshot().filter((row) => (row.interactions ?? 0) >= 10)
    // 旧存档里可能聊够了但 friend 标记还是 false；面板读取时补上，让她自己"记住"这个人
    for (const row of rows) {
      const relation = brain.social.get(row.id)
      if (relation && !relation.friend) {
        relation.friend = true
        relation.friendSource = relation.friendSource ?? 'self'
        relation.friendAt = relation.friendAt ?? Date.now()
        row.friend = true
        row.friendSource = relation.friendSource
        row.friendAt = relation.friendAt
      }
    }
    return rows
      .sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0) || b.intimacy - a.intimacy)
      .map((row) => ({
        id: row.id,
        name: row.name,
        intimacy: Math.round(row.intimacy * 10) / 10,
        trust: Math.round(row.trust * 10) / 10,
        powerFear: Math.round((row.powerFear ?? 0) * 100) / 100,
        impression: row.impression ?? '',
        interactions: row.interactions ?? 0,
        boundaryHits: row.boundaryHits ?? 0,
        tags: row.tags ?? [],
        friendSource: row.friendSource ?? 'self',
        friendAt: row.friendAt ?? null,
        // 账号就是 QQ；单独给前端用，不覆盖昵称
        account: row.id,
      }))
  }

  function rebuildBrain(bio, seed = 20261101) {
    const llms = llmNow()
    brain = new BibaoBrain({
      biography: bio,
      seed: Number(seed) || 20261101,
      startMs: Date.now(),
      virtual: false,
      llm: llms.broca.llm,
      llmProvider: llms.broca.provider,
      llmModel: llms.broca.model,
      userName: settings.userName,
      userId: settings.userId,
      store,
      growth: settings.growth,
    })
    brain.llms = llms
    brain.social.upsert({
      qq: settings.userId,
      name: settings.userName,
      intimacy: 42,
      trust: 58,
      tags: ['正在和我说话的人'],
      impression: '会主动找我说话',
    })
    funnel = new GroupAttentionFunnel({ social: brain.social, interests: brain.interests, userName: brain.name })
    for (const group of defaultGroups()) funnel.addGroup(group)
    funnel.focus('g_class', Date.now())
    return brain
  }

  // 六个认知模块各一个配置槽；只有真正会调用模型的那几个会用到这里
  const LOGICS = ['funnel', 'ignition', 'appraisal', 'memory', 'broca', 'feedback']
  const LEGACY_LOGIC_ALIAS = { reflection: 'memory' }

  /** 每个认知逻辑各自解析模型：逻辑级覆盖 > 默认直连 > DSH 默认模型 > 本地布洛卡。 */
  function resolveLogic(name) {
    const base = settings.llm ?? DEFAULTS.llm
    const override = base.profiles?.[name] ?? base.profiles?.[LEGACY_LOGIC_ALIAS[name]] ?? {}
    const cfg = {
      baseURL: override.baseURL || base.baseURL,
      apiKey: override.apiKey || base.apiKey,
      model: override.model || base.model,
    }
    if (override.enabled !== false && cfg.apiKey && cfg.baseURL && cfg.model) {
      const onUsage = (row = {}) =>
        usage.record({
          logic: name,
          provider: 'direct',
          model: cfg.model,
          source: 'direct',
          input: row.input,
          output: row.output,
          cacheRead: row.cacheRead,
          cacheCreation: row.cacheCreation,
          latencyMs: row.latencyMs,
          estimated: row.estimated,
        })
      return { llm: createDirectLlm({ ...cfg, onUsage }), provider: 'direct', model: cfg.model, source: 'direct' }
    }
    const dsh = ctx.get('llm')
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null
    const provider = settings.provider || selection?.provider || ''
    const model = settings.model || selection?.model || ''
    if (settings.useLlm && dsh && provider && model) {
      return {
        llm: meterLlm(dsh, { meter: usage, logic: name, provider, model, source: 'dsh' }),
        provider,
        model,
        source: 'dsh',
      }
    }
    return { llm: null, provider: '', model: '', source: 'local' }
  }

  function llmNow() {
    const llms = {}
    for (const name of LOGICS) llms[name] = resolveLogic(name)
    return llms
  }

  async function persist() {
    if (!brain) return
    try {
      await mkdir(dataDir, { recursive: true })
      const tmp = `${stateFile}.tmp`
      await writeFile(tmp, JSON.stringify(brain.toJSON()), 'utf8')
      await rename(tmp, stateFile)
    } catch (error) {
      console.warn('[bibao] persist failed:', error?.message ?? error)
    }
  }

  function schedulePersist(delay = 1200) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, delay)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
    timers.add(saveTimer)
  }

  async function boot() {
    // 手：插件自己负责起；起不来只记日志，永远不抛
    if (settings.game.autoStart === true && !handsTimer) {
      handsTimer = setInterval(() => {
        void ensureHands({ log: (line) => void appendSnowLog({ at: Date.now(), kind: 'hands', line }).catch(() => {}) }).catch(() => {})
      }, 30000)
      void ensureHands({ log: (line) => void appendSnowLog({ at: Date.now(), kind: 'hands', line }).catch(() => {}) }).catch(() => {})
    }
    if (brain) return brain
    if (loading) return loading
    loading = (async () => {
      await usage.load()
      const bio = await loadBiography()
      store = openBrainStore(path.join(dataDir, 'bibao.sqlite'))
      // 面板里切换过的语言区开关，重启后仍然有效
      try {
        const saved = JSON.parse(await readFile(settingsFile, 'utf8'))
        if (typeof saved?.useLlm === 'boolean') settings.useLlm = saved.useLlm
        if (saved?.snowluma && typeof saved.snowluma === 'object') {
          // 以前只恢复 enabled/sendEnabled/allowGroups，手填的 WS/HTTP 地址与 token
          // 重启后会丢失，表现为"配置保存了但客户端连不上"。这里逐字段恢复。
          for (const key of ['enabled', 'sendEnabled', 'allowPrivate', 'pokeReact', 'pokeBack', 'pokeReply', 'pokeAnyGroup', 'recallEnabled', 'stickers']) {
            if (typeof saved.snowluma[key] === 'boolean') settings.snowluma[key] = saved.snowluma[key]
          }
          for (const key of ['httpBase', 'httpToken', 'wsUrl', 'wsToken', 'selfId', 'configDir']) {
            if (typeof saved.snowluma[key] === 'string') settings.snowluma[key] = saved.snowluma[key]
          }
          if (Number.isFinite(Number(saved.snowluma.maxReplyChars))) {
            settings.snowluma.maxReplyChars = Number(saved.snowluma.maxReplyChars)
          }
          if (Array.isArray(saved.snowluma.allowGroups)) settings.snowluma.allowGroups = saved.snowluma.allowGroups.map(String)
          if (saved.snowluma.wsMode === 'auto' || saved.snowluma.wsMode === 'client' || saved.snowluma.wsMode === 'reverse') {
            settings.snowluma.wsMode = saved.snowluma.wsMode
          }
          if (saved.snowluma.wsServer && typeof saved.snowluma.wsServer === 'object') {
            settings.snowluma.wsServer = { ...DEFAULTS.snowluma.wsServer, ...saved.snowluma.wsServer }
          }
        }
        if (saved?.tuning && typeof saved.tuning === 'object') settings.tuning = { ...DEFAULTS.tuning, ...saved.tuning }
        if (saved?.growth && typeof saved.growth === 'object') settings.growth = { ...DEFAULTS.growth, ...saved.growth }
        if (saved?.outreach && typeof saved.outreach === 'object') settings.outreach = { ...DEFAULTS.outreach, ...saved.outreach }
        if (saved?.vision && typeof saved.vision === 'object') {
    settings.vision = { ...DEFAULTS.vision, ...saved.vision }
  }
  if (saved?.llm && typeof saved.llm === 'object') {
          settings.llm = { ...DEFAULTS.llm, ...saved.llm, profiles: { ...(saved.llm.profiles ?? {}) } }
        }
      } catch {
        /* 第一次运行没有设置文件 */
      }
      const llms = llmNow()
      let restored = null
      try {
        restored = JSON.parse(await readFile(stateFile, 'utf8'))
      } catch {
        restored = null
      }
      if (restored && restored.memory && restored.schema) {
        brain = BibaoBrain.fromJSON(restored, {
          biography: bio,
          llm: llms.broca.llm,
          llmProvider: llms.broca.provider,
          llmModel: llms.broca.model,
          userName: settings.userName,
          userId: settings.userId,
          store,
          growth: settings.growth,
        })
        brain.growth = { ...brain.growth, ...settings.growth }
      } else {
        brain = new BibaoBrain({
          biography: bio,
          seed: 20261101,
          startMs: Date.now(),
          virtual: false,
          llm: llms.broca.llm,
          llmProvider: llms.broca.provider,
          llmModel: llms.broca.model,
          userName: settings.userName,
          userId: settings.userId,
          store,
          growth: settings.growth,
        })
        if (store) store.seedEpisodes(brain.memory.episodes)
        brain.social.upsert({
          qq: settings.userId,
          name: settings.userName,
          intimacy: 42,
          trust: 58,
          friend: true,
          tags: ['正在和我说话的人'],
          impression: '会主动找我说话',
        })
      }
      brain.llms = llms
      // 模型名缺 provider/ 前缀时自动补全：网关只认 provider/model
      if (settings.llm.model && !settings.llm.model.includes('/')) {
        try {
          const res = await fetch(`${settings.llm.baseURL.replace(/\/+$/, '')}/models`, {
            headers: { authorization: `Bearer ${settings.llm.apiKey}` },
            signal: AbortSignal.timeout(4000),
          })
          const list = (await res.json())?.data ?? []
          const hit = list.find((row) => String(row.id).toLowerCase().endsWith(`/${settings.llm.model}`.toLowerCase()))
          if (hit) {
            await appendSnowLog({ at: Date.now(), kind: 'model-repair', from: settings.llm.model, to: hit.id })
            settings.llm.model = hit.id
          }
        } catch {
          /* 网关不可达就先留着，等用户自己改 */
        }
      }
      brain.applyTuning(settings.tuning)
      stickers = stickers || new StickerBook(path.join(dataDir, 'stickers'))
      vision = createVision({
        baseURL: settings.llm.baseURL,
        apiKey: settings.llm.apiKey,
        model: settings.vision.model,
        onUsage: visionUsage,
      })
      {
        const owner = brain.social.get(settings.userId)
        if (owner) owner.friend = true
        // 有 bridge 就拉一次真实好友列表，把它们标成好友（失败不影响启动）
        if (snow.bridge && snow.connected) {
          snow.bridge
            .call('get_friend_list', {})
            .then((list) => {
              const rows = Array.isArray(list) ? list : list?.data ?? []
              for (const row of rows) {
                const id = String(row?.user_id ?? row?.userId ?? '')
                if (!id) continue
                const relation = brain.social.ensure(id, row?.nickname ?? row?.remark ?? id)
                relation.friend = true
                if (row?.remark) relation.remark = String(row.remark).slice(0, 24)
              }
              schedulePersist(200)
            })
            .catch(() => {})
        }
      }
      // 重启会丢掉"上次保存到现在"这段时间：超过一分钟就整条时间轴平移回来
      {
        const drift = brain.simMs - Date.now()
        if (Math.abs(drift) > 60000) {
          brain.shiftTime(-drift)
          await appendSnowLog({ at: Date.now(), kind: 'clock-boot-align', driftMs: -drift })
        }
      }
      funnel = new GroupAttentionFunnel({
        social: brain.social,
        interests: brain.interests,
        userName: brain.name,
      })
      for (const group of defaultGroups()) funnel.addGroup(group)
      // 焦点群：把互动最多的"毕业摸鱼群"设成默认焦点
      funnel.focus('g_class', Date.now())
      // 首次出生后立刻落盘：即使面板从未打开，这颗脑子也已经存在过
      void persist()
      if (!outreachTimer) {
        outreachTimer = setInterval(() => {
          void maybeOutreach().catch((error) =>
            appendSnowLog({ at: Date.now(), kind: 'outreach-error', error: String(error?.message ?? error).slice(0, 160) }),
          )
        }, 10 * 60 * 1000)
        if (typeof outreachTimer.unref === 'function') outreachTimer.unref()
      }
      return brain
    })()
    return loading
  }

  function refreshLlm() {
    if (!brain) return
    const llms = llmNow()
    brain.llms = llms
    brain.llm = llms.broca.llm
    brain.llmProvider = llms.broca.provider
    brain.llmModel = llms.broca.model
  }

  async function runGate() {
    const bio = await loadBiography()
    const report = await runSandbox({ biography: bio })
    gate = { ...report, checkedAt: Date.now() }
    return gate
  }

  function phase2Open() {
    if (!settings.gatePhase2) return true
    return Boolean(gate?.phase2Unlocked)
  }

  function phase2Locked() {
    return fail('Phase 2 锁死：6 大认知沙盒尚未全部通过', 423, {
      gate: gate ?? null,
      hint: '先到「验脑」页跑完 6 个基准测试',
    })
  }

  function maskKey(key) {
    const text = String(key ?? '')
    if (!text) return ''
    if (text.length <= 8) return '••••'
    return `${text.slice(0, 4)}…${text.slice(-4)}`
  }

  function snapshot() {
    if (!brain) return null
    refreshLlm()
    const snap = brain.snapshot()
    return {
      ...snap,
      gate: gate
        ? { allPassed: gate.allPassed, passed: gate.passed, total: gate.total, checkedAt: gate.checkedAt }
        : null,
      phase2: {
        unlocked: phase2Open(),
        simulated: true,
        note: '此处为 Phase 2 预演：三层注意力漏斗在本地模拟感官流上运行，尚未挂载 snowluma。',
      },
      roster: DEMO_MEMBERS,
      group: funnel ? funnel.snapshot() : null,
      snow: {
        enabled: settings.snowluma.enabled,
        sendEnabled: settings.snowluma.sendEnabled,
        recallEnabled: Boolean(settings.snowluma.recallEnabled),
        stickers: settings.snowluma.stickers !== false,
        pokeReact: settings.snowluma.pokeReact !== false,
        pokeReply: settings.snowluma.pokeReply !== false,
        pokeAnyGroup: settings.snowluma.pokeAnyGroup !== false,
        pokeBack: settings.snowluma.pokeBack === true,
        connected: snow.connected,
        wsStatus: snow.wsStatus ?? null,
        reason: snow.reason,
        selfId: settings.snowluma.selfId || snow.cfg?.selfId || '',
        selfName: snow.selfName,
        httpBase: settings.snowluma.httpBase || snow.cfg?.httpBase || '',
        wsUrl: snow.cfg?.mode === 'reverse' ? snow.cfg.wsUrl : settings.snowluma.wsUrl || snow.cfg?.wsUrl || '',
        configDir: settings.snowluma.configDir || '',
        mode: snow.cfg?.mode ?? 'client',
        hasHttpToken: Boolean(settings.snowluma.httpToken || snow.cfg?.httpToken),
        hasWsToken: Boolean(settings.snowluma.wsToken || snow.cfg?.wsToken),
        stats: snow.bridge?.stats ?? null,
        lastEvent: snow.lastEvent,
        allowGroups: settings.snowluma.allowGroups ?? [],
        allowPrivate: Boolean(settings.snowluma.allowPrivate),
      },
      vision: { ...settings.vision },
      bci: bci.snapshot(),
      asleep: brain.isAsleep(),
      llmConfig: {
        useLlm: settings.useLlm,
        baseURL: settings.llm.baseURL,
        model: settings.llm.model,
        hasKey: Boolean(settings.llm.apiKey),
        keyMask: maskKey(settings.llm.apiKey),
        profiles: LOGICS.map((logicName) => {
          const override = settings.llm.profiles?.[logicName] ?? {}
          const resolved = brain?.llms?.[logicName] ?? resolveLogic(logicName)
          return {
            name: logicName,
            baseURL: override.baseURL ?? '',
            model: override.model ?? '',
            hasKey: Boolean(override.apiKey),
            keyMask: maskKey(override.apiKey),
            enabled: override.enabled !== false,
            source: resolved.source,
            active: resolved.source !== 'local',
            resolvedModel: resolved.model || '',
          }
        }),
      },
      facts: store?.listFacts(brain.simMs, 12) ?? [],
      archive: { archivedEpisodes: store?.archivedCount() ?? 0 },
      console: {
        url: consoleState.port ? `http://127.0.0.1:${consoleState.port}/?token=${consoleState.token}` : '',
        port: consoleState.port,
      },
      outreach: { ...settings.outreach, state: brain.outreach },
      usage: usage.snapshot(),
      settings: { useLlm: settings.useLlm, provider: settings.provider, model: settings.model, stateFile },
    }
  }

  /* ------------------------------------------------------------------ */
  /* 群聊漏斗（Phase 2 预演）：防抖 3s 后结算，再决定要不要占用大脑         */
  /* ------------------------------------------------------------------ */

  function scheduleFlush(key, dueAt) {
    const delay = Math.max(200, dueAt - Date.now())
    const timer = setTimeout(() => {
      timers.delete(timer)
      void flushGroup(key)
    }, delay)
    if (typeof timer.unref === 'function') timer.unref()
    timers.add(timer)
  }

  async function flushGroup(key) {
    if (!funnel || !brain) return null
    const frame = funnel.take(key)
    if (!frame) return null
    const message = frame.message
    const group = funnel.get(message.groupId)
    if (group && group.layer !== 'foveal') {
      funnel.record({
        kind: 'read-only',
        group: group.name,
        text: message.text,
        layer: group.layer,
        reason: '余光/免打扰只看不回',
      })
      return { stage: 'read-only', layer: group.layer, group }
    }
    const anchors = funnel.anchorsOf(message)
    funnel.record({
      kind: 'flush',
      group: group?.name ?? message.groupId,
      text: message.text,
      count: frame.texts.length,
      anchors: anchors.map((a) => a.label),
    })
    funnel.stats.escalated += 1

    const result = await brain.perceive({
      entityId: message.senderId,
      entityName: message.senderName,
      text: message.text,
      channel: 'group',
      atMe: Boolean(message.atMe),
      // 已经分到焦点注视的群，注意力本来就落在了那里，等效于一点额外的显著度
      priority: anchors.some((a) => a.key === 'at-me') ? 0.25 : group?.layer === 'foveal' ? 0.2 : 0.1,
      groupId: group?.id,
      groupName: group?.name,
    })

    const transfer = result.dual?.action_route === 'TRANSFER_PRIVATE_GOSSIP'

    if (transfer) {
      funnel.stats.transfers += 1
      funnel.record({
        kind: 'transfer',
        group: group?.name ?? '',
        target: result.dual.transfer_target_name,
        text: (result.dual.bubbles ?? []).join(' '),
      })
    }
    funnel.record({
      kind: 'brain',
      group: group?.name ?? '',
      route: result.dual?.action_route,
      inner: result.dual?.inner_monologue ?? '',
      bubbles: result.dual?.bubbles ?? [],
    })
    schedulePersist()
    return { frame, result, anchors }
  }

  async function feedGroup(payload = {}) {
    if (!phase2Open()) return { locked: true }
    await boot()
    const group = funnel.get(payload.groupId)
    if (!group) return { error: 'unknown-group' }
    const sender = DEMO_MEMBERS.find((item) => item.id === String(payload.senderId)) ?? DEMO_MEMBERS[0]
    const message = {
      groupId: group.id,
      groupName: group.name,
      senderId: sender.id,
      senderName: sender.name,
      text: String(payload.text ?? '').slice(0, 300),
      atMe: Boolean(payload.atMe),
    }
    brain.sync()
    const focusGroup = funnel.get(message.groupId)
    if (message.images?.length && focusGroup?.layer === 'foveal') {
      void perceiveImage(message)
    }
    if (brain.attention.distracted && !message.atMe) {
      funnel.record({ kind: 'skip', group: funnel.get(message.groupId)?.name ?? '', text: message.text, reason: '在打游戏，没看手机' })
      return
    }
    const decision = funnel.ingest(message, { now: Date.now(), energy: brain.state.energy })
    funnel.tick(Date.now())
    funnel.record({
      kind: 'ingest',
      group: group.name,
      sender: sender.name,
      text: message.text,
      decision: decision.decision,
      reason: decision.reason,
      anchors: (decision.anchors ?? []).map((a) => a.label),
    })
    let settled = null
    const key = `${group.id}:${sender.id}`
    if (decision.debounce?.buffered) {
      scheduleFlush(key, decision.debounce.dueAt)
    } else if (decision.debounce?.force) {
      settled = await flushGroup(key)
    } else if (decision.toThalamus) {
      settled = await flushGroup(key)
    }
    schedulePersist()
    return { decision, settled, group: funnel.snapshot() }
  }

  /* ------------------------------------------------------------------ */
  /* Phase 2 · snowluma：感官（WS 收）与嘴（HTTP 发）                       */
  /* ------------------------------------------------------------------ */

  const snow = { bridge: null, cfg: null, connected: false, reason: '', lastEvent: null, selfName: '', wsStatus: null, lastStatus: null }

  /** 试开一次 WS：能 open 就算通，立刻关掉，不占连接。 */
  function probeWs(url, token, timeoutMs = 3000) {
    return new Promise((resolve) => {
      if (!url) return resolve({ ok: false, error: '没有 wsUrl' })
      let done = false
      let socket = null
      const finish = (result) => {
        if (done) return
        done = true
        try {
          socket?.close()
        } catch {
          /* 已经关了 */
        }
        resolve(result)
      }
      try {
        socket = new WebSocket(wsUrlWithToken(url, token), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
      } catch (error) {
        return finish({ ok: false, error: String(error?.message ?? error) })
      }
      socket.addEventListener('open', () => finish({ ok: true }))
      socket.addEventListener('error', () => finish({ ok: false, error: '握手失败（端口没开或 token 不对）' }))
      socket.addEventListener('close', (event) => finish({ ok: false, error: 'closed ' + event.code }))
      setTimeout(() => finish({ ok: false, error: '超时 ' + timeoutMs + 'ms' }), timeoutMs)
    })
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  /**
   * 不把作者本机路径写死。
   * 显式配置可以是 snowluma 安装根目录，也可以直接是 config 目录；
   * 其余候选覆盖插件 cwd、cwd 的父级、家目录、DSH 家目录，以及常见的大小写目录名。
   */
  function snowConfigCandidates() {
    const home = os.homedir()
    const cwd = process.cwd()
    const dshHome = process.env.DSH_HOME || path.join(home, '.dsh')
    const seeds = []
    const add = (value) => {
      if (value) seeds.push(String(value))
    }
    add(settings.snowluma.configDir)
    add(process.env.SNOWLUMA_CONFIG_DIR)
    for (const base of [cwd, path.dirname(cwd), path.dirname(path.dirname(cwd)), home, path.dirname(home), dshHome, path.dirname(dshHome)]) {
      for (const name of ['snowluma', 'SnowLuma', 'snowLuma']) {
        add(path.join(base, name))
        add(path.join(base, name, 'config'))
      }
    }
    add(path.join(home, '.snowluma'))
    add(path.join(home, '.snowluma', 'config'))

    const expanded = []
    for (const seed of seeds) {
      const resolved = path.resolve(seed)
      expanded.push(resolved, path.join(resolved, 'config'), path.join(resolved, 'snowluma', 'config'))
    }
    return expanded.filter((item, index, list) => list.indexOf(item) === index).slice(0, 80)
  }

  let snowConfigDirCache = ''

  async function hasOneBot(dir) {
    try {
      const files = await readdir(dir)
      return files.some((name) => /^onebot_.*\.json$/.test(name))
    } catch {
      return false
    }
  }

  async function resolveSnowConfigDir() {
    if (snowConfigDirCache && (await hasOneBot(snowConfigDirCache))) return snowConfigDirCache
    for (const dir of snowConfigCandidates()) {
      if (await hasOneBot(dir)) {
        snowConfigDirCache = dir
        return dir
      }
    }
    // 最后再浅扫一层盘符：D:\XiangMu\snowluma、C:\Tools\SnowLuma 这类任意安装位置
    const roots = [...new Set([path.parse(process.cwd()).root, path.parse(os.homedir()).root, 'C:\\', 'D:\\', 'E:\\'])]
    for (const root of roots) {
      let entries = []
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries.slice(0, 300)) {
        if (!entry.isDirectory()) continue
        for (const name of ['snowluma', 'SnowLuma', 'snowLuma']) {
          const dir = path.join(root, entry.name, name, 'config')
          if (await hasOneBot(dir)) {
            snowConfigDirCache = dir
            return dir
          }
        }
      }
    }
    return ''
  }

  async function loadSnowConfig() {
    const conf = settings.snowluma
    // 逐字段合并：手填的优先，没填的才回落到 snowluma 自己的 onebot 配置
    let base = { httpBase: '', httpToken: '', wsUrl: '', wsToken: '', selfId: String(conf.selfId ?? ''), reverse: null }
    // 总是读一次 snowluma 自己的配置：即使用户手填了 WS/HTTP，也要拿到 selfId，
    // 否则戳一戳的目标判断会失效，自己的消息也不会被过滤。
    const configDir = await resolveSnowConfigDir()
    if (!configDir) {
      snow.reason = '未找到 snowluma 配置目录：请设置 SNOWLUMA_CONFIG_DIR 环境变量，或在插件配置里填 snowluma.configDir'
    } else {
      try {
        const files = await readdir(configDir)
        const file = files.find((name) => /^onebot_.*\.json$/.test(name))
        if (file) {
          const raw = JSON.parse(await readFile(path.join(configDir, file), 'utf8'))
          const http = raw.networks?.httpServers?.[0]
          const ws = raw.networks?.wsServers?.[0]
          // snowluma 的 old 版本可能不写 enabled 字段；有 url 且没有被显式关掉就算开着
          const wsClient = (raw.networks?.wsClients ?? []).find((item) => item?.url && item?.enabled !== false)
          base = {
            selfId: String(String(file).match(/\d+/)?.[0] ?? conf.selfId ?? ''),
            httpBase: http ? `http://${http.host}:${http.port}` : '',
            httpToken: http?.accessToken ?? '',
            wsUrl: ws ? `ws://${ws.host}:${ws.port}${ws.path && ws.path !== '/' ? ws.path : '/'}` : '',
            wsToken: ws?.accessToken ?? '',
            // snowluma 自己的 wsClients 开着 = 它在找我们，应该由我们监听
            reverse: wsClient
              ? { url: String(wsClient.url ?? ''), token: String(wsClient.accessToken ?? ''), name: String(wsClient.name ?? '') }
              : null,
          }
        }
      } catch (error) {
        if (!conf.httpBase || !conf.wsUrl) snow.reason = `读取 snowluma 配置失败：${error.message}`
      }
    }
    return {
      ...conf,
      fallbackWsUrl: base.wsUrl,
      fallbackWsToken: base.wsToken,
      selfId: String(conf.selfId || base.selfId || ''),
      httpBase: conf.httpBase || base.httpBase,
      httpToken: conf.httpToken || base.httpToken,
      wsUrl: conf.wsUrl || base.wsUrl,
      wsToken: conf.wsToken || base.wsToken,
      reverse: base.reverse,
    }
  }

  async function appendSnowLog(entry) {
    try {
      await mkdir(dataDir, { recursive: true })
      await appendFile(path.join(dataDir, 'snowluma-log.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      /* 日志写不进去不影响主流程 */
    }
  }

  /**
   * 反向 WS：snowluma 的 wsClients 主动连到我们。
   * 它不再依赖 3000/3001 是否开着；事件和动作都走同一条连接。
   */
  async function startReverseSnow(cfg, attempt = 0) {
    const conf = settings.snowluma.wsServer ?? {}
    const fallbackUrl = String(conf.url ?? 'ws://127.0.0.1:8080/ws')
    const targetUrl = String(conf.enabled ? conf.url || fallbackUrl : cfg.reverse?.url || fallbackUrl)
    let parsed = null
    try {
      parsed = new URL(targetUrl)
    } catch {
      snow.reason = `反向 WS 地址非法：${targetUrl}`
      return false
    }
    const host = String(conf.enabled && conf.host ? conf.host : parsed.hostname || '127.0.0.1')
    const port = Number(conf.enabled && conf.port ? conf.port : parsed.port || 8080)
    const path = String(conf.enabled && conf.path ? conf.path : parsed.pathname || '/ws')
    const token = String(conf.enabled && conf.token ? conf.token : cfg.reverse?.token || conf.token || '')

    let setupReverse = async () => {}
    let reverseSetup = false
    const server = new OneBotWsServer({
      host,
      port,
      path,
      token,
      logger: (line) => {
        console.warn('[bibao:reverse-ws]', line)
        void appendSnowLog({ at: Date.now(), kind: 'reverse-ws-log', line })
      },
      onEvent: (event) => {
        void handleSnowEvent(event)
      },
      onStatus: (status) => {
        snow.connected = Boolean(status.connected)
        snow.lastStatus = { ...status }
        snow.wsStatus = status.connected
          ? { ok: true, at: Date.now(), url: `ws://${host}:${port}${path}`, mode: 'reverse' }
          : { ok: false, at: Date.now(), url: `ws://${host}:${port}${path}`, mode: 'reverse' }
        if (status.connected) {
          snow.reason = ''
          void appendSnowLog({ at: Date.now(), kind: 'ws-status', connected: true, mode: 'reverse' })
          void setupReverse()
        } else {
          // 新 peer 连上来时要重新 login/取群列表；否则热重载/断线后会用旧的空 selfId
          reverseSetup = false
          void appendSnowLog({ at: Date.now(), kind: 'ws-status', connected: false, mode: 'reverse', code: status.code ?? null })
        }
      },
    })
    snow.bridge = server
    snow.cfg = {
      ...cfg,
      wsUrl: `ws://${host}:${port}${path}`,
      wsToken: token,
      selfId: String(cfg.selfId ?? ''),
      mode: 'reverse',
    }
    snow.reason = `反向 WS 监听 ws://${host}:${port}${path}，等待 snowluma wsClient 连接`
    try {
      await server.listen()
    } catch (error) {
      snow.bridge = null
      try {
        server.close()
      } catch {
        /* 已经关了 */
      }
      const text = String(error?.message ?? error).slice(0, 120)
      snow.reason = `反向 WS 监听 ${host}:${port}${path} 失败：${text}`
      await appendSnowLog({ at: Date.now(), kind: 'ws-reverse-error', host, port, path, attempt, error: text })
      // 插件热重载时旧实例可能还占着 8080 一小会儿：退避重试，不要直接掉回正向连接
      if (attempt < 6) {
        const delay = 1200 * (attempt + 1)
        snow.reason = `反向 WS 监听失败（${text}），${Math.round(delay / 1000)}s 后重试`
        const timer = setTimeout(() => {
          void startReverseSnow(cfg, attempt + 1).catch(() => {})
        }, delay)
        if (typeof timer.unref === 'function') timer.unref()
        return true
      }
      return false
    }
    await appendSnowLog({ at: Date.now(), kind: 'ws-reverse-listen', url: `ws://${host}:${port}${path}`, token: token ? 'set' : 'none' })

    setupReverse = async () => {
      if (reverseSetup) return
      reverseSetup = true
      try {
        const login = await server.loginInfo()
        snow.selfName = login?.nickname ?? ''
        const selfId = String(login?.user_id ?? server.selfId ?? cfg.selfId ?? '')
        snow.cfg.selfId = selfId
        server.selfId = selfId
        const groups = await server.groupList()
        funnel = new GroupAttentionFunnel({ social: brain.social, interests: brain.interests, userName: brain.name })
        for (const group of groups) {
          funnel.addGroup({
            id: String(group.group_id),
            name: group.group_name,
            memberCount: Number(group.member_count ?? 0),
            layer: 'muted',
          })
        }
        const first =
          groups.find((group) => (settings.snowluma.allowGroups ?? []).includes(String(group.group_id))) ?? groups[0]
        if (first) funnel.focus(String(first.group_id), Date.now())
        snow.reason = ''
        await appendSnowLog({ at: Date.now(), kind: 'ws-reverse-ready', selfId, groups: groups.length })
      } catch (error) {
        reverseSetup = false
        snow.reason = `反向 WS 已连接，但初始化失败：${String(error?.message ?? error).slice(0, 120)}`
      }
    }

    // 不阻塞启动：snowluma 的 wsClient 每 10 秒重试一次，连上后 onStatus 会初始化
    void server
      .waitForPeer(12_000)
      .then(setupReverse)
      .catch(() => {
        snow.reason = `反向 WS 已在 ${host}:${port}${path} 监听，等待 snowluma wsClient 连接`
      })
    return true
  }

  async function startSnow() {
    if (snow.bridge) return
    if (!settings.snowluma.enabled) {
      snow.reason = '未启用（snowluma.enabled=false）'
      return
    }
    if (!phase2Open()) {
      snow.reason = 'Phase 2 锁死：先通过 6 大验脑'
      return
    }
    const cfg = await loadSnowConfig()
    if (!cfg) {
      snow.reason ||= '未找到 snowluma 的 onebot 配置'
      return
    }
    snow.cfg = cfg
    // snowluma 的 wsClients 开着 = 它在主动连出来；此时应该由我们监听，
    // 而不是继续去连它可能根本没开的 3001。
    const reverseWanted =
      settings.snowluma.wsMode === 'reverse' ||
      (settings.snowluma.wsMode !== 'client' && (settings.snowluma.wsServer?.enabled === true || Boolean(cfg.reverse?.url)))
    if (reverseWanted) {
      const started = await startReverseSnow(cfg)
      if (!started) snow.reason ||= `反向 WS 没有起来（${settings.snowluma.wsMode}）`
      // 反向模式失败时不要偷偷连 8080/3001：把真实原因留在 snow.reason 里
      return
    }
    let wsOk = await probeWs(cfg.wsUrl, cfg.wsToken)
    if (!wsOk.ok && cfg.fallbackWsUrl && cfg.fallbackWsUrl !== cfg.wsUrl) {
      snow.reason = '自定义 WS 连不上（' + cfg.wsUrl + '：' + wsOk.error + '），已回退到 ' + cfg.fallbackWsUrl
      cfg.wsUrl = cfg.fallbackWsUrl
      cfg.wsToken = cfg.fallbackWsToken || cfg.wsToken
      wsOk = await probeWs(cfg.wsUrl, cfg.wsToken)
    }
    snow.wsStatus = { ...wsOk, at: Date.now(), url: cfg.wsUrl }
    if (!wsOk.ok) snow.reason = 'WS 连不上：' + cfg.wsUrl + '（' + wsOk.error + '）'
    void appendSnowLog({ at: Date.now(), kind: 'ws-probe', ok: wsOk.ok, url: cfg.wsUrl, error: wsOk.error ?? '' })
    snow.cfg = cfg
    const bridge = new SnowlumaBridge({
      httpBase: cfg.httpBase,
      httpToken: cfg.httpToken,
      wsUrl: cfg.wsUrl,
      wsToken: cfg.wsToken,
      selfId: cfg.selfId,
      logger: (line) => {
        console.warn('[bibao:snowluma]', line)
        void appendSnowLog({ at: Date.now(), kind: 'snow-log', line })
      },
      onStatus: (status) => {
        snow.connected = Boolean(status.connected)
        snow.lastStatus = { ...status }
        if (status.connected) {
          snow.reason = snow.reason.startsWith('自定义 WS') ? snow.reason : ''
          snow.wsStatus = { ok: true, at: Date.now(), url: snow.cfg?.wsUrl ?? '' }
        } else if (!snow.reason) {
          snow.reason = 'WS 断开，正在重连'
        }
        void appendSnowLog({ at: Date.now(), kind: 'ws-status', connected: snow.connected, code: status.code ?? null, at_ms: status.at ?? null })
      },
      onEvent: (event) => {
        void handleSnowEvent(event)
      },
    })
    snow.bridge = bridge
    try {
      const login = await bridge.loginInfo()
      snow.selfName = login?.nickname ?? ''
      const groups = await bridge.groupList()
      // 真机接管后，漏斗只认真实群；模拟群全部退场
      funnel = new GroupAttentionFunnel({ social: brain.social, interests: brain.interests, userName: brain.name })
      for (const group of groups) {
        funnel.addGroup({
          id: String(group.group_id),
          name: group.group_name,
          memberCount: Number(group.member_count ?? 0),
          layer: 'muted',
        })
      }
      const first = groups.find((group) => (settings.snowluma.allowGroups ?? []).includes(String(group.group_id))) ?? groups[0]
      if (first) funnel.focus(String(first.group_id), Date.now())
      snow.reason = ''
    } catch (error) {
      snow.reason = `snowluma HTTP 不可用：${error.message}`
    }
    bridge.connect()
  }

  function stopSnow() {
    snow.bridge?.close()
    snow.bridge = null
    snow.connected = false
    snow.reason = '已断开'
  }

  /**
   * 发完文字后补一张表情包：不是抽奖，先看情绪和上下文合不合适。
   * 90 秒内对同一个人/群最多一张，避免刷图。
   */
  async function maybeSticker({ targetId = null, groupId = null, context = '' } = {}) {
    if (!stickers || settings.snowluma.stickers === false) return false
    if (!snow.bridge) return false
    const key = groupId ? `group:${groupId}` : `user:${targetId}`
    if (Date.now() - (stickerCooldown.get(key) ?? 0) < 90_000) return false
    if (Math.random() > 0.28) return false
    try {
      const item = await stickers.pick(stickerMood(), context, { minScore: 1.0 })
      if (!item) return false
      stickerCooldown.set(key, Date.now())
      if (stickerCooldown.size > 300) stickerCooldown.delete(stickerCooldown.keys().next().value)
      const id = groupId
        ? await snow.bridge.sendGroup(groupId, '', item.file)
        : await snow.bridge.sendPrivate(targetId, '', item.file)
      await appendSnowLog({
        at: Date.now(),
        kind: 'sticker-out',
        groupId: groupId ?? '',
        target: targetId ?? '',
        gist: item.gist,
        messageId: id,
      })
      return true
    } catch (error) {
      await appendSnowLog({ at: Date.now(), kind: 'sticker-error', message: String(error?.message ?? error).slice(0, 120) })
      return false
    }
  }

  async function deliver(result, { targetId, groupId, dry = false }) {
    const bubbles = result.dual?.bubbles ?? []
    if (dry) {
      await appendSnowLog({
        at: Date.now(),
        kind: 'dry-send',
        groupId: groupId ?? '',
        target: targetId ?? '',
        route: result.dual?.action_route,
        bubbles,
        gossip: result.dual?.transfer_bubbles ?? [],
      })
      return
    }
    const transfer = result.dual?.action_route === 'TRANSFER_PRIVATE_GOSSIP'
    const gossip = result.dual?.transfer_bubbles ?? []
    if (!settings.snowluma.sendEnabled) {
      if (bubbles.length || gossip.length) snow.reason = '只读观察：sendEnabled=false，未发送'
      return
    }
    if (!snow.bridge) return
    const send = async (text, to) => {
      try {
        const id = groupId ? await snow.bridge.sendGroup(groupId, text) : await snow.bridge.sendPrivate(to, text)
        await appendSnowLog({ at: Date.now(), kind: 'out', groupId: groupId ?? '', target: to ?? '', text, route: result.dual?.action_route })
        return id
      } catch (error) {
        snow.reason = `发送失败：${error.message}`
        return null
      }
    }
    if (transfer) {
      const to = result.dual?.transfer_target_qq
      for (const text of gossip) {
        await wait(600 + text.length * 120)
        await send(text, to)
      }
      return
    }
    let previous = 0
    let firstId = null
    for (const step of result.motor ?? []) {
      const delta = Math.max(0, step.delayMs - previous)
      previous = step.delayMs
      await wait(delta)
      const id = await send(step.text, targetId)
      if (firstId === null) firstId = id
    }
    if ((result.motor ?? []).length) {
      await wait(900)
      await maybeSticker({
        targetId,
        groupId,
        context: `${result.dual?.inner_monologue ?? ''} ${(result.dual?.bubbles ?? []).join(' ')}`,
      })
      // 犹豫的第三种：发完忍不住补一句
      const tail = result.dual?.afterthought
      if (tail) {
        await wait(1200)
        await send(tail, targetId)
      }
    }
    if (result.dual?.trigger_regret_recall && firstId && settings.snowluma.recallEnabled === true) {
      await wait(3800)
      try {
        await snow.bridge.deleteMessage(firstId)
        await appendSnowLog({ at: Date.now(), kind: 'delete', groupId: groupId ?? '', target: targetId ?? '', messageId: firstId })
      } catch (error) {
        snow.reason = `撤回失败：${error.message}`
      }
    }
  }

  /**
   * 主动分享：只在显式打开、对方是亲近的人、安静很久、今天确实有事情时说一句。
   * 全部走私聊，避免在群里刷存在感。
   */
  async function maybeOutreach() {
    if (!settings.outreach?.enabled) return
    if (!settings.snowluma.sendEnabled || !settings.snowluma.allowPrivate) return
    await boot()
    if (!brain || !snow.bridge) return
    brain.sync()
    const proposal = brain.outreachProposal({ settings: settings.outreach })
    if (!proposal.ok || !proposal.targetId || !proposal.text) return
    try {
      const id = await snow.bridge.sendPrivate(proposal.targetId, proposal.text)
      brain.markOutreach({ proposal, at: brain.simMs })
      schedulePersist()
      await appendSnowLog({
        at: Date.now(),
        kind: 'outreach',
        target: proposal.targetId,
        name: proposal.targetName,
        text: proposal.text,
        reason: proposal.reason,
        messageId: id,
      })
    } catch (error) {
      await appendSnowLog({ at: Date.now(), kind: 'outreach-error', target: proposal.targetId, error: String(error?.message ?? error).slice(0, 160) })
    }
  }

  async function respondPrivate(message) {
    await boot()
    brain.sync()
    const result = await brain.perceive({
      entityId: message.senderId,
      entityName: message.senderName,
      text: message.text,
      channel: 'private',
    })
    schedulePersist()
    await deliver(result, { targetId: message.senderId })
  }

  async function snowFlush(key, { dry = false } = {}) {
    if (!funnel || !brain) return { stage: 'not-ready' }
    const frame = funnel.take(key)
    if (!frame) {
      await appendSnowLog({ at: Date.now(), kind: 'flush-miss', key })
      return { stage: 'no-frame', key }
    }
    const message = frame.message
    const group = funnel.get(message.groupId)
    if (group && group.layer !== 'foveal') {
      const skipped = {
        stage: 'read-only',
        reason: `${group.layer === 'peripheral' ? '余光' : '免打扰'}群只看不回`,
        layer: group.layer,
        groupId: group.id,
      }
      funnel.record({ kind: 'read-only', group: group.name, text: message.text, layer: group.layer, reason: skipped.reason })
      await appendSnowLog({ at: Date.now(), kind: 'read-only', groupId: group.id, layer: group.layer, text: message.text })
      return skipped
    }
    brain.sync()
    const result = await brain.perceive({
      entityId: message.senderId,
      entityName: message.senderName,
      text: message.text,
      channel: 'group',
      atMe: Boolean(message.atMe),
      // 已经分到焦点注视的群，注意力本来就落在那里；被 @ 再额外加权，
      // 否则真机上大多数群消息会卡在点火阈值下面，一句话都不回。
      priority: message.atMe ? 0.35 : group?.layer === 'foveal' ? 0.25 : 0.06,
      groupId: group?.id,
      groupName: group?.name,
    })
    schedulePersist()
    funnel.record({
      kind: 'brain',
      group: group?.name ?? '',
      route: result.dual?.action_route,
      inner: result.dual?.inner_monologue ?? '',
      bubbles: result.dual?.bubbles ?? [],
    })
    await appendSnowLog({
      at: Date.now(),
      kind: 'decide',
      group: group?.name ?? '',
      sender: message.senderName,
      text: message.text,
      route: result.dual?.action_route,
      inner: result.dual?.inner_monologue ?? '',
      bubbles: result.dual?.bubbles ?? [],
    })
    await deliver(result, { groupId: group?.id, targetId: message.senderId, dry })
    return {
      stage: 'ok',
      ignited: result.ignited,
      reason: result.reason ?? '',
      route: result.dual?.action_route ?? 'SILENT_SKIP',
      salience: result.salience,
      theta: result.theta,
      bubbles: result.dual?.bubbles ?? [],
      inner: result.dual?.inner_monologue ?? '',
      dry,
    }
  }

  function scheduleSnowFlush(key, dueAt) {
    const delay = Math.max(200, dueAt - Date.now())
    const timer = setTimeout(() => {
      timers.delete(timer)
      // 定时器里绝不能吞异常：失败要留下痕迹，否则表现就是"永远不回"
      snowFlush(key).catch((error) =>
        appendSnowLog({ at: Date.now(), kind: 'flush-error', key, error: String(error?.message ?? error) }),
      )
    }, delay)
    timers.add(timer)
    void appendSnowLog({ at: Date.now(), kind: 'flush-scheduled', key, delay })
  }

  function stickerMood() {
    if (!brain) return '日常'
    if (brain.state.cortisol > 0.62) return '生气'
    if (brain.state.moodValence > 0.35) return '笑'
    if (brain.state.energy < 30) return '无语'
    return '日常'
  }

  /** 戳一戳：把"有人碰了她一下"变成一次触觉感知。 */
  async function perceivePoke(event) {
    if (!settings.snowluma.pokeReact) return
    const selfId = String(snow.cfg?.selfId ?? '')
    const userId = String(event.user_id ?? '')
    const targetId = String(event.target_id ?? '')
    if (!userId || userId === selfId) return
    const groupId = String(event.group_id ?? '')
    if (groupId && settings.snowluma.pokeAnyGroup === false && !(settings.snowluma.allowGroups ?? []).map(String).includes(groupId)) return

    // 余光/免打扰群只看不回：戳一戳也不回戳、不发图
    const group = groupId ? funnel?.get(groupId) : null
    if (groupId && targetId === selfId && group?.layer !== 'foveal') {
      const name = brain.social.ensure(userId, String(event.sender_name ?? userId)).name
      const layer = group?.layer ?? 'muted'
      brain.perceiveSense({
        channel: 'touch',
        text: `${name} 在${layer === 'peripheral' ? '余光' : '免打扰'}群里戳了你一下`,
        intensity: 0.25,
      })
      funnel?.record({ kind: 'poke-read-only', group: group?.name ?? groupId, userId, layer })
      await appendSnowLog({ at: Date.now(), kind: 'poke-read-only', groupId, userId, layer })
      return
    }

    const key = `poke:${event.time ?? 0}:${userId}:${targetId}`
    if (pokeSeen.has(key)) return
    pokeSeen.add(key)
    if (pokeSeen.size > 300) pokeSeen.delete(pokeSeen.values().next().value)

    const cooldownKey = groupId || 'private'
    const now = Date.now()
    if ((pokeCooldown.get(cooldownKey) ?? 0) > now) return
    pokeCooldown.set(cooldownKey, now + 5000)

    const relation = brain.social.ensure(userId, String(event.sender_name ?? userId))
    const targetsSelf = targetId === selfId
    if (targetsSelf) {
      brain.social.adjust(userId, { intimacy: 0.6 }, { count: false })
      // 睡着的时候戳一下能把人叫醒
      const woke = brain.isAsleep() ? brain.wake() : false
      const line = woke ? `${relation.name}把你戳醒了` : `${relation.name}戳了你一下`
      brain.perceiveSense({ channel: 'touch', text: line, intensity: woke ? 0.85 : 0.55 })
      if (woke) await appendSnowLog({ at: now, kind: 'poke-wake', groupId, userId })
      funnel.record({ kind: 'poke', group: funnel.get(groupId)?.name ?? '', text: line })
      await appendSnowLog({ at: now, kind: 'poke-in', groupId, userId, target: targetId })
      // 二选一：戳回去一下（不再说话），或者发一张表情包；不生成文字回复
      void reactToPoke({ userId, groupId, relation, woke }).catch((error) =>
        appendSnowLog({ at: Date.now(), kind: 'poke-action-error', groupId, userId, error: String(error?.message ?? error).slice(0, 160) }),
      )
      return
    }
    // 别人互戳：只有焦点群才当背景感知
    if ((funnel.get(groupId)?.layer ?? 'muted') === 'foveal') {
      brain.perceiveSense({ channel: 'touch', text: `群里有人戳了${targetId}一下`, intensity: 0.25 })
    }
  }

  /**
   * 被戳后的反应只有两种，且每次只做一种：
   *   1) 戳回去一下，不说话；
   *   2) 发一张收藏的表情包，不说话。
   * 素材不够/发送失败时，能戳就戳；两者都关掉就安静。
   */
  async function reactToPoke({ userId, groupId, relation, woke = false } = {}) {
    if (!brain || !snow.bridge) return
    if (!settings.snowluma.sendEnabled) return
    if (!groupId && !settings.snowluma.allowPrivate) return
    if (groupId && settings.snowluma.pokeAnyGroup === false && !(settings.snowluma.allowGroups ?? []).map(String).includes(String(groupId))) return
    if (groupId && funnel?.get(groupId)?.layer !== 'foveal') return

    const cooldownKey = `${groupId || 'private'}:${userId}`
    const now = Date.now()
    if ((pokeActionCooldown.get(cooldownKey) ?? 0) > now) return
    pokeActionCooldown.set(cooldownKey, now + 20_000)
    if (pokeActionCooldown.size > 300) pokeActionCooldown.delete(pokeActionCooldown.keys().next().value)

    const canPoke = settings.snowluma.pokeBack !== false
    const canSticker = settings.snowluma.pokeReply !== false && stickers && settings.snowluma.stickers !== false
    const mood = stickerMood()
    const playful = brain.playfulness()
    const context = `${relation?.name ?? ''} 戳了你一下 ${woke ? '刚被吵醒' : ''}`
    let choice = canSticker ? await stickers.choose(mood, context) : null
    // 玩心高的时候，"无语/笑"这类通用表情也适合被戳；低玩心就懒得找图，直接戳回去
    if (canSticker && playful >= 0.5) {
      for (const alt of ['无语', '笑']) {
        const altChoice = await stickers.choose(alt, context)
        if (altChoice && (!choice || altChoice.score > choice.score)) choice = altChoice
      }
    }
    // 只有情绪标签对得上、或上下文确实有重合时才发图；否则戳回去
    const stickerFits = Boolean(choice && choice.score >= 0.95 && (choice.moodMatch || choice.contextScore >= 0.18))
    const preferSticker = stickerFits && (playful >= 0.42 || mood !== '日常' || choice.contextScore >= 0.35)
    const mode = preferSticker ? 'sticker' : canPoke ? 'poke' : stickerFits ? 'sticker' : 'none'

    if (mode === 'sticker') {
      try {
        const item = await stickers.pick(choice?.item?.mood ?? mood, context, { minScore: 0.95 })
        if (item) {
          const messageId = groupId
            ? await snow.bridge.sendGroup(groupId, '', item.file)
            : await snow.bridge.sendPrivate(userId, '', item.file)
          await appendSnowLog({
            at: Date.now(),
            kind: 'poke-sticker',
            groupId: groupId || '',
            userId,
            gist: item.gist,
            messageId,
          })
          return
        }
      } catch (error) {
        await appendSnowLog({ at: Date.now(), kind: 'poke-sticker-error', groupId, userId, error: String(error?.message ?? error).slice(0, 120) })
      }
    }

    if (!canPoke) return
    try {
      await snow.bridge.call('send_poke', {
        group_id: Number(groupId) || undefined,
        user_id: Number(userId),
      })
      await appendSnowLog({ at: Date.now(), kind: 'poke-out', groupId, userId, group: Boolean(groupId) })
    } catch (error) {
      await appendSnowLog({ at: Date.now(), kind: 'poke-error', message: String(error?.message ?? error).slice(0, 120) })
    }
  }

  /** 让"她"看一眼这张图：只写进感知，不产生回复。 */
  async function perceiveImage(message) {
    if (!settings.vision.enabled || !message.images?.length) return
    const hour = new Date().getHours()
    if (visionHour.hour !== hour) visionHour = { hour, count: 0 }
    if (visionHour.count >= settings.vision.maxPerHour) return
    if (!vision) return
    const url = message.images[0]
    try {
      visionHour.count += 1
      let probe = null
      try {
        probe = await vision.describe(url, {
          prompt:
            '只输出 JSON：{"kind":"sticker 或 photo","gist":"这张图在表达什么，20 字内","mood":"笑|无语|安慰|生气|可爱|日常","text":"图上的字，最多10字"}',
          maxTokens: 1400,
        })
      } catch {
        // 模型没给 JSON 也不要紧：退回纯描述，当作普通图片
        probe = await vision.describe(url)
      }
      let info = null
      try {
        const raw = String(probe.text ?? '')
        info = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
      } catch {
        info = null
      }
      const gist = info?.gist ? String(info.gist).slice(0, 30) : String(probe?.text ?? '看不清').slice(0, 40)
      if (info?.kind === 'sticker' && probe.buffer) {
        const saved = await stickers
          .add({ buffer: probe.buffer, type: probe.type, gist, mood: String(info.mood ?? '日常').slice(0, 4), text: String(info.text ?? '') })
          .catch(() => null)
        if (saved && !saved.dup) {
          funnel.record({ kind: 'sticker', group: funnel.get(message.groupId)?.name ?? '', text: gist })
        }
      }
      const line = `${message.senderName ?? '群里有人'}发来一张图：${gist}`
      brain.perceiveSense({ channel: 'vision', text: line, intensity: 0.6 })
      funnel.record({ kind: 'vision', group: funnel.get(message.groupId)?.name ?? '', text: line.slice(0, 60) })
      await appendSnowLog({ kind: 'vision', at: Date.now(), cached: probe.cached, text: gist.slice(0, 120) })
    } catch (error) {
      await appendSnowLog({ kind: 'vision-error', at: Date.now(), message: String(error?.message ?? error).slice(0, 120) })
    }
  }

  /** 自动打一局：保守打法，只做"看商店 / 买便宜卡 / 升级 / 等"，不 D 牌不站位。 */
  async function runAuto() {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    // 一开始就把游戏钉在最上层：否则 DSH 窗口会盖住它，点击全打在聊天窗口上
    const winName = settings.game.window ?? 'TFT'
    // 固定摆位：窗口化 1920×1080 落在左上角，之后所有裁剪与点击共用这个矩形
    const place = settings.game.place ?? { x: 0, y: 0, w: 1920, h: 1080 }
    await inputAgent
      .request('/place', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ match: winName, ...place }) })
      .catch(() => null)
    await inputAgent
      .request('/topmost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ match: winName, on: true }) })
      .catch(() => null)
    while (auto.running) {
      auto.step += 1
      try {
        await inputAgent.focus(settings.game.window ?? 'TFT').catch(() => null)
        await sleep(300)
        // 先拍一张缩略图算哈希：画面没变就不浪费一次视觉调用
        const thumb = path.join(dataDir, 'screens', 'thumb.jpg')
        await mkdir(path.dirname(thumb), { recursive: true })
        await inputAgent.shot(thumb, { maxWidth: 320, format: 'jpeg' })
        const thumbHash = createHash('md5').update(await readFile(thumb)).digest('hex')
        if (thumbHash === auto.lastHash) {
          auto.sameCount = (auto.sameCount ?? 0) + 1
          // 画面没变化说明刚才那一下没生效（钱不够/位置不对）：
          // 前两次只等，第三次强制走一次视觉，避免死循环。
          if (auto.sameCount < 3) {
            auto.step += 1
            await sleep(350)
            continue
          }
          auto.sameCount = 0
        } else {
          auto.sameCount = 0
        }
        auto.lastHash = thumbHash
        const file = path.join(dataDir, 'screens', `auto-${Date.now()}.jpg`)
        const winRect = (await inputAgent.rect(settings.game.window ?? 'TFT')) ?? null
        // 金币/等级/血量在底部 HUD：单独裁一条窄带问，准确率比整屏高得多
        let hud = null
        if (winRect) {
          try {
            const hudFile = path.join(dataDir, 'screens', 'hud.jpg')
            const hudRect = {
              x: Math.round(winRect.x + winRect.w * 0.12),
              y: Math.round(winRect.y + winRect.h * 0.80),
              w: Math.round(winRect.w * 0.70),
              h: Math.round(winRect.h * 0.18),
            }
            await inputAgent.shot(hudFile, { maxWidth: 900, format: 'jpeg', rect: hudRect })
            const hud64 = (await readFile(hudFile)).toString('base64')
            const hudSeen = await vision.describe(`data:image/jpeg;base64,${hud64}`, {
              prompt: '这是云顶之弈底部状态栏。只输出 JSON：{"gold":0,"level":0,"health":0}。gold 是金币数字，level 是等级，health 是血量（没有就 null）。只输出数字，不要解释。',
              maxTokens: 220,
            })
            const rawHud = String(hudSeen.text ?? '')
            hud = JSON.parse(rawHud.slice(rawHud.indexOf('{'), rawHud.lastIndexOf('}') + 1))
          } catch {
            hud = null
          }
        }
        await inputAgent.shot(file, { maxWidth: 1024, format: 'jpeg', rect: winRect })
        const size = await inputAgent.size()
        const base64 = (await readFile(file)).toString('base64')
        const ask = '只输出 JSON：{"scene":"shop 或 augment 或 combat 或 carousel 或 other","stage":"3-2","level":7,"health":60,"gold":0,"bench":0,"augments":[[0.35,0.45],[0.5,0.45],[0.65,0.45]],"cards":[{"name":"名字","cost":1,"x":0.3,"y":0.94}]}。scene 里 augment 表示"三选一强化符文"界面；augments 是三个选项的中心坐标（0~1）；cards 只在底部商店出现时给；cost 是卡的金币价格。'
        // 视觉调用会被限流（429）：等一会儿重试一次，别让一步失败拖垮整局
        let seen = null
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            seen = await vision.describe(`data:image/jpeg;base64,${base64}`, { prompt: ask, maxTokens: 1400 })
            break
          } catch (error) {
            const message = String(error?.message ?? error)
            if (attempt === 0 && /429|concurrency|rate/i.test(message)) {
              auto.log.push({ at: Date.now(), step: auto.step, retry: message.slice(0, 60) })
              await new Promise((resolve) => setTimeout(resolve, 2500))
              continue
            }
            throw error
          }
        }
        let info = null
        try {
          const raw = String(seen.text ?? '')
          info = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
        } catch {
          info = null
        }
        // 模型有时回中文（商店/强化/战斗），统一归一化，否则永远认不出商店
        const rawScene = String(info?.scene ?? '').toLowerCase()
        let scene = 'other'
        if (/shop|商店|买牌/.test(rawScene)) scene = 'shop'
        else if (/augment|强化|海克斯/.test(rawScene)) scene = 'augment'
        else if (/combat|战斗|对局/.test(rawScene)) scene = 'combat'
        else if (/carousel|选秀|转盘/.test(rawScene)) scene = 'carousel'
        // 兜底：底部有 5 张卡就是商店，不管模型怎么叫
        if (scene === 'other' && Array.isArray(info?.cards) && info.cards.filter((card) => Number.isFinite(Number(card?.x))).length >= 3) scene = 'shop'
        // 只有商店/战斗画面上的数字才可信；加载画面模型会编数
        const reliable = scene === 'shop' || scene === 'combat'
        // 优先用 HUD 窄带读出来的数字，读不到才退回整屏结果
        const hudGold = Number(hud?.gold)
        const gold = reliable ? (Number.isFinite(hudGold) && hudGold >= 0 ? hudGold : Number(info?.gold ?? 0)) : 0
        const level = reliable ? Number(hud?.level ?? info?.level ?? 0) || 1 : 0
        const health = reliable ? Number(hud?.health ?? info?.health ?? 100) || 100 : 0
        const stage = String(info?.stage ?? '')
        const bench = Number(info?.bench ?? 0) || 0
        const cards = (Array.isArray(info?.cards) ? info.cards : [])
          .filter((card) => Number.isFinite(Number(card?.x)))
          .map((card) => ({ name: String(card?.name ?? ''), x: Math.round(Number(card.x) * size.width), y: Math.round(Number(card.y) * size.height) }))
        auto.cards = cards
        auto.lastPlan = scene === 'shop' ? 'shop' : 'other'
        if (scene === 'augment') {
          const options = (Array.isArray(info?.augments) ? info.augments : []).filter((pair) => Number.isFinite(Number(pair?.[0])))
          const pick = options[Math.floor(options.length / 2)] ?? [0.5, 0.45]
          const ax = Math.round(Number(pick[0]) * size.width)
          const ay = Math.round(Number(pick[1]) * size.height)
          await inputAgent.focus(settings.game.window ?? 'TFT').catch(() => null)
          await wait(150)
          await inputAgent.click(ax, ay)
          auto.log.push({ at: Date.now(), step: auto.step, scene, augment: ax + ',' + ay, count: options.length })
          await sleep(1200)
        } else if (scene === 'shop' && cards.length >= 3) {
          // 决策层：留钱 / 升级 / 买牌 / 残血 D 牌
          const boosted = cards.map((card) => ({ ...card, value: (Number(card.cost ?? 1) || 1) + traitBonus(card.name, auto.traits ?? []) }))
          const plan = decideTft({ stage: Number(stage.split('-')[0]) || 2, level, gold, health, shop: boosted, bench })
          auto.log.push({ at: Date.now(), step: auto.step, scene, gold, level, health, stage, cards: cards.length, plan: plan.reason })
          for (const action of plan.actions.slice(0, 6)) {
            if ((action.type === 'place' || action.type === 'deploy') && settings.game.layout?.bench) {
              const from = settings.game.layout.bench[action.benchSlot ?? 0]
              if (from) {
                // 选中 + W：比拖拽快一个量级
                await inputAgent.click(from[0], from[1])
                await sleep(60)
                await inputAgent.key('w')
                await sleep(90)
              }
            } else if (action.type === 'sell' && settings.game.layout?.bench) {
              const from = settings.game.layout.bench[action.benchSlot ?? 0]
              if (from) {
                await inputAgent.click(from[0], from[1])
                await sleep(60)
                await inputAgent.key('e')
                await sleep(90)
              }
            } else if (action.type === 'equip' && settings.game.layout?.items && settings.game.layout?.board) {
              const from = settings.game.layout.items[action.itemSlot ?? 0]
              const to = settings.game.layout.board[action.row ?? 0]?.[action.col ?? 3]
              if (from && to) await inputAgent.drag(from[0], from[1], to[0], to[1], 220)
            } else if (action.type === 'pickup' && settings.game.layout?.center) {
              const point = settings.game.layout.center
              await inputAgent.click(point[0], point[1])
            }
            if (!auto.running) break
            if (action.type === 'buy' && cards[action.slot]) {
              const card = cards[action.slot]
              const x = Math.round(Number(card.x) * size.width)
              const y = Math.round(Number(card.y) * size.height)
              await inputAgent.click(x, y)
              auto.bought += 1
              await appendSnowLog({ at: Date.now(), kind: 'auto-buy', name: String(card.name ?? ''), x, y, gold }).catch(() => {})
              await sleep(160)
            } else if (action.type === 'level') {
              // F：买经验
              for (let index = 0; index < Math.min(2, action.times ?? 1); index += 1) {
                await inputAgent.key('f')
                await sleep(120)
              }
            } else if (action.type === 'roll') {
              // D：刷新商店
              for (let index = 0; index < Math.min(3, action.times ?? 1); index += 1) {
                await inputAgent.key('d')
                await sleep(120)
              }
            } else if (action.type === 'reposition' && settings.game.layout?.board) {
              const from = settings.game.layout.board[action.fromRow]?.[action.fromCol]
              const to = settings.game.layout.board[action.row]?.[action.col]
              if (from && to) {
                await inputAgent.drag(from[0], from[1], to[0], to[1], 180)
                await appendSnowLog({ at: Date.now(), kind: 'auto-move', name: action.name, role: action.role, row: action.row, col: action.col }).catch(() => {})
                await sleep(150)
              }
            }
          }
          // 上人 + 捡球：只在商店阶段看一次场面，省视觉调用
          if (auto.step % 2 === 0 && settings.game.layout?.bench && settings.game.layout?.board) {
            try {
              const boardFile = path.join(dataDir, 'screens', `board-${Date.now()}.jpg`)
              await inputAgent.shot(boardFile, { maxWidth: 1024, format: 'jpeg' })
              const board64 = (await readFile(boardFile)).toString('base64')
              const boardAsk = '只输出 JSON：{"benchFilled":[0],"boardUnits":[{"name":"英雄名","row":1,"col":3}],"traits":[{"name":"羁绊名","count":2}],"orbs":[[0.5,0.6]]}。benchFilled 是备战席有棋子的下标（0~8）；boardUnits 是我方棋盘上的棋子（row 0~3 从上到下，col 0~6 从左到右）；traits 是左侧羁绊面板的条目；orbs 是地上掉落球的相对坐标（0~1）。没有就给空数组。'
              const seenBoard = await vision.describe(`data:image/jpeg;base64,${board64}`, { prompt: boardAsk, maxTokens: 1400 })
              const rawBoard = String(seenBoard.text ?? '')
              const info2 = JSON.parse(rawBoard.slice(rawBoard.indexOf('{'), rawBoard.lastIndexOf('}') + 1))
              const layout = settings.game.layout
              for (const action of planDeploys({ benchFilled: info2.benchFilled ?? [], max: 2 })) {
                const from = layout.bench[action.benchSlot]
                const to = layout.board[action.row]?.[action.col]
                if (from && to) {
                  await inputAgent.drag(from[0], from[1], to[0], to[1], 220)
                  await appendSnowLog({ at: Date.now(), kind: 'auto-place', from: action.benchSlot, row: action.row, col: action.col }).catch(() => {})
                  await sleep(220)
                }
              }
              // 站位：前排顶前、后排退后
              for (const action of planPositioning({ units: info2.boardUnits ?? [], max: 3 })) {
                const from = layout.board[action.fromRow]?.[action.fromCol]
                const to = layout.board[action.row]?.[action.col]
                if (from && to) {
                  await inputAgent.drag(from[0], from[1], to[0], to[1], 180)
                  await appendSnowLog({ at: Date.now(), kind: 'auto-move', name: action.name, role: action.role, row: action.row, col: action.col }).catch(() => {})
                  await sleep(150)
                }
              }
              // 羁绊：先记录，暂不参与决策
              if (Array.isArray(info2.traits) && info2.traits.length) {
                auto.traits = info2.traits.slice(0, 8).map((trait) => ({ name: String(trait?.name ?? ''), count: Number(trait?.count ?? 0) }))
                auto.log.push({ at: Date.now(), step: auto.step, traits: auto.traits.map((trait) => `${trait.name}${trait.count}`).join(' ') })
              }
              for (const orb of planPickups({ orbs: info2.orbs ?? [] })) {
                await inputAgent.click(Math.round(orb.x * size.width), Math.round(orb.y * size.height))
                await appendSnowLog({ at: Date.now(), kind: 'auto-pickup', x: orb.x, y: orb.y }).catch(() => {})
                await sleep(180)
              }
            } catch (error) {
              auto.log.push({ at: Date.now(), step: auto.step, boardError: String(error?.message ?? error).slice(0, 80) })
            }
          }
          await sleep(250)
        } else if (scene === 'combat' || scene === 'carousel') {
          auto.log.push({ at: Date.now(), step: auto.step, scene, gold, level, health, stage })
          await sleep(2000)
        } else {
          auto.log.push({ at: Date.now(), step: auto.step, scene, gold, level, health, stage })
          await sleep(1500)
        }
        await sleep(1200)
      } catch (error) {
        auto.lastError = String(error?.message ?? error).slice(0, 160)
        auto.log.push({ at: Date.now(), step: auto.step, error: auto.lastError })
        await sleep(4000)
      }
      if (auto.step > 400) auto.running = false
    }
  }

  async function handleSnowEvent(event) {
    if (!snow.cfg) return
    // 戳一戳是 notice，不是 message，先在这里接住
    if (event?.post_type === 'notice' && event?.notice_type === 'notify' && event?.sub_type === 'poke') {
      if (snow.bridge) snow.bridge.stats.messages += 1
      await appendSnowLog({ kind: 'poke', at: Date.now(), userId: event.user_id, target: event.target_id, groupId: event.group_id })
      await perceivePoke(event)
      return
    }
    const message = SnowlumaBridge.normalize(event, snow.cfg.selfId)
    if (!message) return
    if (snow.bridge) snow.bridge.stats.messages += 1
    snow.lastEvent = { ...message, at: Date.now() }
    await appendSnowLog({ kind: 'in', ...message })
    if (message.kind === 'private') {
      // 测试期只认群，不理私聊
      if (!settings.snowluma.allowPrivate) return
      await respondPrivate(message)
      return
    }
    const allowed = (settings.snowluma.allowGroups ?? []).map(String)
    if (allowed.length && !allowed.includes(String(message.groupId))) return
    if (!funnel.get(message.groupId)) {
      funnel.addGroup({ id: message.groupId, name: `群 ${message.groupId}`, layer: 'muted' })
    }
    const decision = funnel.ingest(message, { now: Date.now(), energy: brain?.state.energy ?? 60 })
    funnel.record({
      kind: 'ingest',
      group: funnel.get(message.groupId)?.name ?? '',
      sender: message.senderName,
      text: message.text,
      decision: decision.decision,
      reason: decision.reason,
      anchors: (decision.anchors ?? []).map((a) => a.label),
    })
    if (decision.debounce?.buffered) {
      scheduleSnowFlush(`${message.groupId}:${message.senderId}`, decision.debounce.dueAt)
    } else if (decision.debounce?.force || decision.toThalamus) {
      await snowFlush(`${message.groupId}:${message.senderId}`)
    }
  }

  /* ------------------------------------------------------------------ */
  /* HTTP 路由                                                           */
  /* ------------------------------------------------------------------ */

  const routes = [
    {
      path: '/ui',
      methods: ['GET'],
      handler: async () =>
        new Response(renderUiHtml(), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        }),
    },
    {
      path: '/client-log',
      methods: ['POST'],
      handler: async (request) => {
        const body = await readBody(request)
        try {
          await mkdir(dataDir, { recursive: true })
          await appendFile(
            path.join(dataDir, 'client-log.jsonl'),
            `${JSON.stringify({ at: Date.now(), ...body })}\n`,
            'utf8',
          )
        } catch {
          /* 记录失败不影响前端 */
        }
        return json({ ok: true })
      },
    },
    {
      path: '/state',
      methods: ['GET'],
      handler: async () => {
        // 面板可能在诞生的第一秒就打开：先等大脑就绪，别把 null 丢给前端
        await boot()
        return json(snapshot())
      },
    },
    {
      path: '/usage',
      methods: ['GET'],
      handler: async () => {
        await boot()
        return json(usage.snapshot())
      },
    },
    {
      path: '/usage/reset',
      methods: ['POST'],
      handler: async () => {
        await boot()
        return json({ ok: true, usage: usage.reset() })
      },
    },
    {
      path: '/talk',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        const body = await readBody(request)
        const text = String(body.text ?? '').trim()
        if (!text) return fail('说点什么', 400)
        refreshLlm()
        brain.sync()
        const target = body.entityId ?? settings.userId
        const name = body.entityName || settings.userName
        if (target !== settings.userId) {
          brain.social.ensure(target, name)
        }
        const result = await brain.perceive({
          entityId: target,
          entityName: name,
          text,
          channel: body.channel === 'group' ? 'group' : 'private',
          atMe: Boolean(body.atMe),
          priority: Number(body.priority ?? 0),
        })
        schedulePersist()
        return json({ result, snapshot: snapshot() })
      },
    },
    {
      path: '/tick',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        const body = await readBody(request)
        const seconds = Math.max(0, Math.min(7 * 86400, Number(body.seconds ?? 60)))
        brain.sync()
        brain.advance(seconds * 1000)
        schedulePersist()
        return json({ ok: true, advancedSec: seconds, snapshot: snapshot() })
      },
    },
    {
      path: '/sleep',
      methods: ['POST'],
      handler: async () => {
        await boot()
        brain.sync()
        const report = brain.sleep()
        schedulePersist()
        return json({ report, snapshot: snapshot() })
      },
    },
    {
      path: '/bci',
      methods: ['GET'],
      handler: async () => {
        await boot()
        return json({
          ...bci.snapshot(),
          note: '只读感知默认开启；actuation 需要在 core/bci-hub 的 policy 里显式打开，并逐次确认',
        })
      },
    },
    {
      path: '/bci/sense',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        const body = await readBody(request)
        const id = String(body.adapter ?? body.id ?? '')
        if (!id) return fail('缺少 adapter', 400)
        const result = await bci.sense(id, body.payload ?? body)
        return json(result)
      },
    },
    {
      path: '/outreach/preview',
      methods: ['POST'],
      handler: async () => {
        await boot()
        brain.sync()
        return json({
          proposal: brain.outreachProposal({ settings: settings.outreach }),
          enabled: settings.outreach.enabled,
          requires: { sendEnabled: settings.snowluma.sendEnabled, allowPrivate: settings.snowluma.allowPrivate },
        })
      },
    },
    {
      path: '/self/review',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        brain.sync()
        const body = await readBody(request)
        const result = await brain.reviewSelf({ reason: 'manual', force: body.force !== false })
        schedulePersist(200)
        return json({ result, snapshot: snapshot() })
      },
    },
    {
      path: '/recall',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        const body = await readBody(request)
        const result = brain.recall(String(body.memoryId ?? ''))
        schedulePersist()
        return json({ result, snapshot: snapshot() })
      },
    },
    {
      path: '/memory',
      methods: ['GET'],
      handler: async (request) => {
        await boot()
        brain.sync()
        const url = new URL(request.url)
        const tier = url.searchParams.get('tier') ?? 'all'
        const limit = Math.min(120, Number(url.searchParams.get('limit') ?? 40))
        return json({
          items: brain.memory.list(brain.simMs, { tier, limit }),
          stats: brain.memory.stats(brain.simMs),
          dreams: brain.memory.dreams.slice(-12),
          semantics: brain.memory.semantics.slice(-12),
        })
      },
    },
    {
      path: '/sandbox/run',
      methods: ['POST'],
      handler: async (request) => {
        const body = await readBody(request)
        const bio = await loadBiography()
        const report = await runSandbox({ biography: bio, only: body.only ?? null })
        gate = { ...report, checkedAt: Date.now() }
        schedulePersist()
        return json({ gate })
      },
    },
    {
      path: '/group/state',
      methods: ['GET'],
      handler: async () => {
        await boot()
        brain.sync()
        return json({
          gate,
          unlocked: phase2Open(),
          group: funnel.snapshot(),
          roster: DEMO_MEMBERS,
          energy: Math.round(brain.state.energy),
          cortisol: Number(brain.state.cortisol.toFixed(2)),
        })
      },
    },
    {
      path: '/group/feed',
      methods: ['POST'],
      handler: async (request) => {
        if (!phase2Open()) return phase2Locked()
        const body = await readBody(request)
        const outcome = await feedGroup(body)
        if (outcome?.locked) return phase2Locked()
        if (outcome?.error) return fail(outcome.error, 400)
        return json(outcome)
      },
    },
    {
      path: '/group/focus',
      methods: ['POST'],
      handler: async (request) => {
        if (!phase2Open()) return phase2Locked()
        await boot()
        const body = await readBody(request)
        const change = funnel.focus(String(body.groupId ?? ''), Date.now())
        if (change) {
          funnel.record({ kind: 'focus', group: funnel.get(body.groupId)?.name ?? '', previous: change.previous })
        }
        schedulePersist()
        return json({ change, group: funnel.snapshot() })
      },
    },
    {
      path: '/group/layer',
      methods: ['POST'],
      handler: async (request) => {
        if (!phase2Open()) return phase2Locked()
        await boot()
        const body = await readBody(request)
        const layer = String(body.layer ?? '')
        if (!['foveal', 'peripheral', 'muted'].includes(layer)) return fail('layer 只能是 foveal / peripheral / muted', 400)
        const change = funnel.setLayer(String(body.groupId ?? ''), layer, Date.now())
        if (!change) return fail('unknown-group', 404)
        funnel.tick(Date.now())
        funnel.record({ kind: 'layer', group: funnel.get(body.groupId)?.name ?? '', reason: layer })
        schedulePersist()
        return json({ change, group: funnel.snapshot() })
      },
    },
    {
      path: '/group/reset',
      methods: ['POST'],
      handler: async () => {
        if (!phase2Open()) return phase2Locked()
        await boot()
        funnel = new GroupAttentionFunnel({
          social: brain.social,
          interests: brain.interests,
          userName: brain.name,
        })
        for (const group of defaultGroups()) funnel.addGroup(group)
        funnel.focus('g_class', Date.now())
        return json({ group: funnel.snapshot() })
      },
    },
    {
      path: '/forget',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        const body = await readBody(request)
        brain.pending = []
        brain.state.lastStressor = null
        for (const relation of brain.social.snapshot()) {
          const row = brain.social.get(relation.id)
          if (row) row.recent = []
        }
        if (body?.mood !== false) {
          brain.state.moodBaseline = Math.max(-0.3, Math.min(0.3, brain.state.moodBaseline + 0.15))
          brain.state.cortisol = Math.max(0.2, brain.state.cortisol * 0.6)
        }
        schedulePersist(200)
        return json({ ok: true, snapshot: snapshot() })
      },
    },
    {
      path: '/clock',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        await boot()
        if (request.method === 'POST') {
          const body = await readBody(request)
          const mode = String(body.mode ?? 'shift')
          const driftMs = brain.simMs - Date.now()
          if (mode === 'shift') {
            brain.shiftTime(-driftMs)
          } else {
            brain.simMs = Date.now()
            brain.lastRealMs = Date.now()
            brain.lastExternalAt = brain.simMs
          }
          brain.sync()
          schedulePersist(200)
          await appendSnowLog({ at: Date.now(), kind: 'clock', mode, driftMs })
        }
        const snap = brain.snapshot()
        return json({ clock: snap.clock, now: Date.now() })
      },
    },
    {
      path: '/tuning',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        await boot()
        if (request.method === 'POST') {
          const body = await readBody(request)
          if (body.vision && typeof body.vision === 'object') {
          if (typeof body.vision.enabled === 'boolean') settings.vision.enabled = body.vision.enabled
          if (typeof body.vision.model === 'string' && body.vision.model.trim()) {
            const model = body.vision.model.trim()
            if (!model.includes('/')) return fail('视觉模型名也要写成 provider/model', 400)
            settings.vision.model = model
          }
          if (Number.isFinite(Number(body.vision.maxPerHour))) {
            settings.vision.maxPerHour = Math.max(1, Math.min(200, Number(body.vision.maxPerHour)))
          }
          if (vision) vision = createVision({ baseURL: settings.llm.baseURL, apiKey: settings.llm.apiKey, model: settings.vision.model, onUsage: visionUsage })
        }
        if (body.tuning && typeof body.tuning === 'object') {
            if (Number.isFinite(Number(body.tuning.memoryStrength))) {
              settings.tuning.memoryStrength = Math.max(0, Math.min(1, Number(body.tuning.memoryStrength)))
            }
            if (Number.isFinite(Number(body.tuning.talkativeness))) {
              settings.tuning.talkativeness = Math.max(0, Math.min(1, Number(body.tuning.talkativeness)))
            }
          }
          brain.applyTuning(settings.tuning)
          try {
            await mkdir(dataDir, { recursive: true })
            await writeFile(settingsFile, JSON.stringify({
              useLlm: settings.useLlm,
              snowluma: {
                enabled: settings.snowluma.enabled,
                sendEnabled: settings.snowluma.sendEnabled,
                allowGroups: settings.snowluma.allowGroups,
                allowPrivate: settings.snowluma.allowPrivate,
                pokeReact: settings.snowluma.pokeReact,
                pokeReply: settings.snowluma.pokeReply,
                pokeAnyGroup: settings.snowluma.pokeAnyGroup,
                pokeBack: settings.snowluma.pokeBack,
                recallEnabled: settings.snowluma.recallEnabled === true,
                stickers: settings.snowluma.stickers !== false,
                selfId: settings.snowluma.selfId ?? '',
                maxReplyChars: settings.snowluma.maxReplyChars,
                httpBase: settings.snowluma.httpBase,
                httpToken: settings.snowluma.httpToken,
                wsUrl: settings.snowluma.wsUrl,
                wsToken: settings.snowluma.wsToken,
                wsMode: settings.snowluma.wsMode,
                wsServer: settings.snowluma.wsServer,
              },
              llm: settings.llm,
              tuning: settings.tuning,
              growth: settings.growth,
              outreach: settings.outreach,
              vision: settings.vision,
            }), 'utf8')
          } catch (error) {
            console.warn('[bibao] tuning save failed:', error?.message ?? error)
          }
          await appendSnowLog({ at: Date.now(), kind: 'tuning-in', tuning: settings.tuning })
        }
        return json({ tuning: brain.tuning, saved: settings.tuning })
      },
    },
    {
      path: '/senses',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        await boot()
        if (request.method === 'GET') {
          return json({
            channels: brain.senses.snapshot(),
            recent: (brain.inner ?? [])
              .filter((item) => item.kind === 'sensor')
              .slice(-12)
              .map((item) => ({ at: item.at, source: item.source, thought: item.thought })),
          })
        }
        const body = await readBody(request)
        if (body.toggle && typeof body.channel === 'string') {
          const channel = brain.senses.setEnabled(body.channel, body.enabled !== false)
          schedulePersist()
          return json({ ok: Boolean(channel), channels: brain.senses.snapshot() })
        }
        const result = await brain.perceiveSense({
          channel: String(body.channel ?? 'vision'),
          text: String(body.text ?? ''),
          intensity: Number(body.intensity ?? 0.6),
        })
        schedulePersist()
        return json({ result, snapshot: snapshot() })
      },
    },
    {
      path: '/facts',
      methods: ['GET'],
      handler: async () => {
        await boot()
        return json({
          facts: store?.listFacts(brain.simMs, 30) ?? [],
          archived: store?.archivedCount() ?? 0,
          archivedEpisodes: store?.archivedEpisodes(20) ?? [],
        })
      },
    },
    {
      path: '/biography/generate',
      methods: ['POST'],
      handler: async (request) => {
        const body = await readBody(request)
        const seed = body.seed ?? {}
        const llms = llmNow()
        const warnings = []
        let persona = null
        let source = 'template'
        if (body.useAi !== false && llms.broca?.llm && llms.broca.provider && llms.broca.model) {
          const prompt = buildGenerationPrompt(seed)
          const attempt = async (extra) => {
            let raw = ''
            const stream = llms.broca.llm.stream({
              provider: llms.broca.provider,
              model: llms.broca.model,
              system: prompt.system + (extra ?? ''),
              messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
              maxTokens: 6000,
              temperature: 0.85,
            })
            for await (const chunk of stream) if (chunk.type === 'text-delta') raw += chunk.text
            const parsed = parsePersonaJson(raw)
            if (!parsed) console.warn('[bibao] persona raw:', raw.length, JSON.stringify(raw.slice(0, 160)))
            return parsed ? validatePersona(parsed, { seed }) : { ok: false, errors: ['模型没有给出可解析的 JSON', 'len=' + raw.length] }
          }
          try {
            let checked = await attempt('')
            if (!checked.ok) checked = await attempt('\n重要：不要输出任何思考过程或说明文字，第一个字符必须是 {，最后一个字符必须是 }。')
            if (checked.ok) {
              persona = checked.persona
              source = 'ai'
            } else {
              warnings.push(...checked.errors.slice(0, 3))
            }
          } catch (error) {
            warnings.push(`模型调用失败：${String(error?.message ?? error).slice(0, 80)}`)
          }
        } else {
          warnings.push('没有可用的模型，用模板生成了一份可编辑的草稿')
        }
        if (!persona) {
          const fallback = templatePersona(seed)
          if (!fallback.ok) return fail(`生成失败：${fallback.errors.join('；')}`, 500)
          persona = fallback.persona
          source = 'template'
        }
        personaDraft = persona
        personaDraftId = `draft_${Date.now().toString(36)}`
        return json({ source, warnings, persona, draftId: personaDraftId, prompt: buildGenerationPrompt(seed) })
      },
    },
    {
      path: '/biography/apply',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        const body = await readBody(request)
        const incoming =
          body.draftId && body.draftId === personaDraftId && personaDraft ? personaDraft : body.persona ?? {}
        const checked = validatePersona(incoming, { seed: incoming?.seed ?? {} })
        if (!checked.ok) return fail(`档案不合法：${checked.errors.slice(0, 3).join('；')}`, 400)
        const persona = checked.persona
        const mode = body.mode === 'rebuild' ? 'rebuild' : 'merge'
        const rev = new Date().toISOString().replace(/[:.]/g, '-')
        try {
          await mkdir(dataDir, { recursive: true })
          await copyFile(path.join(dataDir, 'biography.json'), path.join(dataDir, `biography.rev-${rev}.json`))
        } catch {
          /* 还没有旧档就不用备份 */
        }
        const saved = { ...persona }
        delete saved.seed
        await mkdir(dataDir, { recursive: true })
        let result = { mode, rev }
        if (mode === 'rebuild') {
          // 重建才改档案：整颗大脑按新人生重来
          await writeFile(path.join(dataDir, 'biography.json'), JSON.stringify(saved, null, 2), 'utf8')
          biography = saved
          rebuildBrain(saved)
          result = { ...result, rebuilt: true }
        } else {
          // 合并只进记忆，不动档案：老经历还在，新的补进去
          result = { ...result, ...brain.injectBiography(saved) }
          schedulePersist(200)
        }
        return json({ ok: true, result, snapshot: snapshot() })
      },
    },
    {
      path: '/biography/revisions',
      methods: ['GET'],
      handler: async () => {
        try {
          const names = await readdir(dataDir)
          return json({ revisions: names.filter((name) => name.startsWith('biography.rev-')).sort().reverse().slice(0, 20) })
        } catch {
          return json({ revisions: [] })
        }
      },
    },

    {
      path: '/stickers',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        await boot()
        if (!stickers) return json({ items: [], stats: { count: 0, used: 0 } })
        if (request.method === 'POST') {
          const body = await readBody(request)
          const update = body.update && typeof body.update === 'object' ? body.update : body.id ? body : null
          if (update?.id) {
            const item = await stickers.update(String(update.id), update)
            if (!item) return fail('没有这张', 404)
            await appendSnowLog({ at: Date.now(), kind: 'sticker-update', id: item.id, gist: item.gist, mood: item.mood })
            return json({ ok: true, item, items: await stickers.load(), stats: await stickers.stats() })
          } else if (body.remove) await stickers.remove(String(body.remove))
          else if (body.send) {
            const item = (await stickers.load()).find((row) => row.id === String(body.send))
            if (!item) return fail('没有这张', 404)
            const to = String(body.groupId ?? (settings.snowluma.allowGroups ?? [])[0] ?? '')
            if (!to || !snow.bridge) return fail('没有可发送的群或连接', 400)
            const id = await snow.bridge.sendGroup(to, '', item.file)
            await appendSnowLog({ at: Date.now(), kind: 'sticker-out', groupId: to, gist: item.gist, messageId: id })
            item.uses = (item.uses ?? 0) + 1
            return json({ ok: true, sent: id })
          } else if (body.use) {
            const item = await stickers.pick(String(body.mood ?? stickerMood()), String(body.context ?? ''))
            return json({ picked: item })
          }
        }
        return json({ items: await stickers.load(), stats: await stickers.stats() })
      },
    },
    {
      path: '/vision/test',
      methods: ['POST'],
      handler: async () => {
        await boot()
        if (!vision) return fail('视觉还没配置', 400)
        const png =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        try {
          const started = Date.now()
          const result = await vision.describe(png, { prompt: '用一句中文说出这张图的颜色。', maxTokens: 60 })
          return json({ ok: true, text: result.text, model: settings.vision.model, ms: Date.now() - started })
        } catch (error) {
          return fail(`失败：${String(error?.message ?? error).slice(0, 100)}`, 500)
        }
      },
    },
    {
      path: '/stickers/import',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        if (!stickers || !vision) return fail('视觉或收藏夹不可用', 400)
        const body = await readBody(request)
        const dataUrl = String(body.dataUrl ?? '')
        if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(dataUrl)) return fail('需要图片的 dataURL', 400)
        if (dataUrl.length > 4 * 1024 * 1024) return fail('图片太大（>3MB）', 413)
        try {
          let probe = null
          try {
            probe = await vision.describe(dataUrl, {
              prompt:
                '只输出 JSON：{"kind":"sticker 或 photo","gist":"这张图在表达什么，20 字内","mood":"笑|无语|安慰|生气|可爱|日常","text":"图上的字，最多10字"}',
              maxTokens: 1400,
            })
          } catch {
            probe = await vision.describe(dataUrl)
          }
          let info = null
          try {
            const raw = String(probe.text ?? '')
            info = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
          } catch {
            info = null
          }
          const gist = info?.gist ? String(info.gist).slice(0, 30) : String(probe?.text ?? '').slice(0, 30)
          const saved = await stickers.add({
            buffer: probe.buffer,
            type: probe.type,
            gist,
            mood: String(info?.mood ?? '日常').slice(0, 4),
            text: String(info?.text ?? ''),
          })
          return json({ ok: true, item: saved, gist, mood: info?.mood ?? '日常' })
        } catch (error) {
          return fail(`导入失败：${String(error?.message ?? error).slice(0, 80)}`, 500)
        }
      },
    },
    {
      path: '/stickers/file',
      methods: ['GET'],
      handler: async (request) => {
        const url = new URL(request.url)
        const id = String(url.searchParams.get('id') ?? '')
        if (!/^[a-f0-9]{6,16}$/.test(id)) return fail('bad id', 400)
        const item = (await stickers?.load())?.find((row) => row.id === id)
        if (!item) return fail('not found', 404)
        const bytes = await readFile(item.file)
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': item.ext === 'gif' ? 'image/gif' : item.ext === 'jpg' ? 'image/jpeg' : 'image/png', 'cache-control': 'max-age=86400' },
        })
      },
    },
    {
      path: '/game/equip',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        if (!settings.game.control) return fail('手还没解锁', 403)
        if (!inputAgent) inputAgent = new InputAgent()
        if (!(await inputAgent.ping())) return fail('手还没启动', 503)
        const body = await readBody(request)
        const layout = settings.game.layout ?? {}
        const itemSlots = Array.isArray(body.items) ? body.items : []
        const recommended = Array.isArray(body.recommended) ? body.recommended : []
        const pick = pickItemFor({ items: itemSlots.map((item) => ({ name: item?.name ?? '' })), recommended })
        if (!pick) return json({ ok: false, reason: '没有装备' })
        const from = layout.items?.[pick.slot]
        const to = layout.board?.[Number(body.row ?? 1)]?.[Number(body.col ?? 3)]
        if (!from || !to) return fail('还没校准装备栏或棋盘', 400)
        await inputAgent.focus(settings.game.window ?? 'TFT').catch(() => null)
        await wait(150)
        await inputAgent.drag(from[0], from[1], to[0], to[1], 220)
        await appendSnowLog({ at: Date.now(), kind: 'auto-equip', item: pick.name, row: body.row, col: body.col, reason: pick.reason }).catch(() => {})
        return json({ ok: true, equipped: pick.name, reason: pick.reason })
      },
    },
    {
      path: '/game/recommend',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        if (!vision) return fail('视觉模型没配置', 400)
        if (!inputAgent) inputAgent = new InputAgent()
        if (!(await inputAgent.ping())) return fail('手还没启动', 503)
        const body = await readBody(request)
        const row = Math.max(0, Math.min(3, Number(body.row ?? 1)))
        const col = Math.max(0, Math.min(6, Number(body.col ?? 3)))
        const cell = settings.game.layout?.board?.[row]?.[col]
        if (!cell) return fail('还没校准棋盘（调用 /game/calibrate）', 400)
        await inputAgent.focus(settings.game.window ?? 'TFT').catch(() => null)
        await wait(200)
        // 右键：弹推荐装备
        await inputAgent.click(cell[0], cell[1], 'r')
        await wait(700)
        const file = path.join(dataDir, 'screens', `rec-${Date.now()}.jpg`)
        await mkdir(path.dirname(file), { recursive: true })
        await inputAgent.shot(file, { maxWidth: 1024, format: 'jpeg' })
        const base64 = (await readFile(file)).toString('base64')
        const seen = await vision.describe(`data:image/jpeg;base64,${base64}`, {
          prompt: '这个弹窗里推荐的装备是哪几个？只输出装备名字，用逗号分隔，最多三个，不要解释，没有就说 无。',
          maxTokens: 120,
        })
        // 关掉弹窗
        await inputAgent.key('{ESC}')
        await wait(200)
        const names = String(seen.text ?? '')
          .split(/[，,\n、]/)
          .map((item) => item.replace(/[。.!！?？\s]/g, '').trim())
          .filter((item) => item && item !== '无')
          .slice(0, 3)
        return json({ ok: true, row, col, recommended: names, file })
      },
    },
    {
      path: '/game/calibrate',
      methods: ['POST'],
      handler: async () => {
        await boot()
        if (!inputAgent) inputAgent = new InputAgent()
        if (!(await inputAgent.ping())) return fail('手还没启动', 503)
        const list = (await inputAgent.request('/windows')).list ?? []
        const anchors = anchorsFromWindows(list, settings.game.window ?? 'TFT')
        if (!anchors) return fail('没找到游戏窗口（TFT）', 404)
        settings.game.layout = {
          rect: anchors.rect,
          shop: anchors.shop.map((point) => [point.x, point.y]),
          roll: [anchors.roll.x, anchors.roll.y],
          level: [anchors.level.x, anchors.level.y],
          bench: anchors.bench.map((point) => [point.x, point.y]),
          board: anchors.board.map((row) => row.map((point) => [point.x, point.y])),
          items: anchors.items.map((point) => [point.x, point.y]),
          center: [anchors.center.x, anchors.center.y],
        }
        schedulePersist(200)
        return json({ ok: true, layout: settings.game.layout })
      },
    },
    {
      path: '/game/hands',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        await boot()
        if (request.method === 'POST') {
          await ensureHands({ log: (...args) => void appendSnowLog({ at: Date.now(), kind: 'hands', line: args.join(' ') }) })
        }
        const alive = await handsAlive(1500)
        return json({ ok: true, alive, port: 8788, autoStart: settings.game.autoStart !== false })
      },
    },
    {
      path: '/game/auto',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        await boot()
        if (request.method === 'POST') {
          const body = await readBody(request)
          if (body.stop) {
            auto.running = false
            return json({ ok: true, running: false })
          }
          if (auto.running) return json({ ok: true, running: true, note: '已经在跑了' })
          settings.game.control = true
          if (!inputAgent) inputAgent = new InputAgent()
          if (!(await inputAgent.ping())) return fail('手还没启动：双击 bibao-brain/bin/start-hands.bat', 503)
          auto.running = true
          auto.startedAt = Date.now()
          auto.step = 0
          auto.bought = 0
          auto.log = []
          void runAuto().catch((error) => {
            auto.lastError = String(error?.message ?? error).slice(0, 160)
            auto.running = false
          })
          return json({ ok: true, running: true })
        }
        return json({ running: auto.running, step: auto.step, bought: auto.bought, lastError: auto.lastError, log: auto.log.slice(-20) })
      },
    },
    {
      path: '/game/shop',
      methods: ['POST'],
      handler: async () => {
        await boot()
        if (!vision) return fail('视觉模型没配置', 400)
        if (!inputAgent) inputAgent = new InputAgent()
        if (!(await inputAgent.ping())) return fail('手还没启动：双击 bibao-brain/bin/start-hands.bat', 503)
        const file = path.join(dataDir, 'screens', `shop-${Date.now()}.jpg`)
        await mkdir(path.dirname(file), { recursive: true })
        await inputAgent.shot(file, { maxWidth: 1024, format: 'jpeg' })
        const size = await inputAgent.size()
        const base64 = (await readFile(file)).toString('base64')
        const ask = '只输出一个 JSON，不要解释、不要 markdown：{"gold":0,"cards":[{"name":"名字","x":0.3,"y":0.94}]}。cards 是从左到右的商店卡，x/y 是相对整图的 0~1 小数；看不清名字写 ?。'
        const result = await vision.describe(`data:image/jpeg;base64,${base64}`, { prompt: ask, maxTokens: 500 })
        let parsed = null
        try {
          const raw = String(result.text ?? '')
          parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
        } catch {
          parsed = null
        }
        // 模型是相对"整张截图"给坐标的，所以乘屏幕尺寸
        const cards = (Array.isArray(parsed?.cards) ? parsed.cards : [])
          .map((card, index) => ({
            slot: index,
            name: String(card?.name ?? '').slice(0, 12),
            x: Math.round(Number(card?.x ?? 0) * size.width),
            y: Math.round(Number(card?.y ?? 0) * size.height),
          }))
          .filter((card) => card.x > 0 && card.y > 0)
        if (cards.length) {
          settings.game.layout = { ...(settings.game.layout ?? {}), shop: cards.map((card) => [card.x, card.y]) }
          schedulePersist(200)
        }
        return json({ ok: true, file, gold: Number(parsed?.gold ?? NaN), cards, raw: String(result.text ?? '').slice(0, 240) })
      },
    },
    {
      path: '/game/buy',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        if (!settings.game.control) return fail('手还没解锁：先在设置里打开「允许操作」', 403)
        if (!inputAgent) inputAgent = new InputAgent()
        if (!(await inputAgent.ping())) return fail('手还没启动：双击 bibao-brain/bin/start-hands.bat', 503)
        const body = await readBody(request)
        const slot = Math.max(0, Math.min(4, Number(body.slot ?? 0)))
        const point = settings.game.layout?.shop?.[slot]
        if (!point) return fail('还没有商店坐标，先调用 /game/shop', 400)
        // 钱不够就不动手
        if (body.force !== true) {
          const before = await fetch(`http://127.0.0.1:${consoleState.port}/api/bibao/game/shop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${consoleState.token}` },
            body: '{}',
          }).then((res) => res.json()).catch(() => null)
          const gold = Number(before?.gold ?? NaN)
          if (Number.isFinite(gold) && gold < Number(body.price ?? 3)) {
            return json({ ok: false, skipped: true, reason: `金币只有 ${gold}，不够买这张（需要 ${body.price ?? 3}）`, before })
          }
        }
        // 点之前先把游戏窗口拉到前台，否则点到的是压在上面的聊天窗口
        await inputAgent.focus(String(settings.game.window ?? 'TFT')).catch(() => null)
        await wait(400)
        await inputAgent.click(point[0], point[1])
        await wait(1200)
        const file = path.join(dataDir, 'screens', `buy-${Date.now()}.jpg`)
        await inputAgent.shot(file, { maxWidth: 1024, format: 'jpeg' })
        await appendSnowLog({ at: Date.now(), kind: 'game-buy', slot, x: point[0], y: point[1], file })
        return json({ ok: true, slot, file })
      },
    },
    {
      path: '/game/look',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        if (!vision) return fail('视觉模型没配置', 400)
        if (!inputAgent) inputAgent = new InputAgent()
        if (!(await inputAgent.ping())) return fail('手还没启动：双击 bibao-brain/bin/start-hands.bat', 503)
        const body = await readBody(request)
        const file = path.join(dataDir, 'screens', `look-${Date.now()}.jpg`)
        await mkdir(path.dirname(file), { recursive: true })
        await inputAgent.shot(file, { maxWidth: 1024, format: 'jpeg' })
        const size = await inputAgent.size()
        const base64 = (await readFile(file)).toString('base64')
        const ask = [
          '这是电脑屏幕截图，里面可能有《云顶之弈》或《金铲铲之战》。',
          '只输出一个 JSON，不要解释、不要 markdown：',
          '{"gold":0,"cards":[[0.2,0.94],[0.35,0.94]],"roll":[0.9,0.95]}',
          'cards 是从左到右五张商店卡的中心点，坐标是相对整张图的 0~1 小数；看不清就给空数组。',
        ].join('\n')
        const result = await vision.describe(`data:image/jpeg;base64,${base64}`, { prompt: ask, maxTokens: 2600 })
        let parsed = null
        try {
          const raw = String(result.text ?? '')
          parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
        } catch {
          parsed = null
        }
        // 再要一次"名字"：纯文本几十个字，不会截断，用来确认点的是不是想要的那张
        let names = []
        try {
          const named = await vision.describe(`data:image/jpeg;base64,${base64}`, {
            prompt: '只输出商店里从左到右五个棋子名字，用逗号分隔。不要 JSON、不要数字、不要坐标、不要解释。',
            maxTokens: 120,
          })
          names = String(named.text ?? '')
            .split(/[，,\n]/)
            .map((item) => item.replace(/[。.!！?？\s]/g, '').trim())
            .filter(Boolean)
            .slice(0, 5)
        } catch {
          names = []
        }
        const toPixels = (point) =>
          point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
            ? { x: Math.round(Number(point.x) * size.width), y: Math.round(Number(point.y) * size.height) }
            : null
        const cards = Array.isArray(parsed?.cards) ? parsed.cards : []
        const rollRaw = parsed?.roll ?? parsed?.buttons?.roll
        const view = parsed
          ? {
              found: Boolean(parsed.found) || cards.length > 0,
              cards: cards.map((pair, index) => {
                const pixel = toPixels({ x: pair?.[0], y: pair?.[1] })
                return pixel ? { ...pixel, name: names[index] ?? '' } : null
              }).filter(Boolean),
              rollRaw: toPixels(Array.isArray(rollRaw) ? { x: rollRaw[0], y: rollRaw[1] } : rollRaw),
              phase: parsed.phase ?? '',
              gold: parsed.gold ?? null,
              health: parsed.health ?? null,
              level: parsed.level ?? null,
              shop: (Array.isArray(parsed.shop) ? parsed.shop : []).map((card) => ({
                slot: Number(card.slot ?? 0),
                name: String(card.name ?? ''),
                pixel: toPixels(card),
              })),
              roll: toPixels(parsed.buttons?.roll),
              levelUp: toPixels(parsed.buttons?.level),
              note: String(parsed.note ?? '').slice(0, 80),
            }
          : null
        const auto = body.remember !== false && view
        if (auto && (view.rollRaw || view.cards.length)) {
          settings.game.layout = {
            ...(settings.game.layout ?? {}),
            roll: view.rollRaw ? [view.rollRaw.x, view.rollRaw.y] : settings.game.layout?.roll ?? null,
            shop: view.cards.map((card) => [card.x, card.y]),
          }
          schedulePersist(200)
        }
        return json({ ok: true, file, screen: size, view, raw: result.text.slice(0, 600) })
      },
    },
    {
      path: '/game/act',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        if (!settings.game.control) return fail('手还没解锁：先在设置里打开「允许操作」', 403)
        const body = await readBody(request)
        const actions = Array.isArray(body.actions) ? body.actions.slice(0, 12) : []
        if (!actions.length) return fail('没有动作', 400)
        if (!inputAgent) inputAgent = new InputAgent()
        const alive = await inputAgent.ping()
        if (!alive) return fail('手还没启动：双击 bibao-brain/bin/start-hands.bat', 503)
        const done = []
        // 前额叶想好了，手也要"reaction"一下才动
        await wait(Math.round(motor.reactionMs({ energy: brain.state.energy })))
        for (const action of actions) {
          const kind = String(action.type ?? '')
          try {
            if (kind === 'move') await inputAgent.move(action.x, action.y)
            else if (kind === 'click') await inputAgent.click(action.x, action.y, action.button === 'r' ? 'r' : 'l')
            else if (kind === 'drag') await inputAgent.drag(action.x1, action.y1, action.x2, action.y2, action.ms ?? 300)
            else if (kind === 'key') await inputAgent.key(String(action.key ?? ''))
            else if (kind === 'type') await inputAgent.type(String(action.text ?? ''))
            else if (kind === 'shot') await inputAgent.shot(String(action.path ?? ''))
            else if (kind === 'buy') {
              const slot = Math.max(0, Math.min(4, Number(action.slot ?? 0)))
              const point = settings.game.layout?.shop?.[slot]
              if (!point) throw new Error('还没校准商店坐标')
              await inputAgent.click(point[0], point[1])
            } else if (kind === 'roll') {
              const point = settings.game.layout?.roll
              if (!point) throw new Error('还没校准 D 键坐标')
              await inputAgent.click(point[0], point[1])
            } else if (kind === 'level') {
              const point = settings.game.layout?.level
              if (!point) throw new Error('还没校准升级坐标')
              await inputAgent.click(point[0], point[1])
            } else throw new Error(`不认识的动作 ${kind}`)
            done.push({ ...action, ok: true })
            await appendSnowLog({ at: Date.now(), kind: 'game-act', action: kind, detail: JSON.stringify(action).slice(0, 120) })
            await wait(120 + Math.round(motor.fittsMs({ distance: 240, width: 48 }) * 0.05))
          } catch (error) {
            done.push({ ...action, ok: false, error: String(error?.message ?? error).slice(0, 120) })
            await appendSnowLog({ at: Date.now(), kind: 'game-act-error', action: kind, message: String(error?.message ?? error).slice(0, 120) })
            break
          }
        }
        return json({ ok: true, done })
      },
    },
    {
      path: '/game/stop',
      methods: ['POST'],
      handler: async () => {
        settings.game.control = false
        schedulePersist(100)
        inputAgent = null
        return json({ ok: true, control: false })
      },
    },
    {
      path: '/game/pos',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        await boot()
        if (!inputAgent) inputAgent = new InputAgent()
        const alive = await inputAgent.ping()
        if (!alive) return fail('手还没启动：双击 bibao-brain/bin/start-hands.bat', 503)
        if (request.method === 'POST') {
          const body = await readBody(request)
          if (body.layout) {
            settings.game.layout = body.layout
            schedulePersist(100)
            return json({ ok: true, layout: settings.game.layout })
          }
          if (typeof body.control === 'boolean') {
            settings.game.control = body.control
            schedulePersist(100)
            return json({ ok: true, control: settings.game.control })
          }
        }
        return json({
          cursor: await inputAgent.pos(),
          screen: await inputAgent.size(),
          control: Boolean(settings.game.control),
          layout: settings.game.layout,
        })
      },
    },
    {
      path: '/bci/game',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        await boot()
        if (request.method === 'POST') {
          const body = await readBody(request)
          const state = tft.ingest(body)
          const load = Number(body.load ?? (state.phase === 'combat' ? 0.25 : 0.75))
          brain.attention.set(load)
          if (body.event) {
            // 游戏里发生的事，作为一条体感进来（不产生回复）
            brain.perceiveSense({ channel: 'system', text: `打游戏：${String(body.event).slice(0, 40)}`, intensity: 0.5 })
          }
          return json({ ok: true, game: state, attention: brain.attention.snapshot() })
        }
        return json({
          game: tft.snapshot(),
          attention: brain.attention.snapshot(),
          motor: {
            reactionMs: Math.round(motor.reactionMs({ energy: brain.state.energy })),
            mistake: Number(motor.mistakeChance({ cortisol: brain.state.cortisol }).toFixed(2)),
          },
        })
      },
    },
    {
      path: '/friends',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        await boot()
        if (request.method === 'POST') {
          const body = await readBody(request)
          const id = String(body.id ?? '')
          if (!id) return fail('缺少 id', 400)
          const relation = brain.social.get(id)
          if (!relation) return fail('没有这个人', 404)
          if ((relation.interactions ?? 0) < 10) return fail('互动还不满 10 条，她自己还没把这个人记进好友', 403)
          brain.social.setRelation(id, {
            intimacy: body.intimacy,
            trust: body.trust,
            powerFear: body.powerFear,
            impression: body.impression,
          })
          schedulePersist(200)
          return json({ ok: true, friends: friendList() })
        }
        const friends = friendList()
        schedulePersist(500)
        return json({ friends })
      },
    },
    {
      path: '/biography',
      methods: ['GET', 'POST'],
      handler: async (request) => {
        if (request.method === 'GET') {
          await loadBiography()
          return json({
            source: biography.__source ?? 'builtin',
            ageNow: biography.ageNow,
            name: biography.name,
            fullName: biography.fullName,
            oneLine: biography.oneLine,
            coreWound: biography.coreWound,
            copingStyle: biography.copingStyle,
            events: biography.events ?? [],
            relations: biography.relations ?? [],
          })
        }
        const body = await readBody(request)
        const events = Array.isArray(body.events) ? body.events : null
        if (!events || events.length < 1) return fail('至少要有一个人生事件', 400)
        const cleaned = []
        for (const [index, event] of events.entries()) {
          const age = Number(event.age)
          if (!Number.isFinite(age) || age < 0 || age > 60) {
            return fail(`第 ${index + 1} 个事件的年龄不合法`, 400)
          }
          cleaned.push({
            age,
            title: String(event.title ?? '').slice(0, 40) || `事件 ${index + 1}`,
            narrative: String(event.narrative ?? '').slice(0, 600),
            valence: Math.max(-1, Math.min(1, Number(event.valence) || 0)),
            arousal: Math.max(0, Math.min(1, Number(event.arousal) || 0.4)),
            impact:
              event.impact && typeof event.impact === 'object'
                ? Object.fromEntries(
                    Object.entries(event.impact)
                      .filter(([key]) => ['self_worth', 'world_trust', 'attachment_anxiety', 'conflict_avoidance', 'autonomy_need', 'fairness'].includes(key))
                      .map(([key, value]) => [key, Math.max(-0.15, Math.min(0.15, Number(value) || 0))]),
                  )
                : {},
            tags: Array.isArray(event.tags) ? event.tags.map((tag) => String(tag).slice(0, 12)).slice(0, 5) : [],
          })
        }
        cleaned.sort((a, b) => a.age - b.age)
        const next = {
          ...(biography ?? {}),
          name: String(body.name ?? biography?.name ?? '比宝').slice(0, 20),
          fullName: String(body.fullName ?? biography?.fullName ?? '沈知遥').slice(0, 30),
          ageNow: Math.max(cleaned.at(-1).age, Number(body.ageNow) || biography?.ageNow || 22),
          oneLine: String(body.oneLine ?? biography?.oneLine ?? '').slice(0, 80),
          coreWound: String(body.coreWound ?? biography?.coreWound ?? '').slice(0, 120),
          copingStyle: String(body.copingStyle ?? biography?.copingStyle ?? '').slice(0, 120),
          events: cleaned,
          relations:
            Array.isArray(body.relations) && body.relations.length
              ? body.relations.map((relation) => ({
                  qq: String(relation.qq ?? ''),
                  name: String(relation.name ?? '').slice(0, 20),
                  intimacy: Math.max(-100, Math.min(100, Number(relation.intimacy) || 0)),
                  trust: Math.max(0, Math.min(100, Number(relation.trust) || 35)),
                  powerFear: Math.max(0, Math.min(1, Number(relation.powerFear) || 0)),
                  tags: Array.isArray(relation.tags) ? relation.tags.map(String).slice(0, 4) : [],
                  impression: String(relation.impression ?? '').slice(0, 60),
                }))
              : (biography?.relations ?? []),
          __source: 'override',
        }
        delete next.__source
        try {
          await mkdir(dataDir, { recursive: true })
          await writeFile(path.join(dataDir, 'biography.json'), JSON.stringify(next, null, 2), 'utf8')
        } catch (error) {
          return fail(`写入传记失败：${error.message}`, 500)
        }
        biography = { ...next, __source: 'override' }
        rebuildBrain(biography)
        await persist()
        return json({ ok: true, refreshed: true, snapshot: snapshot(), biography: { ...next, source: 'override' } })
      },
    },
    {
      path: '/settings',
      methods: ['POST'],
      handler: async (request) => {
        const body = await readBody(request)
        void appendSnowLog({
          at: Date.now(),
          kind: 'settings-in',
          keys: Object.keys(body),
          tuning: body.tuning ?? null,
          hasTuning: Boolean(body.tuning),
          url: request.url,
        })
        if (typeof body.useLlm === 'boolean') settings.useLlm = body.useLlm
        if (body.snowluma && typeof body.snowluma === 'object') {
          if (typeof body.snowluma.enabled === 'boolean') settings.snowluma.enabled = body.snowluma.enabled
          if (typeof body.snowluma.sendEnabled === 'boolean') {
            settings.snowluma.sendEnabled = body.snowluma.sendEnabled
          }
          if (Array.isArray(body.snowluma.allowGroups)) {
            settings.snowluma.allowGroups = body.snowluma.allowGroups.map(String)
          }
          for (const key of ['allowPrivate', 'pokeReact', 'pokeReply', 'pokeAnyGroup', 'pokeBack', 'recallEnabled', 'stickers']) {
            if (typeof body.snowluma[key] === 'boolean') settings.snowluma[key] = body.snowluma[key]
          }
          for (const key of ['httpBase', 'httpToken', 'wsUrl', 'wsToken', 'selfId', 'configDir']) {
            if (typeof body.snowluma[key] === 'string') settings.snowluma[key] = body.snowluma[key].trim()
          }
          if (typeof body.snowluma.configDir === 'string') snowConfigDirCache = ''
          if (Number.isFinite(Number(body.snowluma.maxReplyChars))) {
            settings.snowluma.maxReplyChars = Math.max(10, Math.min(200, Number(body.snowluma.maxReplyChars)))
          }
          if (['auto', 'client', 'reverse'].includes(body.snowluma.wsMode)) settings.snowluma.wsMode = body.snowluma.wsMode
          if (body.snowluma.wsServer && typeof body.snowluma.wsServer === 'object') {
            settings.snowluma.wsServer = { ...settings.snowluma.wsServer, ...body.snowluma.wsServer }
          }
        }
        if (body.tuning && typeof body.tuning === 'object') {
          if (Number.isFinite(Number(body.tuning.memoryStrength))) {
            settings.tuning.memoryStrength = Math.max(0, Math.min(1, Number(body.tuning.memoryStrength)))
          }
          if (Number.isFinite(Number(body.tuning.talkativeness))) {
            settings.tuning.talkativeness = Math.max(0, Math.min(1, Number(body.tuning.talkativeness)))
          }
          brain?.applyTuning(settings.tuning)
        }
        if (body.growth && typeof body.growth === 'object') {
          if (typeof body.growth.selfReview === 'boolean') settings.growth.selfReview = body.growth.selfReview
          if (typeof body.growth.life === 'boolean') settings.growth.life = body.growth.life
          if (brain) brain.growth = { ...brain.growth, ...settings.growth }
        }
        if (body.outreach && typeof body.outreach === 'object') {
          if (typeof body.outreach.enabled === 'boolean') settings.outreach.enabled = body.outreach.enabled
          for (const key of ['minSilenceMin', 'maxPerDay', 'minIntimacy', 'cooldownHours']) {
            if (Number.isFinite(Number(body.outreach[key]))) settings.outreach[key] = Number(body.outreach[key])
          }
        }
        if (body.vision && typeof body.vision === 'object') {
          if (typeof body.vision.enabled === 'boolean') settings.vision.enabled = body.vision.enabled
          if (typeof body.vision.model === 'string' && body.vision.model.trim()) {
            const model = body.vision.model.trim()
            if (!model.includes('/')) return fail('视觉模型名也要写成 provider/model', 400)
            settings.vision.model = model
          }
          if (Number.isFinite(Number(body.vision.maxPerHour))) {
            settings.vision.maxPerHour = Math.max(1, Math.min(200, Number(body.vision.maxPerHour)))
          }
          if (vision) vision = createVision({ baseURL: settings.llm.baseURL, apiKey: settings.llm.apiKey, model: settings.vision.model, onUsage: visionUsage })
        }        if (body.llm && typeof body.llm === 'object') {
          if (typeof body.llm.model === 'string' && body.llm.model && !body.llm.model.includes('/')) {
            return fail(`模型名要写成 provider/model（例如 zcode/GLM-5.3-Flash），${body.llm.model} 缺了前缀`, 400)
          }
          for (const key of ['baseURL', 'apiKey', 'model']) {
            if (typeof body.llm[key] !== 'string') continue
            // 空字符串 = 表单没填，保留已保存的（尤其是 apiKey，面板只回显掩码）
            if (key === 'apiKey' && body.llm[key] === '') continue
            settings.llm[key] = body.llm[key]
          }
          if (body.llm.profiles && typeof body.llm.profiles === 'object') {
            settings.llm.profiles = settings.llm.profiles ?? {}
            const incoming = Object.keys(body.llm.profiles)
            for (const rawName of new Set([...LOGICS, ...incoming])) {
              const name = LEGACY_LOGIC_ALIAS[rawName] ?? rawName
              if (!LOGICS.includes(name)) continue
              const patch = body.llm.profiles[rawName]
              if (!patch || typeof patch !== 'object') continue
              const current = settings.llm.profiles[name] ?? {}
              settings.llm.profiles[name] = {
                ...current,
                ...(typeof patch.baseURL === 'string' ? { baseURL: patch.baseURL } : {}),
                ...(typeof patch.apiKey === 'string' && patch.apiKey ? { apiKey: patch.apiKey } : {}),
                ...(typeof patch.model === 'string' ? { model: patch.model } : {}),
                ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
              }
            }
          }
        }
        try {
          await mkdir(dataDir, { recursive: true })
          await writeFile(
            settingsFile,
            JSON.stringify({
              useLlm: settings.useLlm,
              snowluma: {
                enabled: settings.snowluma.enabled,
                sendEnabled: settings.snowluma.sendEnabled,
                allowGroups: settings.snowluma.allowGroups,
                allowPrivate: settings.snowluma.allowPrivate,
                pokeReact: settings.snowluma.pokeReact,
                pokeReply: settings.snowluma.pokeReply,
                pokeAnyGroup: settings.snowluma.pokeAnyGroup,
                pokeBack: settings.snowluma.pokeBack,
                recallEnabled: settings.snowluma.recallEnabled === true,
                stickers: settings.snowluma.stickers !== false,
                selfId: settings.snowluma.selfId ?? '',
                maxReplyChars: settings.snowluma.maxReplyChars,
                httpBase: settings.snowluma.httpBase,
                httpToken: settings.snowluma.httpToken,
                wsUrl: settings.snowluma.wsUrl,
                wsToken: settings.snowluma.wsToken,
                wsMode: settings.snowluma.wsMode,
                wsServer: settings.snowluma.wsServer,
              },
              llm: settings.llm,
              tuning: settings.tuning,
              growth: settings.growth,
              outreach: settings.outreach,
              vision: settings.vision,
            }),
            'utf8',
          )
        } catch (error) {
          console.warn('[bibao] settings save failed:', error?.message ?? error)
        }
        await boot()
        refreshLlm()
        if (settings.snowluma.enabled) {
          stopSnow()
          await startSnow()
        } else {
          stopSnow()
        }
        return json({ ok: true, snapshot: snapshot() })
      },
    },
    {
      path: '/snowluma/state',
      methods: ['GET'],
      handler: async () => {
        await boot()
        return json({ snow: snapshot().snow, group: funnel ? funnel.snapshot() : null })
      },
    },
    {
      path: '/snowluma/simulate',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        const body = await readBody(request)
        const url = new URL(request.url)
        const wantSend = body.send === true || url.searchParams.get('send') === '1'
        const groupId = String(body.groupId ?? (settings.snowluma.allowGroups ?? [])[0] ?? '')
        if (!groupId) return fail('没有配置允许的群', 400)
        if (!funnel.get(groupId)) funnel.addGroup({ id: groupId, name: `群 ${groupId}`, layer: 'muted' })
        const message = {
          kind: 'group',
          groupId,
          groupName: funnel.get(groupId)?.name ?? '',
          senderId: String(body.senderId ?? 'sim-user'),
          senderName: String(body.senderName ?? '模拟群友'),
          text: String(body.text ?? '在吗'),
          images: (Array.isArray(body.images) ? body.images : []).map(String).slice(0, 3),
          atMe: Boolean(body.atMe),
          messageId: 0,
          at: Date.now(),
        }
        if (message.images.length && funnel.get(groupId)?.layer === 'foveal') {
          void perceiveImage(message)
        }
        if (body.poke) {
          await handleSnowEvent({
            post_type: 'notice',
            notice_type: 'notify',
            sub_type: 'poke',
            time: Math.floor(Date.now() / 1000),
            self_id: Number(snow.cfg?.selfId ?? 0),
            group_id: Number(groupId),
            user_id: Number(body.senderId ?? 10003),
            target_id: Number(snow.cfg?.selfId ?? 0),
          })
          return json({ ok: true, poke: true, phase2: funnel.snapshot() })
        }
        const decision = funnel.ingest(message, { now: Date.now(), energy: brain.state.energy })
        const outcome = await snowFlush(`${groupId}:${message.senderId}`, { dry: !wantSend })
        return json({ decision, outcome, send: wantSend, receivedBody: body, phase2: funnel.snapshot() })
      },
    },
    {
      path: '/snowluma/test-ws',
      methods: ['POST'],
      handler: async (request) => {
        const body = await readBody(request)
        const cfg = snow.cfg ?? (await loadSnowConfig()) ?? {}
        const wsUrl = String(body.wsUrl ?? cfg.wsUrl ?? '')
        const wsToken = String(body.wsToken ?? cfg.wsToken ?? '')
        const result = await probeWs(wsUrl, wsToken, 4000)
        return json({ ...result, wsUrl })
      },
    },
    {
      path: '/snowluma/test',
      methods: ['POST'],
      handler: async (request) => {
        await boot()
        if (!snow.bridge) return fail(`snowluma 未连接：${snow.reason || '未知原因'}`, 409)
        const body = await readBody(request)
        const groupId = String((settings.snowluma.allowGroups ?? [])[0] ?? '')
        if (!groupId) return fail('没有配置允许的群', 400)
        const text = String(body.text ?? '在 我上线了').slice(0, 60)
        try {
          const messageId = await snow.bridge.sendGroup(groupId, text)
          await appendSnowLog({ at: Date.now(), kind: 'manual', groupId, text, messageId })
          return json({ ok: true, groupId, messageId, text })
        } catch (error) {
          return fail(`发送失败：${error.message}`, 502)
        }
      },
    },
    {
      path: '/snowluma/toggle',
      methods: ['POST'],
      handler: async (request) => {
        const body = await readBody(request)
        if (typeof body.enabled === 'boolean') settings.snowluma.enabled = body.enabled
        if (typeof body.sendEnabled === 'boolean') settings.snowluma.sendEnabled = body.sendEnabled
        try {
          await mkdir(dataDir, { recursive: true })
          await writeFile(
            settingsFile,
            JSON.stringify({
              useLlm: settings.useLlm,
              snowluma: {
                enabled: settings.snowluma.enabled,
                sendEnabled: settings.snowluma.sendEnabled,
                allowGroups: settings.snowluma.allowGroups,
                allowPrivate: settings.snowluma.allowPrivate,
                pokeReact: settings.snowluma.pokeReact,
                pokeReply: settings.snowluma.pokeReply,
                pokeAnyGroup: settings.snowluma.pokeAnyGroup,
                pokeBack: settings.snowluma.pokeBack,
                recallEnabled: settings.snowluma.recallEnabled === true,
                stickers: settings.snowluma.stickers !== false,
                selfId: settings.snowluma.selfId ?? '',
                maxReplyChars: settings.snowluma.maxReplyChars,
                httpBase: settings.snowluma.httpBase,
                httpToken: settings.snowluma.httpToken,
                wsUrl: settings.snowluma.wsUrl,
                wsToken: settings.snowluma.wsToken,
                wsMode: settings.snowluma.wsMode,
                wsServer: settings.snowluma.wsServer,
              },
              llm: settings.llm,
              tuning: settings.tuning,
              growth: settings.growth,
              outreach: settings.outreach,
              vision: settings.vision,
            }),
            'utf8',
          )
        } catch {
          /* 设置写不进去也不阻断 */
        }
        await boot()
        if (settings.snowluma.enabled) await startSnow()
        else stopSnow()
        return json({ snow: snapshot().snow })
      },
    },
    {
      path: '/reset',
      methods: ['POST'],
      handler: async (request) => {
        const body = await readBody(request)
        rebuildBrain(await loadBiography(), Number(body.seed ?? 20261101))
        schedulePersist(200)
        return json({ ok: true, snapshot: snapshot() })
      },
    },
  ]

  for (const route of routes) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${ROUTE}${route.path}`,
          methods: route.methods,
          requestBody: route.methods.includes('POST') ? 'buffered' : 'buffered',
          fetch: async (request) => {
            try {
              noteDiag(route.path, request)
              return await route.handler(request)
            } catch (error) {
              console.warn(`[bibao] ${route.path} failed:`, error?.stack ?? error)
              return fail(String(error?.message ?? error), 500)
            }
          },
        }),
      `bibao-brain: ${route.methods.join('/')} ${route.path}`,
    )
  }

  // 生物钟：20 秒同步一次真实时间，保证面板关掉时大脑也在衰老
  ctx.effect(() => {
    const ticker = setInterval(() => {
      if (!brain) return
      brain.sync()
      {
        const drift = brain.simMs - Date.now()
        if (Math.abs(drift) > 120000) {
          brain.shiftTime(-drift)
          void appendSnowLog({ at: Date.now(), kind: 'clock-auto-align', driftMs: -drift })
        }
      }
      if (snow.connected && snow.bridge && snow.bridge.stats.lastEventAt > 0 && Date.now() - snow.bridge.stats.lastEventAt > 120000) {
        snow.connected = false
        snow.reason = 'WS 已 120 秒没有任何帧（含心跳），按断开处理'
      }
      if (funnel) funnel.tick(Date.now())
      // 兜底：任何超过 8s 还没结算的防抖帧，强制定点结算，避免定时器丢失导致永远不回
      if (funnel && snow.bridge) {
        for (const frame of [...funnel.pending.values()]) {
          if (Date.now() - frame.lastAt > 8000) {
            snowFlush(frame.key).catch(() => {})
          }
        }
      }
    }, 20_000)
    if (typeof ticker.unref === 'function') ticker.unref()
    return () => clearInterval(ticker)
  }, 'bibao-brain: bio clock')

  async function startup() {
    const startedAt = Date.now()
    try {
      await boot()
      const report = await runGate()
      if (settings.snowluma.enabled) await startSnow()
      await startConsole()
      // 自检：用 connection 的鉴权 URL 真打一次自己的路由，确认浏览器同源请求能落地
      let probe = null
      let origin = ''
      try {
        origin = ctx.get('webServer')?.getOrigin?.() ?? ''
        if (origin) {
          const url = ctx.connection.authenticatedUrl(`${origin}/api/bibao/state`)
          const response = await fetch(url, { headers: { accept: 'application/json' } })
          probe = { status: response.status, url: `${origin}/api/bibao/state` }
        }
      } catch (error) {
        probe = { error: String(error?.message ?? error).slice(0, 200) }
      }
      const summary = {
        bootedAt: startedAt,
        name: brain.name,
        age: brain.age,
        episodes: brain.memory.episodes.length,
        routes: routes.length,
        gate: { passed: report.passed, total: report.total, allPassed: report.allPassed },
        stateFile,
        phase2: phase2Open() ? 'unlocked' : 'locked',
        probe,
        uiUrl: origin ? `${origin}/api/bibao/ui` : '',
        consoleUrl: consoleState.port
          ? `http://127.0.0.1:${consoleState.port}/?token=${consoleState.token}`
          : consoleState.error,
        snow: {
          enabled: settings.snowluma.enabled,
          sendEnabled: settings.snowluma.sendEnabled,
          connected: snow.connected,
          selfName: snow.selfName,
          reason: snow.reason,
        },
      }
      await mkdir(dataDir, { recursive: true })
      await writeFile(path.join(dataDir, 'boot-report.json'), JSON.stringify(summary, null, 2), 'utf8')
    } catch (error) {
      console.warn('[bibao] startup failed:', error?.stack ?? error)
      try {
        await mkdir(dataDir, { recursive: true })
        await writeFile(
          path.join(dataDir, 'boot-report.json'),
          JSON.stringify({ bootedAt: startedAt, error: String(error?.message ?? error) }, null, 2),
          'utf8',
        )
      } catch {
        /* 目录都建不出来时只能放弃 */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 独立控制台：绕开 DSH 的 React 槽位，稳定端口 + 令牌                     */
  /* ------------------------------------------------------------------ */

  const consoleState = { server: null, port: 0, token: '', error: '' }

  async function loadOrCreateToken() {
    if (consoleState.token) return consoleState.token
    try {
      const saved = (await readFile(path.join(dataDir, 'ui-token.txt'), 'utf8')).trim()
      if (saved) {
        consoleState.token = saved
        return saved
      }
    } catch {
      /* 第一次运行 */
    }
    consoleState.token = `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 8)}`
    try {
      await mkdir(dataDir, { recursive: true })
      await writeFile(path.join(dataDir, 'ui-token.txt'), consoleState.token, 'utf8')
    } catch {
      /* 写不进去就每次换一个 */
    }
    return consoleState.token
  }

  async function serveConsoleApi(req, res, url) {
    const cookie = String(req.headers.cookie ?? '')
    if (!cookie.includes(`bibao_ui=${consoleState.token}`)) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    const suffix = url.pathname.replace(/^\/api\/bibao/, '') || '/'
    const route = routes.find(
      (item) => item.path === suffix && item.methods.includes(req.method === 'POST' ? 'POST' : 'GET'),
    )
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `no route ${req.method} ${suffix}` }))
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    // 某些链路会把请求体丢掉，此时回退到查询串里的 payload（页面两种都带）
    const body = Buffer.concat(chunks).toString('utf8') || url.searchParams.get('payload') || ''
    // 查询串必须带上：/snowluma/simulate?send=1 这类开关就靠它
    const request = new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
      method: req.method,
      headers: { 'content-type': 'application/json' },
      ...(req.method === 'POST' ? { body: body || '{}' } : {}),
    })
    try {
      const response = await route.handler(request)
      const text = await response.text()
      res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(text)
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: String(error?.message ?? error) }))
    }
  }

  async function startConsole(port = Number(settings.uiPort) || 3110, attempt = 0) {
    if (consoleState.server) return consoleState
    await loadOrCreateToken()
    return new Promise((resolve) => {
      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname.startsWith('/api/bibao')) {
          await serveConsoleApi(req, res, url)
          return
        }
        const token = url.searchParams.get('token')
        const cookie = String(req.headers.cookie ?? '')
        const ok = token === consoleState.token || cookie.includes(`bibao_ui=${consoleState.token}`)
        if (!ok) {
          res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' })
          res.end('<meta charset="utf-8"><p>401：请用 boot-report.json 里的 uiUrl（带 token）打开。</p>')
          return
        }
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          ...(token ? { 'set-cookie': `bibao_ui=${consoleState.token}; Path=/; SameSite=Strict` } : {}),
        })
        res.end(renderUiHtml())
      })
      server.on('error', (error) => {
        if (attempt < 5) {
          void startConsole(port + 1, attempt + 1).then(resolve)
        } else {
          consoleState.error = String(error?.message ?? error)
          console.warn('[bibao] console failed:', consoleState.error)
          resolve(consoleState)
        }
      })
      server.listen(port, '127.0.0.1', () => {
        consoleState.server = server
        consoleState.port = port
        consoleState.error = ''
        console.log(`[bibao] console at http://127.0.0.1:${port}/?token=${consoleState.token}`)
        resolve(consoleState)
      })
      if (typeof server.unref === 'function') server.unref()
    })
  }

  ctx.effect(() => {
    void startup()
    return () => {
      stopSnow()
      store?.close()
      void usage.save()
      consoleState.server?.close()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      if (saveTimer) clearTimeout(saveTimer)
      void persist()
    }
  }, 'bibao-brain: lifecycle')
}
