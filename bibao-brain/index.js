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
import { SnowlumaBridge } from './core/snowluma.js'
import { createDirectLlm } from './core/openai.js'
import { openBrainStore } from './core/store.js'
import { createVision } from './core/vision.js'
import { StickerBook } from './core/stickers.js'
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
  // 视觉：直接用 DSH 里已经配好的 OpenAI 兼容端点，不内置本地模型
  vision: { enabled: true, model: 'zcode/GLM-5.3-Flash', maxPerHour: 20 },
  llm: {
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat',
  },
  snowluma: {
    enabled: false,
    sendEnabled: false,
    configDir: 'D:\\XiangMu\\snowluma\\config',
    httpBase: '',
    httpToken: '',
    wsUrl: '',
    wsToken: '',
    selfId: '',
    maxReplyChars: 60,
    // 只在这个群测试；白名单为空 = 谁也不理
    allowGroups: ['576268399'],
    allowPrivate: false,
  },
}

const DEMO_MEMBERS = [
  { id: '44719023', name: '阿柚', tags: ['死党'] },
  { id: '205883714', name: '老周', tags: ['室友'] },
  { id: '903277415', name: '一只鹿', tags: ['网友'] },
  { id: '6682341', name: '陈老师', tags: ['班主任'] },
  { id: '777001', name: '杠精小王', tags: [] },
]

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  settings.snowluma = { ...DEFAULTS.snowluma, ...(config?.snowluma ?? {}) }
  settings.llm = { ...DEFAULTS.llm, ...(config?.llm ?? {}) }
  settings.tuning = { ...DEFAULTS.tuning, ...(config?.tuning ?? {}) }
  settings.vision = { ...DEFAULTS.vision, ...(config?.vision ?? {}) }
  const dataDir = path.dirname(
    settings.stateFile || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'bibao', 'brain-state.json'),
  )
  const stateFile = settings.stateFile || path.join(dataDir, 'brain-state.json')
  const settingsFile = path.join(dataDir, 'settings.json')

  let biography = null
  let brain = null
  let store = null
  // AI 生成的人物草稿：应用时只发 id，避免把几 KB 的 JSON 塞进 URL（会 431）
  let personaDraft = null
  let personaDraftId = ''
  let vision = null
  let stickers = null
  let visionHour = { hour: -1, count: 0 }
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
    return brain.social
      .snapshot()
      .filter((row) => row.friend)
      .map((row) => ({
        id: row.id,
        name: row.name,
        intimacy: Math.round(row.intimacy),
        trust: Math.round(row.trust),
        powerFear: Math.round(row.powerFear ?? 0),
        impression: row.impression ?? '',
        interactions: row.interactions ?? 0,
        tags: row.tags ?? [],
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
      return { llm: createDirectLlm(cfg), provider: 'direct', model: cfg.model, source: 'direct' }
    }
    const dsh = ctx.get('llm')
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null
    const provider = settings.provider || selection?.provider || ''
    const model = settings.model || selection?.model || ''
    if (settings.useLlm && dsh && provider && model) {
      return { llm: dsh, provider, model, source: 'dsh' }
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
    if (brain) return brain
    if (loading) return loading
    loading = (async () => {
      const bio = await loadBiography()
      store = openBrainStore(path.join(dataDir, 'bibao.sqlite'))
      // 面板里切换过的语言区开关，重启后仍然有效
      try {
        const saved = JSON.parse(await readFile(settingsFile, 'utf8'))
        if (typeof saved?.useLlm === 'boolean') settings.useLlm = saved.useLlm
        if (saved?.snowluma && typeof saved.snowluma === 'object') {
          if (typeof saved.snowluma.enabled === 'boolean') settings.snowluma.enabled = saved.snowluma.enabled
          if (typeof saved.snowluma.sendEnabled === 'boolean') settings.snowluma.sendEnabled = saved.snowluma.sendEnabled
          if (Array.isArray(saved.snowluma.allowGroups)) settings.snowluma.allowGroups = saved.snowluma.allowGroups.map(String)
        }
        if (saved?.tuning && typeof saved.tuning === 'object') settings.tuning = { ...DEFAULTS.tuning, ...saved.tuning }
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
        })
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
      brain.applyTuning(settings.tuning)
      stickers = stickers || new StickerBook(path.join(dataDir, 'stickers'))
      vision = createVision({
        baseURL: settings.llm.baseURL,
        apiKey: settings.llm.apiKey,
        model: settings.vision.model,
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
        connected: snow.connected,
        reason: snow.reason,
        selfId: snow.cfg?.selfId ?? '',
        selfName: snow.selfName,
        httpBase: snow.cfg?.httpBase ?? '',
        wsUrl: snow.cfg?.wsUrl ?? '',
        stats: snow.bridge?.stats ?? null,
        lastEvent: snow.lastEvent,
        allowGroups: settings.snowluma.allowGroups ?? [],
        allowPrivate: Boolean(settings.snowluma.allowPrivate),
      },
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
    // 发完文字后，有一定概率补一张表情包（按当下情绪挑一张收藏的）
    const maybeSticker = async (to) => {
      if (!stickers || settings.snowluma.stickers === false) return
      if (Math.random() > 0.22) return
      try {
        const item = await stickers.pick(stickerMood())
        if (!item) return
        const id = groupId ? await snow.bridge.sendGroup(groupId, '', item.file) : await snow.bridge.sendPrivate(to, '', item.file)
        await appendSnowLog({ at: Date.now(), kind: 'sticker-out', groupId: groupId ?? '', target: to ?? '', gist: item.gist, messageId: id })
      } catch (error) {
        await appendSnowLog({ at: Date.now(), kind: 'sticker-error', message: String(error?.message ?? error).slice(0, 120) })
      }
    }

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
    if (message.images?.length && (message.atMe || focusGroup?.layer === 'foveal')) {
      void perceiveImage(message)
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

  const snow = { bridge: null, cfg: null, connected: false, reason: '', lastEvent: null, selfName: '' }

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
        socket = new WebSocket(url, { headers: token ? { Authorization: '' + 'Bearer ' + token } : {} })
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

  async function loadSnowConfig() {
    const conf = settings.snowluma
    // 逐字段合并：手填的优先，没填的才回落到 snowluma 自己的 onebot 配置
    let base = { httpBase: '', httpToken: '', wsUrl: '', wsToken: '', selfId: String(conf.selfId ?? '') }
    if (!conf.httpBase || !conf.wsUrl || !conf.httpToken || !conf.wsToken) {
      try {
        const files = await readdir(conf.configDir)
        const file = files.find((name) => /^onebot_.*\.json$/.test(name))
        if (file) {
          const raw = JSON.parse(await readFile(path.join(conf.configDir, file), 'utf8'))
          const http = raw.networks?.httpServers?.[0]
          const ws = raw.networks?.wsServers?.[0]
          base = {
            selfId: String(String(file).match(/\d+/)?.[0] ?? conf.selfId ?? ''),
            httpBase: http ? `http://${http.host}:${http.port}` : '',
            httpToken: http?.accessToken ?? '',
            wsUrl: ws ? `ws://${ws.host}:${ws.port}${ws.path && ws.path !== '/' ? ws.path : '/'}` : '',
            wsToken: ws?.accessToken ?? '',
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
    let wsOk = await probeWs(cfg.wsUrl, cfg.wsToken)
    if (!wsOk.ok && cfg.fallbackWsUrl && cfg.fallbackWsUrl !== cfg.wsUrl) {
      snow.reason = '自定义 WS 连不上（' + cfg.wsUrl + '：' + wsOk.error + '），已回退到 ' + cfg.fallbackWsUrl
      cfg.wsUrl = cfg.fallbackWsUrl
      cfg.wsToken = cfg.fallbackWsToken || cfg.wsToken
      wsOk = await probeWs(cfg.wsUrl, cfg.wsToken)
    }
    snow.wsStatus = wsOk
    if (!wsOk.ok) snow.reason = 'WS 连不上：' + cfg.wsUrl + '（' + wsOk.error + '）'
    snow.cfg = cfg
    const bridge = new SnowlumaBridge({
      httpBase: cfg.httpBase,
      httpToken: cfg.httpToken,
      wsUrl: cfg.wsUrl,
      wsToken: cfg.wsToken,
      selfId: cfg.selfId,
      logger: (line) => console.warn('[bibao:snowluma]', line),
      onStatus: (status) => {
        snow.connected = Boolean(status.connected)
        if (status.connected) snow.reason = snow.reason.startsWith('自定义 WS') ? snow.reason : ''
        else if (!snow.reason) snow.reason = 'WS 断开，正在重连'
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
      await maybeSticker(targetId)
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
          maxTokens: 400,
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

  async function handleSnowEvent(event) {
    if (!snow.cfg) return
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
                httpBase: settings.snowluma.httpBase,
                httpToken: settings.snowluma.httpToken,
                wsUrl: settings.snowluma.wsUrl,
                wsToken: settings.snowluma.wsToken,
              },
              llm: settings.llm,
              tuning: settings.tuning,
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
          if (body.remove) await stickers.remove(String(body.remove))
          else if (body.use) {
            const item = await stickers.pick(String(body.mood ?? stickerMood()))
            return json({ picked: item })
          }
        }
        return json({ items: await stickers.load(), stats: await stickers.stats() })
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
          if (!relation.friend) return fail('不是好友，不能在面板里改', 403)
          brain.social.setRelation(id, {
            intimacy: body.intimacy,
            trust: body.trust,
            powerFear: body.powerFear,
            impression: body.impression,
          })
          schedulePersist(200)
          return json({ ok: true, friends: friendList() })
        }
        return json({ friends: friendList() })
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
          if (typeof body.snowluma.allowPrivate === 'boolean') {
            settings.snowluma.allowPrivate = body.snowluma.allowPrivate
          }
          for (const key of ['httpBase', 'httpToken', 'wsUrl', 'wsToken']) {
            if (typeof body.snowluma[key] === 'string') settings.snowluma[key] = body.snowluma[key].trim()
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
        if (body.llm && typeof body.llm === 'object') {
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
                httpBase: settings.snowluma.httpBase,
                httpToken: settings.snowluma.httpToken,
                wsUrl: settings.snowluma.wsUrl,
                wsToken: settings.snowluma.wsToken,
              },
              llm: settings.llm,
              tuning: settings.tuning,
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
        if (message.images.length && (message.atMe || funnel.get(groupId)?.layer === 'foveal')) {
          void perceiveImage(message)
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
                httpBase: settings.snowluma.httpBase,
                httpToken: settings.snowluma.httpToken,
                wsUrl: settings.snowluma.wsUrl,
                wsToken: settings.snowluma.wsToken,
              },
              llm: settings.llm,
              tuning: settings.tuning,
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
      consoleState.server?.close()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      if (saveTimer) clearTimeout(saveTimer)
      void persist()
    }
  }, 'bibao-brain: lifecycle')
}
