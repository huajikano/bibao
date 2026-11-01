/**
 * 比宝 · 侧边栏面板（Client 半）
 *
 * 左侧栏一个图标 → 打开主面板。面板只负责"呈现神经状态 + 发起交互"，
 * 所有计算都在 Host 的认知内核里，浏览器不持有第二份真相。
 */

window.__ModuleLoader__.load({
  id: 'bibao-brain',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const PANEL_ID = 'bibao'
    const API = '/api/bibao'
    const NS = 'bibao'
    // 主面板是否真的挂载过：只用来决定"要不要用悬浮抽屉兜底"，不参与业务
    let mainMountedAt = 0

    /** 把客户端发生的事回传给 Host：用来在没有 DevTools 的情况下定位白屏。 */
    function beacon(kind, extra) {
      try {
        fetch(`${API}/client-log`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind,
            href: typeof location !== 'undefined' ? location.href : '',
            ua: typeof navigator !== 'undefined' ? String(navigator.userAgent).slice(0, 120) : '',
            ...(extra ?? {}),
          }),
          keepalive: true,
        }).catch(() => {})
      } catch {
        /* 连日志都发不出去就算了 */
      }
    }

    beacon('module-loaded')

    /* ------------------------------------------------------------------ */
    /* 文案                                                                */
    /* ------------------------------------------------------------------ */

    const DICT = {
      zh: {
        nav: '比宝',
        title: '比宝',
        subtitle: '一个真的会烦、会记仇、会走神、会心口不一的脑子',
        phase1: 'Phase 1 · 纯认知沙盒',
        clock: '脑内时间',
        silence: '静默',
        minutes: '分钟',
        capacity: '工作空间',
        hijacked: '杏仁核劫持：槽位锁死 2',
        normal: '常态：5 槽',
        mood: '心境',
        energy: '精力',
        arousal: '唤醒度',
        threshold: '点火阈值 Θ',
        thresholdHint: '静默越久越低，皮质醇越高越低',
        hormones: '神经递质',
        schema: '核心信念',
        schemaHint: '白天只读，睡眠期才允许慢速改写',
        relations: '社会关系',
        relationsHint: '亲密度 / 信任 / 权力恐惧',
        workspace: '全局工作空间',
        workspaceHint: '被挤掉且未落库的念头会永久丢失',
        lost: '最近遗忘',
        pending: '预期悬置',
        none: '暂无',
        inner: '内心独白',
        innerHint: '绝不外显的那一层',
        source: '来源',
        external: '外源',
        endogenous: '内源',
        dream: '梦',
        recallWord: '回忆',
        tabBrain: '脑内',
        tabTalk: '对话',
        tabMemory: '记忆',
        tabGroups: '群聊',
        tabGate: '验脑',
        tickHour: '快进 1 小时',
        sleepNow: '强制睡眠归纳',
        reset: '重置这一生',
        talkTitle: '和比宝说话',
        talkHint: '她的回复由激素、关系与预算决定，不由提示词决定',
        asWho: '以谁的身份',
        placeholder: '说点什么…（Enter 发送，Shift+Enter 换行）',
        send: '发送',
        thinking: '比宝正在输入…',
        showInner: '显示内心独白',
        route: '路由',
        pe: '预测误差',
        salience: '显著性',
        budget: '预算',
        chars: '字',
        noIgnite: '这条没进意识',
        memoryTitle: '情景记忆',
        memoryHint: 'R = exp(−Δt / S)：R 低于 0.35 就只剩情绪，不再有情节',
        all: '全部',
        conscious: '显意识',
        subconscious: '潜意识',
        pruning: '修剪层',
        stability: '稳定性 S',
        extractability: '可提取度 R',
        recall: '回忆起这条',
        recalled: '已回忆',
        submerged: '已经沉下去了，只剩下情绪',
        noNarrative: '叙事不可提取（只剩情绪偏置）',
        dreams: '梦',
        semantics: '语义沉淀',
        groupsTitle: '三层注意力漏斗',
        groupsHint: 'Phase 2 预演：本地模拟感官流，未接入 snowluma / QQ',
        groupsLocked: 'Phase 2 被锁死',
        groupsLockedHint: '6 大认知沙盒尚未全部通过。先验脑，再接感官。',
        goGate: '去验脑',
        group: '群',
        sender: '发送者',
        atMe: '@我',
        feed: '投喂一条群消息',
        resetGroups: '重置群状态',
        foveal: '焦点注视',
        peripheral: '余光监听',
        muted: '折叠免打扰',
        unread: '未读',
        decisions: '漏斗裁决日志',
        noLlm: '本地规则扫过，未调用 LLM',
        escalated: '提拔为焦点',
        debounce: '防抖合并',
        transfer: '跨通道吐槽',
        gateTitle: '6 大认知沙盒',
        gateHint: 'Phase 1 的放行准入标准：全部通过，Phase 2 才允许挂载',
        runAll: '运行全部 6 项',
        running: '推演中…',
        passed: '通过',
        failed: '未通过',
        gateUnlocked: 'Phase 2 已解锁',
        gateLocked: 'Phase 2 仍锁死',
        metrics: '指标',
        steps: '推演轨迹',
        hypothesis: '验收假设',
        age: '岁',
        oneLine: '人设',
        wound: '核心创伤',
        coping: '防御风格',
        llmOn: '语言区：真实 LLM',
        llmOff: '语言区：本地布洛卡',
        stage1: '丘脑门控',
        stage2: '全局点火',
        stage3: '情感评估',
        stage4: '双系统记忆',
        stage5: '语言区',
        stage6: '运动皮层',
        justNow: '刚刚',
        minAgo: '分钟前',
        hourAgo: '小时前',
        dayAgo: '天前',
        failedLoad: '读取大脑状态失败',
        ok: '完成',
        ticked: '生物钟已推进',
        slept: '睡眠归纳完成',
        resetDone: '已重新出生',
        gateDone: '验脑完成',
        samples: '示例',
        recalledMsg: '比宝撤回了一条消息',
        waking: '正在唤醒比宝…',
        retry: '重试',
        crash: '面板渲染失败',
        openPanel: '打开脑内',
        snowTitle: 'Phase 2 · snowluma 感官与嘴',
        tabSettings: '设置',
        settingsLlmTitle: '语言区模型',
        settingsLlmHint: '留空则用 DSH 当前默认模型',
        settingsModelSource: '当前生效',
        settingsKeyHint: 'apiKey 只写进本机 ~/.dsh/bibao/settings.json，不进日志、不回显',
        settingsLogicTitle: '每个逻辑各用一套模型',
        settingsLogicHint: '三种逻辑可以指向不同厂商 / 不同 key；关掉「独立配置」就继承上面的默认',
        settingsUseOwn: '独立配置',
        settingsInheritBase: '继承默认 baseURL',
        settingsInheritModel: '继承默认 model',
        settingsInheritKey: '继承默认 apiKey',
        settingsSnowHint: '只在这个群里测试',
        settingsAllowGroups: '允许的群号（逗号分隔）',
        settingsAllowSend: '允许真的发到 QQ',
        settingsAllowPrivate: '允许私聊',
        settingsSnowNote: '白名单为空 = 谁都不理；发送关闭时只观察、不发消息',
        save: '保存',
        saved: '已保存',
        close: '关闭',
        snowConnected: '已连接 QQ',
        snowOffline: '未连接',
        snowSending: '允许发送',
        snowReadOnly: '只读观察',
        snowEnable: '连接',
        snowDisable: '断开',
        snowAllow: '允许发送',
        snowMute: '停止发送',
        snowSelf: '登录账号',
        snowWhy: '状态说明',
      },
      en: {
        nav: 'Bibao',
        title: 'Bibao',
        subtitle: 'A mind that gets annoyed, holds grudges, zones out, and says one thing while feeling another',
        phase1: 'Phase 1 · Cognitive Sandbox',
        clock: 'Brain clock',
        silence: 'silence',
        minutes: 'min',
        capacity: 'Workspace',
        hijacked: 'Amygdala hijack: slots locked to 2',
        normal: 'Nominal: 5 slots',
        mood: 'Mood',
        energy: 'Energy',
        arousal: 'Arousal',
        threshold: 'Ignition threshold Θ',
        thresholdHint: 'Falls with silence and with cortisol',
        hormones: 'Neuromodulators',
        schema: 'Core schema',
        schemaHint: 'Read-only by day; rewritten only during sleep',
        relations: 'Social memory',
        relationsHint: 'intimacy / trust / power fear',
        workspace: 'Global workspace',
        workspaceHint: 'Evicted and unwritten thoughts are gone for good',
        lost: 'Recently lost',
        pending: 'Pending expectations',
        none: 'none',
        inner: 'Inner monologue',
        innerHint: 'the layer that never leaves the skull',
        source: 'source',
        external: 'external',
        endogenous: 'endogenous',
        dream: 'dream',
        recallWord: 'recall',
        tabBrain: 'Mind',
        tabTalk: 'Talk',
        tabMemory: 'Memory',
        tabGroups: 'Groups',
        tabGate: 'Bench',
        tickHour: 'Skip 1 hour',
        sleepNow: 'Force sleep consolidation',
        reset: 'Rebirth',
        talkTitle: 'Talk to Bibao',
        talkHint: 'Replies come from hormones, relationships and budget — not from a prompt',
        asWho: 'Speak as',
        placeholder: 'Say something… (Enter to send, Shift+Enter for newline)',
        send: 'Send',
        thinking: 'Bibao is typing…',
        showInner: 'Show inner monologue',
        route: 'route',
        pe: 'PE',
        salience: 'salience',
        budget: 'budget',
        chars: 'chars',
        noIgnite: 'This signal never reached consciousness',
        memoryTitle: 'Episodic memory',
        memoryHint: 'R = exp(−Δt / S): below 0.35 only the feeling survives',
        all: 'All',
        conscious: 'Conscious',
        subconscious: 'Subconscious',
        pruning: 'Pruning',
        stability: 'Stability S',
        extractability: 'Extractability R',
        recall: 'Recall this',
        recalled: 'Recalled',
        submerged: 'It sank — only the feeling is left',
        noNarrative: 'Narrative not extractable (bias only)',
        dreams: 'Dreams',
        semantics: 'Semantic residue',
        groupsTitle: 'Three-layer attention funnel',
        groupsHint: 'Phase 2 preview: simulated sensory stream, no snowluma/QQ yet',
        groupsLocked: 'Phase 2 is locked',
        groupsLockedHint: 'The six sandbox benchmarks have not all passed. Build the brain before the senses.',
        goGate: 'Run the bench',
        group: 'Group',
        sender: 'Sender',
        atMe: '@me',
        feed: 'Feed a group message',
        resetGroups: 'Reset groups',
        foveal: 'Foveal focus',
        peripheral: 'Peripheral',
        muted: 'Muted',
        unread: 'unread',
        decisions: 'Funnel decisions',
        noLlm: 'local rule scan, no LLM call',
        escalated: 'promoted to foveal',
        debounce: 'debounced',
        transfer: 'cross-channel gossip',
        gateTitle: 'Six cognitive benchmarks',
        gateHint: 'Phase 1 exit criteria: all six must pass before Phase 2 mounts',
        runAll: 'Run all six',
        running: 'Simulating…',
        passed: 'PASS',
        failed: 'FAIL',
        gateUnlocked: 'Phase 2 unlocked',
        gateLocked: 'Phase 2 locked',
        metrics: 'Metrics',
        steps: 'Trace',
        hypothesis: 'Hypothesis',
        age: 'y',
        oneLine: 'Persona',
        wound: 'Core wound',
        coping: 'Coping style',
        llmOn: 'Language area: live LLM',
        llmOff: 'Language area: local Broca',
        stage1: 'Thalamic gate',
        stage2: 'Global ignition',
        stage3: 'Appraisal',
        stage4: 'Dual memory',
        stage5: 'Language',
        stage6: 'Motor',
        justNow: 'just now',
        minAgo: 'min ago',
        hourAgo: 'h ago',
        dayAgo: 'd ago',
        failedLoad: 'Could not read brain state',
        ok: 'done',
        ticked: 'Bio clock advanced',
        slept: 'Sleep consolidation done',
        resetDone: 'Reborn',
        gateDone: 'Bench finished',
        samples: 'Samples',
        recalledMsg: 'Bibao recalled a message',
        waking: 'Waking Bibao up…',
        retry: 'Retry',
        crash: 'Panel render failed',
        openPanel: 'Open mind',
        snowTitle: 'Phase 2 · snowluma senses & mouth',
        tabSettings: 'Settings',
        settingsLlmTitle: 'Language model',
        settingsLlmHint: 'Empty = use the DSH default model',
        settingsModelSource: 'Active',
        settingsKeyHint: 'The key is stored only in ~/.dsh/bibao/settings.json; never logged or echoed',
        settingsLogicTitle: 'One model per cognitive logic',
        settingsLogicHint: 'Each logic can point at a different vendor or key; turn off "own config" to inherit',
        settingsUseOwn: 'Own config',
        settingsInheritBase: 'inherit baseURL',
        settingsInheritModel: 'inherit model',
        settingsInheritKey: 'inherit apiKey',
        settingsSnowHint: 'Test in this group only',
        settingsAllowGroups: 'Allowed group ids (comma separated)',
        settingsAllowSend: 'Actually send to QQ',
        settingsAllowPrivate: 'Allow private chats',
        settingsSnowNote: 'Empty whitelist = ignore everyone; sending off = observe only',
        save: 'Save',
        saved: 'Saved',
        close: 'Close',
        snowConnected: 'QQ connected',
        snowOffline: 'Disconnected',
        snowSending: 'Sending enabled',
        snowReadOnly: 'Read-only',
        snowEnable: 'Connect',
        snowDisable: 'Disconnect',
        snowAllow: 'Allow sending',
        snowMute: 'Stop sending',
        snowSelf: 'Account',
        snowWhy: 'Status',
      },
    }

    /* ------------------------------------------------------------------ */
    /* 基础工具                                                            */
    /* ------------------------------------------------------------------ */

    async function request(pathname, options = {}) {
      // 某些链路会把 POST 的 body 丢掉，所以同一份 JSON 再塞进查询串，Host 两边都认
      let url = `${API}${pathname}`
      if (options.method === 'POST' && typeof options.body === 'string' && options.body.length <= 1500) {
        url += `${url.includes('?') ? '&' : '?'}payload=${encodeURIComponent(options.body)}`
      }
      const response = await fetch(new URL(url, window.location.origin), {
        headers: { 'content-type': 'application/json' },
        ...options,
      })
      const raw = await response.text()
      let data = null
      try {
        data = raw ? JSON.parse(raw) : null
      } catch {
        data = null
      }
      if (!response.ok) {
        const error = new Error(data?.error || `HTTP ${response.status}`)
        error.status = response.status
        error.payload = data
        throw error
      }
      return data
    }

    const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))
    const pct = (value) => Math.round(clamp01(value) * 100)
    const fixed = (value, digits = 2) =>
      Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'
    const signed = (value) => `${Number(value) > 0 ? '+' : ''}${fixed(value, 2)}`

    function ago(ms, t) {
      if (!ms) return ''
      const diff = Date.now() - ms
      if (diff < 60_000) return t('justNow')
      if (diff < 3_600_000) return `${Math.round(diff / 60_000)} ${t('minAgo')}`
      if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ${t('hourAgo')}`
      return `${Math.round(diff / 86_400_000)} ${t('dayAgo')}`
    }

    function clockOf(ms) {
      if (!ms) return '--:--'
      const d = new Date(ms)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    const TIER_CLASS = { conscious: 'good', subconscious: 'warn', pruning: 'idle' }

    /* ------------------------------------------------------------------ */
    /* 原子组件                                                            */
    /* ------------------------------------------------------------------ */

    function Bar({ value, max = 1, tone = 'brand' }) {
      const width = Math.max(0, Math.min(100, (Number(value) || 0) / max * 100))
      return h(
        'div',
        { className: 'bb-bar', role: 'presentation' },
        h('span', { className: `bb-barFill bb-tone-${tone}`, style: { width: `${width}%` } }),
      )
    }

    function Chip({ children, tone = '' }) {
      return h('span', { className: `bb-chip${tone ? ` ${tone}` : ''}` }, children)
    }

    function Card({ title, hint, children, className = '' }) {
      return h(
        'section',
        { className: `bb-card ${className}` },
        h(
          'header',
          { className: 'bb-cardHead' },
          h('span', { className: 'bb-cardTitle' }, title),
          hint ? h('span', { className: 'bb-cardHint' }, hint) : null,
        ),
        children,
      )
    }

    function Stat({ label, value, tone = '' }) {
      return h(
        'div',
        { className: 'bb-row' },
        h('span', { className: 'bb-rowLabel' }, label),
        h('span', { className: `bb-rowValue${tone ? ` ${tone}` : ''}` }, value),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 侧边栏图标                                                          */
    /* ------------------------------------------------------------------ */

    function BibaoIcon({ size = 18, active = false }) {
      const s = Number(size) || 18
      return h(
        'svg',
        {
          width: s,
          height: s,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          style: { display: 'block', opacity: active ? 1 : 0.92 },
        },
        h('path', {
          d: 'M9.2 4.6c1.5 0 2.4.9 2.8 1.9.4-1 1.3-1.9 2.8-1.9 2 0 3.4 1.5 3.4 3.4 0 .8-.2 1.5-.6 2.1.9.5 1.5 1.5 1.5 2.6 0 1.7-1.4 3.1-3.1 3.1h-.4v1.6c0 1.2-1 2.2-2.2 2.2H9.5c-1.2 0-2.2-1-2.2-2.2v-1.4c-1.4-.4-2.4-1.7-2.4-3.2 0-1.2.7-2.3 1.7-2.8-.3-.5-.5-1.1-.5-1.8 0-1.9 1.5-3.4 3.1-3.4Z',
          stroke: 'currentColor',
          strokeWidth: '1.35',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M12 8.4v6.2M9.4 10.1c.9.2 1.5.9 1.6 1.8M14.6 10.1c-.9.2-1.5.9-1.6 1.8M9.6 13.9c.7.7 1.5 1 2.4 1 .9 0 1.7-.3 2.4-1',
          stroke: 'currentColor',
          strokeWidth: '1.2',
          strokeLinecap: 'round',
        }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 认知环路图                                                          */
    /* ------------------------------------------------------------------ */

    const RING = [
      { key: 'funnel', labelKey: 'stage1', x: 170, y: 40 },
      { key: 'workspace', labelKey: 'stage2', x: 276, y: 85 },
      { key: 'appraisal', labelKey: 'stage3', x: 276, y: 175 },
      { key: 'memory', labelKey: 'stage4', x: 170, y: 220 },
      { key: 'prefrontal', labelKey: 'stage5', x: 64, y: 175 },
      { key: 'motor', labelKey: 'stage6', x: 64, y: 85 },
    ]

    const ACTIVE_STATUS = new Set(['pass', 'ignited', 'defense', 'write', 'think', 'send', 'appraise'])

    /**
     * 没有新的感知帧时（例如刚重启），用当前脑状态反推六节点的灯，
     * 否则环路上一个模块都不亮，看起来像死机。
     */
    function stagesFor(snap) {
      const pipeline = snap?.pipeline
      if (Array.isArray(pipeline?.stages) && pipeline.stages.length) return pipeline.stages
      const slots = snap?.workspace?.slots ?? []
      const written = slots.filter((slot) => slot.written)
      const inner = snap?.inner ?? []
      const lastExternal = [...inner].reverse().find((item) => item.kind === 'external')
      const pending = (snap?.pending ?? []).length
      return [
        { key: 'funnel', status: slots.length ? 'pass' : 'blocked', detail: `${slots.length} 槽有内容` },
        { key: 'workspace', status: slots.length ? 'ignited' : 'idle', detail: `${slots.length}/${snap?.workspace?.capacity ?? 5}` },
        { key: 'appraisal', status: written.length ? 'appraise' : 'idle', detail: written.length ? '已评估' : '暂无新刺激' },
        { key: 'memory', status: written.length ? 'write' : 'skip', detail: written.length ? '有情景落库' : '未达写入阈值' },
        { key: 'prefrontal', status: lastExternal ? 'think' : 'idle', detail: lastExternal?.source ?? '待命' },
        { key: 'motor', status: lastExternal?.bubbles?.length ? 'send' : 'hold', detail: lastExternal?.bubbles?.length ? '已发出' : '压住不发' },
        { key: 'feedback', status: pending ? 'waiting' : 'idle', detail: pending ? `${pending} 个在等` : '没有悬置' },
      ]
    }

    function LoopMap({ stages, t }) {
      const map = {}
      for (const stage of stages ?? []) map[stage.key] = stage
      const nodes = RING.map((node) => ({
        ...node,
        stage: map[node.key] ?? null,
        active: ACTIVE_STATUS.has(map[node.key]?.status),
      }))
      return h(
        'svg',
        {
          viewBox: '0 0 340 260',
          className: 'bb-loop',
          role: 'img',
          'aria-label': t('inner'),
        },
        nodes.map((node, index) => {
          const next = nodes[(index + 1) % nodes.length]
          return h('line', {
            key: `edge-${node.key}`,
            x1: node.x,
            y1: node.y,
            x2: next.x,
            y2: next.y,
            className: `bb-edge${node.active || next.active ? ' is-active' : ''}`,
          })
        }),
        nodes.map((node) =>
          h(
            'g',
            { key: node.key, className: `bb-node${node.active ? ' is-active' : ''}` },
            h('rect', {
              x: node.x - 46,
              y: node.y - 19,
              width: 92,
              height: 38,
              rx: 12,
              className: 'bb-nodeShape',
            }),
            h(
              'text',
              { x: node.x, y: node.y + 4, className: 'bb-nodeText', textAnchor: 'middle' },
              t(node.labelKey),
            ),
            node.stage?.status === 'blocked' || node.stage?.status === 'skip'
              ? h('circle', { cx: node.x + 34, cy: node.y - 10, r: 2.6, className: 'bb-nodeDot is-off' })
              : null,
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 脑内面板                                                            */
    /* ------------------------------------------------------------------ */

    function NeuroCard({ snap, t }) {
      const neuro = snap.neuro
      return h(
        Card,
        { title: t('hormones'), hint: t('thresholdHint') },
        h(
          'div',
          { className: 'bb-mood' },
          h('span', { className: 'bb-moodLabel' }, t('mood')),
          h('strong', { className: 'bb-moodValue' }, neuro.moodLabel),
          h('span', { className: 'bb-muted' }, `${signed(neuro.mood)} · ${t('arousal')} ${fixed(neuro.arousal)}`),
        ),
        neuro.hormones.map((item) =>
          h(
            'div',
            { key: item.key, className: 'bb-hormone' },
            h(
              'div',
              { className: 'bb-hormoneHead' },
              h('span', { className: 'bb-hormoneName' }, item.label),
              h('span', { className: 'bb-hormoneValue' }, pct(item.value)),
              h('span', { className: 'bb-muted' }, `t½ ${item.halfLifeMin}m`),
            ),
            h(Bar, { value: item.value, tone: item.key }),
          ),
        ),
        h(
          'div',
          { className: 'bb-hormone' },
          h(
            'div',
            { className: 'bb-hormoneHead' },
            h('span', { className: 'bb-hormoneName' }, t('energy')),
            h('span', { className: 'bb-hormoneValue' }, Math.round(neuro.energy)),
            neuro.exhausted ? Chip({ children: 'exhausted', tone: 'bad' }) : null,
          ),
          h(Bar, { value: neuro.energy, max: 100, tone: 'energy' }),
        ),
      )
    }

    function ThresholdCard({ snap, t }) {
      const th = snap.threshold
      return h(
        Card,
        { title: t('threshold'), hint: t('thresholdHint') },
        h(
          'div',
          { className: 'bb-theta' },
          h('strong', { className: 'bb-thetaValue' }, fixed(th.value, 3)),
          h(
            'div',
            { className: 'bb-thetaParts' },
            h(Stat, { label: 'Θ_base', value: fixed(th.base, 2) }),
            h(Stat, { label: '− 0.25·Cortisol', value: `−${fixed(th.cortisolTerm, 2)}` }),
            h(Stat, { label: '− 0.5·tanh(Δt/τ)', value: `−${fixed(th.silenceTerm, 2)}` }),
            h(Stat, { label: t('silence'), value: `${snap.clock.silenceMin} ${t('minutes')}` }),
          ),
        ),
        h(
          'div',
          { className: 'bb-inline' },
          Chip({ children: t('capacity'), tone: 'on' }),
          h('span', { className: 'bb-muted' }, `${snap.workspace.slots.length}/${snap.workspace.capacity}`),
          snap.workspace.hijacked
            ? Chip({ children: t('hijacked'), tone: 'bad' })
            : Chip({ children: t('normal'), tone: '' }),
        ),
      )
    }

    function WorkspaceCard({ snap, t }) {
      const slots = snap.workspace.slots
      const capacity = snap.workspace.capacity
      const items = []
      for (let i = 0; i < Math.max(capacity, slots.length); i += 1) {
        const slot = slots[i]
        items.push(
          slot
            ? h(
                'div',
                { key: slot.id, className: 'bb-slot filled' },
                h('div', { className: 'bb-slotTitle' }, slot.title || slot.content.slice(0, 18)),
                h(
                  'div',
                  { className: 'bb-slotMeta' },
                  `${slot.kind === 'endogenous' ? t('endogenous') : t('external')} · sal ${fixed(slot.salience)} · act ${fixed(slot.activation)}`,
                ),
                h(Bar, { value: slot.activation, tone: slot.written ? 'brand' : 'warn' }),
                slot.written ? null : h('div', { className: 'bb-slotMeta' }, '未落库：被挤掉即永久丢失'),
              )
            : h(
                'div',
                { key: `empty-${i}`, className: 'bb-slot' },
                h('div', { className: 'bb-slotMeta' }, capacity <= 2 ? '被劫持锁死' : '空闲槽位'),
              ),
        )
      }
      return h(
        Card,
        { title: t('workspace'), hint: t('workspaceHint') },
        h('div', { className: 'bb-slots' }, items),
        (snap.workspace.lost ?? []).length
          ? h(
              'div',
              { className: 'bb-lost' },
              h('span', { className: 'bb-muted' }, `${t('lost')}：`),
              snap.workspace.lost.map((item) =>
                h(Chip, { key: item.title + item.at, children: item.title.slice(0, 14) }),
              ),
            )
          : null,
      )
    }

    function SchemaCard({ snap, t }) {
      return h(
        Card,
        { title: t('schema'), hint: t('schemaHint') },
        snap.schema.map((item) =>
          h(
            'div',
            { key: item.key, className: 'bb-schema' },
            h(
              'div',
              { className: 'bb-hormoneHead' },
              h('span', { className: 'bb-hormoneName' }, item.label),
              h('span', { className: 'bb-muted' }, `${signed(item.value)} · w ${fixed(item.weight)}`),
              item.protected ? Chip({ children: '固执', tone: 'warn' }) : null,
            ),
            h(Bar, {
              value: (item.value + 1) / 2,
              tone: item.value < -0.1 ? 'warn' : 'brand',
            }),
          ),
        ),
      )
    }

    function SocialCard({ snap, t }) {
      const people = snap.social ?? []
      return h(
        Card,
        { title: t('relations'), hint: `${t('relationsHint')} · 共 ${people.length} 人` },
        h(
          'div',
          { className: 'bb-social' },
          people.map((item) =>
            h(
              'div',
              { key: item.id, className: 'bb-relation' },
              h('span', { className: 'bb-relationName' }, item.name),
              h(
                'span',
                { className: 'bb-muted' },
                `亲 ${Math.round(item.intimacy)} · 信 ${Math.round(item.trust)} · 惧 ${fixed(item.powerFear)} · ${item.interactions ?? 0} 次`,
              ),
              item.tags?.length ? h(Chip, { children: item.tags[0] }) : null,
              item.recent?.length
                ? h('div', { className: 'bb-muted bb-relationSay' }, `${item.recent.at(-1).role === 'self' ? '她说' : '对方'}：${item.recent.at(-1).text}`)
                : null,
            ),
          ),
        ),
      )
    }

    function RecentTalkCard({ snap, t }) {
      const people = (snap.social ?? []).filter((item) => item.recent?.length)
      return h(
        Card,
        { title: '最近聊过', hint: '短时缓冲：进提示词，但不进海马体' },
        people.length
          ? people
              .slice()
              .sort((a, b) => (b.recent.at(-1)?.at ?? 0) - (a.recent.at(-1)?.at ?? 0))
              .slice(0, 6)
              .map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'bb-innerItem' },
                  h('div', { className: 'bb-innerMeta' }, h('span', {}, item.name), h(Chip, { children: `亲 ${Math.round(item.intimacy)}` })),
                  item.recent
                    .slice(-3)
                    .map((line, index) =>
                      h('div', { key: index, className: 'bb-muted' }, `${line.role === 'self' ? '她说' : '对方'}：${line.text}`),
                    ),
                ),
              )
          : h('div', { className: 'bb-muted' }, t('none')),
      )
    }

    function InnerCard({ snap, t }) {
      const items = [...(snap.inner ?? [])].reverse().slice(0, 8)
      return h(
        Card,
        { title: t('inner'), hint: t('innerHint') },
        h(
          'div',
          { className: 'bb-inner' },
          items.length
            ? items.map((item, index) =>
                h(
                  'div',
                  { key: `${item.at}-${index}`, className: 'bb-innerItem' },
                  h(
                    'div',
                    { className: 'bb-innerMeta' },
                    h('span', {}, clockOf(item.at)),
                    h(Chip, {
                      children:
                        item.kind === 'dream'
                          ? t('dream')
                          : item.kind === 'recall'
                            ? t('recallWord')
                            : item.kind === 'endogenous'
                              ? t('endogenous')
                              : t('external'),
                      tone: item.ignited ? 'on' : '',
                    }),
                    item.source ? h('span', {}, item.source) : null,
                  ),
                  h('div', {}, item.thought),
                ),
              )
            : h('div', { className: 'bb-muted' }, t('none')),
        ),
      )
    }

    function PendingCard({ snap, t }) {
      const list = snap.pending ?? []
      return h(
        Card,
        { title: t('pending'), hint: '已读不回会拉高皮质醇' },
        list.length
          ? list.map((item) =>
              h(
                'div',
                { key: item.id, className: 'bb-pending' },
                h('span', {}, `${item.entityName} · ${item.kind}`),
                h(Chip, { children: `${item.remainingSec}s`, tone: 'warn' }),
                h('div', { className: 'bb-muted' }, item.preview),
              ),
            )
          : h('div', { className: 'bb-muted' }, t('none')),
      )
    }

    function BrainTab({ snap, t, act, busy }) {
      const identity = snap.identity
      const snow = snap.snow ?? {}
      const snowStats = snow.stats ?? {}
      return h(
        'div',
        { className: 'bb-stack' },
        h(
          Card,
          { title: `${identity.name} · ${identity.age} ${t('age')}`, hint: t('phase1') },
          h('p', { className: 'bb-quote' }, identity.oneLine),
          h(Stat, { label: t('wound'), value: identity.coreWound }),
          h(Stat, { label: t('coping'), value: identity.copingStyle }),
          h(
            'div',
            { className: 'bb-inline' },
            h(Chip, {
              children: snap.llm.enabled ? t('llmOn') : t('llmOff'),
              tone: snap.llm.enabled ? 'good' : '',
            }),
            h(Chip, { children: `${t('clock')} ${snap.clock.label}` }),
            h(Chip, { children: `${snap.stats.turns} 轮 · ${snap.stats.endogenous} 次内源点火` }),
          ),
        ),
        h(
          'div',
          { className: 'bb-actions' },
          h(
            'button',
            { type: 'button', className: 'bb-btn', disabled: busy, onClick: () => act('/tick', { seconds: 3600 }) },
            t('tickHour'),
          ),
          h(
            'button',
            { type: 'button', className: 'bb-btn', disabled: busy, onClick: () => act('/sleep', {}) },
            t('sleepNow'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'bb-btn',
              disabled: busy,
              onClick: () => act('/settings', { useLlm: !snap.llm.enabled }),
            },
            snap.llm.enabled ? t('llmOn') : t('llmOff'),
          ),
          h(
            'button',
            { type: 'button', className: 'bb-btn', disabled: busy, onClick: () => act('/reset', {}) },
            t('reset'),
          ),
        ),
        h(
          Card,
          { title: t('snowTitle'), hint: snow.httpBase || 'snowluma' },
          h(
            'div',
            { className: 'bb-inline bb-inline--wrap' },
            h(Chip, {
              children: snow.connected ? t('snowConnected') : t('snowOffline'),
              tone: snow.connected ? 'good' : 'bad',
            }),
            h(Chip, {
              children: snow.sendEnabled ? t('snowSending') : t('snowReadOnly'),
              tone: snow.sendEnabled ? 'warn' : 'on',
            }),
            snow.selfName ? h(Chip, { children: `${snow.selfName} · ${snow.selfId}` }) : null,
            h(
              'button',
              {
                type: 'button',
                className: 'bb-btn bb-btn--tiny',
                disabled: busy,
                onClick: () => act('/snowluma/toggle', { enabled: !snow.enabled }),
              },
              snow.enabled ? t('snowDisable') : t('snowEnable'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'bb-btn bb-btn--tiny',
                disabled: busy || !snow.enabled,
                onClick: () => act('/snowluma/toggle', { sendEnabled: !snow.sendEnabled }),
              },
              snow.sendEnabled ? t('snowMute') : t('snowAllow'),
            ),
          ),
          h(Stat, { label: t('snowSelf'), value: `${snow.selfName || '—'} · ${snow.selfId || '—'}` }),
          h(Stat, {
            label: 'events / sent',
            value: `${snowStats.events ?? 0} / ${snowStats.sent ?? 0}`,
          }),
          snow.reason ? h('div', { className: 'bb-muted' }, `${t('snowWhy')}：${snow.reason}`) : null,
          snow.lastEvent
            ? h(
                'div',
                { className: 'bb-innerItem' },
                h(
                  'div',
                  { className: 'bb-innerMeta' },
                  h('span', {}, snow.lastEvent.kind),
                  h('span', {}, snow.lastEvent.senderName),
                  h('span', {}, clockOf(snow.lastEvent.at)),
                ),
                h('div', {}, snow.lastEvent.text),
              )
            : null,
        ),
        h('div', { className: 'bb-grid' }, h(LoopMap, { stages: stagesFor(snap), t })),
        h('div', { className: 'bb-grid' }, h(NeuroCard, { snap, t }), h(ThresholdCard, { snap, t })),
        h('div', { className: 'bb-grid' }, h(WorkspaceCard, { snap, t }), h(InnerCard, { snap, t })),
        h('div', { className: 'bb-grid' }, h(SchemaCard, { snap, t }), h(SocialCard, { snap, t })),
        h('div', { className: 'bb-grid' }, h(PendingCard, { snap, t })),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 对话面板                                                            */
    /* ------------------------------------------------------------------ */

    function TalkTab({ snap, t }) {
      const [messages, setMessages] = useState([])
      const [draft, setDraft] = useState('')
      const [typing, setTyping] = useState(false)
      const [showInner, setShowInner] = useState(true)
      const [error, setError] = useState('')
      const timers = useRef([])
      const threadRef = useRef(null)

      const options = [{ id: 'owner', name: '我自己', hint: '亲密度 42' }].concat(
        (snap?.social ?? [])
          .filter((item) => item.id !== 'owner')
          .map((item) => ({ id: item.id, name: item.name, hint: `亲 ${Math.round(item.intimacy)} / 惧 ${fixed(item.powerFear)}` })),
      )
      const [asId, setAsId] = useState('owner')
      const target = options.find((item) => item.id === asId) ?? options[0]

      useEffect(
        () => () => {
          for (const timer of timers.current) clearTimeout(timer)
        },
        [],
      )

      useEffect(() => {
        const el = threadRef.current
        if (el) el.scrollTop = el.scrollHeight
      }, [messages, typing])

      const send = async () => {
        const text = draft.trim()
        if (!text || typing) return
        setDraft('')
        setError('')
        const id = `m${Date.now()}`
        setMessages((list) => [...list, { id: `${id}-me`, role: 'me', bubbles: [text] }])
        setTyping(true)
        try {
          const data = await request('/talk', {
            method: 'POST',
            body: JSON.stringify({ text, entityId: target.id, entityName: target.name }),
          })
          const result = data.result
          if (!result.ignited) {
            setTyping(false)
            setMessages((list) => [
              ...list,
              {
                id,
                role: 'bibao',
                bubbles: [],
                note: `${t('noIgnite')}：${result.reason}（salience ${fixed(result.salience)} < Θ ${fixed(result.theta)}）`,
              },
            ])
            return
          }
          const reply = {
            id,
            role: 'bibao',
            bubbles: [],
            inner: result.dual?.inner_monologue,
            route: result.dual?.action_route,
            pe: result.pe,
            salience: result.salience,
            style: result.style,
            budget: result.budget,
            source: result.dual?.meta?.source,
            transfer: result.dual?.transfer_target_name,
            regret: Boolean(result.dual?.trigger_regret_recall),
          }
          setMessages((list) => [...list, reply])
          const motor = result.motor ?? []
          if (!motor.length) {
            setTyping(false)
            setMessages((list) =>
              list.map((item) =>
                item.id === id ? { ...item, note: `（${result.dual?.action_route}：压住不发）` } : item,
              ),
            )
          }
          motor.forEach((step, index) => {
            const timer = setTimeout(() => {
              setMessages((list) =>
                list.map((item) =>
                  item.id === id ? { ...item, bubbles: [...item.bubbles, step.text] } : item,
                ),
              )
              if (index === motor.length - 1) {
                setTyping(false)
                // 冲动撤回：高皮质醇下发出去的狠话，3~6 秒后自己删掉
                if (reply.regret) {
                  const recallTimer = setTimeout(() => {
                    setMessages((list) =>
                      list.map((item) => (item.id === id ? { ...item, recalled: true } : item)),
                    )
                  }, 3800)
                  timers.current.push(recallTimer)
                }
              }
            }, 420 + step.delayMs)
            timers.current.push(timer)
          })
        } catch (err) {
          setTyping(false)
          setError(err.message)
        }
      }

      return h(
        'div',
        { className: 'bb-stack' },
        h(
          Card,
          { title: t('talkTitle'), hint: t('talkHint') },
          h(
            'div',
            { className: 'bb-inline bb-inline--wrap' },
            h('span', { className: 'bb-muted' }, t('asWho')),
            h(
              'select',
              {
                className: 'bb-select',
                value: asId,
                onChange: (event) => setAsId(event.target.value),
              },
              options.map((item) =>
                h('option', { key: item.id, value: item.id }, `${item.name} · ${item.hint}`),
              ),
            ),
            h(
              'label',
              { className: 'bb-check' },
              h('input', {
                type: 'checkbox',
                checked: showInner,
                onChange: (event) => setShowInner(event.target.checked),
              }),
              t('showInner'),
            ),
          ),
          h(
            'div',
            { className: 'bb-thread', ref: threadRef },
            messages.length
              ? messages.map((message) =>
                  h(
                    'div',
                    { key: message.id, className: `bb-msg${message.role === 'me' ? ' me' : ''}` },
                    h('div', { className: 'bb-avatar' }, message.role === 'me' ? '我' : '比'),
                    h(
                      'div',
                      { className: 'bb-bubbles' },
                      message.bubbles.map((text, index) =>
                        h(
                          'div',
                          {
                            key: `${message.id}-b${index}`,
                            className: `bb-bubble${message.recalled ? ' is-recalled' : ''}`,
                          },
                          message.recalled ? t('recalledMsg') : text,
                        ),
                      ),
                      message.note ? h('div', { className: 'bb-replyMeta' }, message.note) : null,
                      message.role === 'bibao' && showInner && message.inner
                        ? h('div', { className: 'bb-innerBubble' }, message.inner)
                        : null,
                      message.role === 'bibao' && message.route
                        ? h(
                            'div',
                            { className: 'bb-replyMeta' },
                            `${t('route')} ${message.route} · ${t('pe')} ${fixed(message.pe)} · ${t('salience')} ${fixed(message.salience)} · ${t('budget')} ${message.budget?.maxChars ?? '—'} ${t('chars')} · ${message.source ?? 'local'}`,
                          )
                        : null,
                    ),
                  ),
                )
              : h('div', { className: 'bb-muted' }, t('talkHint')),
            typing ? h('div', { className: 'bb-typing' }, t('thinking')) : null,
          ),
          h(
            'div',
            { className: 'bb-compose' },
            h('textarea', {
              className: 'bb-textarea',
              rows: 2,
              value: draft,
              placeholder: t('placeholder'),
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              },
            }),
            h(
              'button',
              { type: 'button', className: 'bb-btn primary', disabled: typing || !draft.trim(), onClick: send },
              t('send'),
            ),
          ),
          error ? h('div', { className: 'bb-error' }, error) : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 记忆面板                                                            */
    /* ------------------------------------------------------------------ */

    function MemoryTab({ snap, t, refresh }) {
      const [tier, setTier] = useState('all')
      const [data, setData] = useState(null)
      const [recall, setRecall] = useState(null)
      const [busy, setBusy] = useState(false)

      const load = useCallback(
        async (nextTier = tier) => {
          try {
            const payload = await request(`/memory?tier=${nextTier}&limit=60`)
            setData(payload)
          } catch (error) {
            setData({ items: [], error: error.message })
          }
        },
        [tier],
      )

      useEffect(() => {
        void load(tier)
      }, [tier, load])

      const doRecall = async (id) => {
        setBusy(true)
        try {
          const payload = await request('/recall', { method: 'POST', body: JSON.stringify({ memoryId: id }) })
          setRecall(payload.result)
          await load(tier)
          refresh?.()
        } catch (error) {
          setRecall({ ok: false, message: error.message })
        } finally {
          setBusy(false)
        }
      }

      const items = data?.items ?? []
      return h(
        'div',
        { className: 'bb-stack' },
        h(
          Card,
          { title: t('memoryTitle'), hint: t('memoryHint') },
          h(
            'div',
            { className: 'bb-inline' },
            ['all', 'conscious', 'subconscious', 'pruning'].map((key) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  className: `bb-tab${tier === key ? ' is-active' : ''}`,
                  onClick: () => setTier(key),
                },
                t(key),
              ),
            ),
            data?.stats
              ? h(Chip, { children: `共 ${data.stats.total} · 显 ${data.stats.conscious} · 潜 ${data.stats.subconscious} · 归档 ${data.stats.archived}` })
              : null,
          ),
          recall
            ? h(
                'div',
                { className: `bb-banner${recall.ok ? ' is-good' : ' is-warn'}` },
                recall.ok
                  ? `${t('recalled')}：${recall.narrativeBefore} → ${recall.narrativeAfter}`
                  : `${t('submerged')}：${recall.message ?? ''}`,
              )
            : null,
          h(
            'div',
            { className: 'bb-memList' },
            items.length
              ? items.map((item) =>
                  h(
                    'div',
                    { key: item.id, className: 'bb-memRow' },
                    h(
                      'div',
                      { className: 'bb-memHead' },
                      h('span', { className: 'bb-memTitle' }, item.title),
                      h(Chip, { children: t(item.tier), tone: TIER_CLASS[item.tier] }),
                      h('span', { className: 'bb-muted' }, ago(item.at, t)),
                    ),
                    h('div', { className: 'bb-memNarrative' }, item.narrative ?? t('noNarrative')),
                    h(
                      'div',
                      { className: 'bb-memMeta' },
                      h('span', {}, `R ${fixed(item.r, 3)}`),
                      h('span', {}, `S ${fixed(item.sDays, 1)}d`),
                      h('span', {}, `V ${signed(item.valence)}`),
                      h('span', {}, `A ${fixed(item.arousal)}`),
                      item.recalls ? h('span', {}, `${t('recalled')} ×${item.recalls}`) : null,
                      item.distortions ? h(Chip, { children: `涂抹 ×${item.distortions}`, tone: 'warn' }) : null,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'bb-btn bb-btn--tiny',
                          disabled: busy || item.tier !== 'conscious',
                          onClick: () => doRecall(item.id),
                        },
                        t('recall'),
                      ),
                    ),
                    h(Bar, { value: item.r, tone: item.tier === 'conscious' ? 'brand' : 'warn' }),
                  ),
                )
              : h('div', { className: 'bb-muted' }, t('none')),
          ),
        ),
        h(
          'div',
          { className: 'bb-grid' },
          h(
            Card,
            { title: t('dreams'), hint: '睡眠交叉回放的副产品' },
            (data?.dreams ?? snap?.memory?.dreams ?? []).length
              ? (data?.dreams ?? snap.memory.dreams)
                  .slice()
                  .reverse()
                  .map((dream) =>
                    h(
                      'div',
                      { key: dream.id, className: 'bb-innerItem' },
                      h('div', { className: 'bb-innerMeta' }, h('span', {}, clockOf(dream.at)), h(Chip, { children: t('dream') })),
                      h('div', {}, dream.narrative),
                    ),
                  )
              : h('div', { className: 'bb-muted' }, t('none')),
          ),
          h(
            Card,
            { title: t('semantics'), hint: '重复出现的模式才配进新皮层' },
            (data?.semantics ?? snap?.memory?.semantics ?? []).length
              ? (data?.semantics ?? snap.memory.semantics)
                  .slice()
                  .reverse()
                  .map((item) =>
                    h(
                      'div',
                      { key: item.id, className: 'bb-a9' },
                      h(Chip, { children: item.tag }),
                      h('span', { className: 'bb-muted' }, `×${item.count} · ${item.text}`),
                    ),
                  )
              : h('div', { className: 'bb-muted' }, t('none')),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 群聊漏斗（Phase 2 预演）                                             */
    /* ------------------------------------------------------------------ */

    function GroupsTab({ snap, t, onGoGate }) {
      const [state, setState] = useState(null)
      const [groupId, setGroupId] = useState('g_class')
      const [senderId, setSenderId] = useState('44719023')
      const [text, setText] = useState('')
      const [atMe, setAtMe] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      const load = useCallback(async () => {
        try {
          const payload = await request('/group/state')
          setState(payload)
        } catch (err) {
          setError(err.message)
        }
      }, [])

      useEffect(() => {
        void load()
        const timer = setInterval(load, 3500)
        return () => clearInterval(timer)
      }, [load])

      const unlocked = state?.unlocked ?? snap?.phase2?.unlocked ?? false
      if (!unlocked) {
        return h(
          Card,
          { title: t('groupsLocked'), hint: t('groupsHint') },
          h('p', { className: 'bb-quote' }, t('groupsLockedHint')),
          h(
            'div',
            { className: 'bb-inline' },
            h(Chip, { children: `${snap?.gate?.passed ?? 0}/${snap?.gate?.total ?? 6}`, tone: 'bad' }),
            h('button', { type: 'button', className: 'bb-btn primary', onClick: onGoGate }, t('goGate')),
          ),
        )
      }

      const groups = state?.group?.groups ?? []
      const roster = state?.roster ?? []
      const samples = ['笑死 你们听说了吗', '@我 在吗 出来冒个泡', '有人一起打游戏吗', '这瓜真的绝了']

      const feed = async () => {
        const payload = text.trim()
        if (!payload || busy) return
        setBusy(true)
        setError('')
        try {
          await request('/group/feed', {
            method: 'POST',
            body: JSON.stringify({ groupId, senderId, text: payload, atMe }),
          })
          setText('')
          await load()
          setTimeout(load, 3600)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }

      const reset = async () => {
        try {
          const payload = await request('/group/reset', { method: 'POST', body: '{}' })
          setState((prev) => ({ ...prev, group: payload.group }))
        } catch (err) {
          setError(err.message)
        }
      }

      return h(
        'div',
        { className: 'bb-stack' },
        h(
          Card,
          { title: t('groupsTitle'), hint: t('groupsHint') },
          h(
            'div',
            { className: 'bb-inline' },
            h(Chip, { children: `收到 ${state?.group?.stats?.received ?? 0}` }),
            h(Chip, { children: `进脑 ${state?.group?.stats?.escalated ?? 0}`, tone: 'on' }),
            h(Chip, { children: `本地丢弃 ${state?.group?.stats?.mutedIgnored ?? 0}` }),
            h(Chip, { children: `${t('debounce')} ${state?.group?.stats?.debounced ?? 0}` }),
            h(Chip, { children: `${t('transfer')} ${state?.group?.stats?.transfers ?? 0}`, tone: 'warn' }),
            h('span', { className: 'bb-muted' }, `精力 ${state?.energy ?? '—'} · 皮质醇 ${state?.cortisol ?? '—'}`),
            h('button', { type: 'button', className: 'bb-btn bb-btn--tiny', onClick: reset }, t('resetGroups')),
          ),
          h(
            'div',
            { className: 'bb-groups' },
            groups.map((group) =>
              h(
                'div',
                {
                  key: group.id,
                  className: `bb-group is-${group.layer}${group.id === groupId ? ' is-picked' : ''}`,
                  onClick: () => setGroupId(group.id),
                  role: 'button',
                  tabIndex: 0,
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') setGroupId(group.id)
                  },
                },
                h(
                  'div',
                  { className: 'bb-groupHead' },
                  h('span', { className: 'bb-groupName' }, group.name),
                  h(Chip, {
                    children: t(group.layer),
                    tone: group.layer === 'foveal' ? 'good' : group.layer === 'peripheral' ? 'on' : '',
                  }),
                ),
                h(
                  'div',
                  { className: 'bb-slotMeta' },
                  `${group.memberCount} 人 · ${group.unread} ${t('unread')}`,
                ),
                group.buffer.length
                  ? h('div', { className: 'bb-groupPreview' }, `${group.buffer.at(-1).senderName}：${group.buffer.at(-1).text}`)
                  : null,
              ),
            ),
          ),
          h(
            'div',
            { className: 'bb-feed' },
            h(
              'div',
              { className: 'bb-inline bb-inline--wrap' },
              h(
                'select',
                { className: 'bb-select', value: groupId, onChange: (event) => setGroupId(event.target.value) },
                groups.map((group) =>
                  h('option', { key: group.id, value: group.id }, `${group.name}（${t(group.layer)}）`),
                ),
              ),
              h(
                'select',
                { className: 'bb-select', value: senderId, onChange: (event) => setSenderId(event.target.value) },
                roster.map((member) =>
                  h('option', { key: member.id, value: member.id }, `${member.name}${member.tags.length ? ` · ${member.tags[0]}` : ''}`),
                ),
              ),
              h(
                'label',
                { className: 'bb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: atMe,
                  onChange: (event) => setAtMe(event.target.checked),
                }),
                t('atMe'),
              ),
            ),
            h(
              'div',
              { className: 'bb-compose' },
              h('input', {
                className: 'bb-input',
                value: text,
                placeholder: t('feed'),
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') void feed()
                },
              }),
              h('button', { type: 'button', className: 'bb-btn primary', disabled: busy, onClick: feed }, t('send')),
            ),
            h(
              'div',
              { className: 'bb-inline' },
              h('span', { className: 'bb-muted' }, `${t('samples')}：`),
              samples.map((sample) =>
                h(
                  'button',
                  { key: sample, type: 'button', className: 'bb-btn bb-btn--tiny', onClick: () => setText(sample) },
                  sample,
                ),
              ),
            ),
            error ? h('div', { className: 'bb-error' }, error) : null,
          ),
        ),
        h(
          Card,
          { title: t('decisions'), hint: t('noLlm') },
          h(
            'div',
            { className: 'bb-log' },
            (state?.group?.log ?? [])
              .slice()
              .reverse()
              .map((entry, index) =>
                h(
                  'div',
                  { key: `${entry.at}-${index}`, className: 'bb-logRow' },
                  h(
                    'div',
                    { className: 'bb-innerMeta' },
                    h('span', {}, clockOf(entry.at)),
                    h(Chip, { children: entry.kind, tone: entry.kind === 'transfer' ? 'warn' : entry.kind === 'brain' ? 'on' : '' }),
                    entry.group ? h('span', {}, entry.group) : null,
                  ),
                  entry.text ? h('div', { className: 'bb-logText' }, entry.text) : null,
                  entry.reason ? h('div', { className: 'bb-muted' }, entry.reason) : null,
                  entry.anchors?.length ? h('div', { className: 'bb-muted' }, `锚点：${entry.anchors.join('、')}`) : null,
                  entry.route ? h('div', { className: 'bb-muted' }, `路由 ${entry.route} · 内心：${entry.inner}`) : null,
                  entry.bubbles?.length ? h('div', { className: 'bb-logText' }, `外显：${entry.bubbles.join(' / ')}`) : null,
                ),
              ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 设置：每个认知逻辑各用一套模型                                        */
    /* ------------------------------------------------------------------ */

    /** 记忆半衰期文案：S 基准 60 天，滑到 0 时压缩到 ~8 分钟。 */
    function memoryLabel(v) {
      if (v >= 0.995) return '拉满：按当前设定衰减（近几年的强记忆还认得出来）'
      const days = 60 * Math.pow(10, (v - 1) * 4)
      if (days < 1 / 24) return `半衰期约 ${Math.max(1, Math.round(days * 24 * 60))} 分钟`
      if (days < 1) return `半衰期约 ${Math.round(days * 24)} 小时`
      return `半衰期约 ${days.toFixed(1)} 天`
    }

    function talkLabel(v) {
      if (v >= 0.995) return '拉满：想接就接（现在的样子）'
      return `两次回复至少隔 ${Math.round((1 - v) * 10)} 秒，点火阈值 +${((1 - v) * 0.15).toFixed(2)}`
    }

    // 六个认知模块各占一个配置槽；只有 wired: true 的那几个真的会调用模型
    const LOGIC_META = [
      { name: 'funnel', label: '注意力漏斗', hint: '群消息该不该进脑子：@我 / 叫名字 / 死党 / 兴趣词（规则扫描，暂不调模型）', wired: false },
      { name: 'ignition', label: '全局点火', hint: '显著性 vs 阈值 Θ 的比较（纯数学，不调模型）', wired: false },
      { name: 'appraisal', label: '情感评估', hint: '每次收到消息前，判断对方真实意图（可用便宜模型）', wired: true },
      { name: 'memory', label: '双系统记忆', hint: '凌晨 03:00 造梦、把碎片写成叙事', wired: true },
      { name: 'broca', label: '语言区', hint: '把神经状态翻译成气泡与内心独白（双轨 JSON）', wired: true },
      { name: 'feedback', label: '预期悬置', hint: '已读不回时的内耗独白（超时那一刻生成）', wired: true },
    ]

    function SettingsTab({ snap, t, act, busy }) {
      const cfg = snap.llmConfig ?? { profiles: [] }
      const snow = snap.snow ?? {}
      const [form, setForm] = useState({
        baseURL: cfg.baseURL ?? '',
        model: cfg.model ?? '',
        apiKey: '',
        profiles: Object.fromEntries(
          (cfg.profiles ?? []).map((item) => [
            item.name,
            { enabled: item.enabled !== false, baseURL: item.baseURL ?? '', model: item.model ?? '', apiKey: '' },
          ]),
        ),
        allowGroups: (snow.allowGroups ?? []).join(','),
        allowPrivate: Boolean(snow.allowPrivate),
        sendEnabled: Boolean(snow.sendEnabled),
      })
      const [saved, setSaved] = useState('')

      const set = (patch) => setForm((prev) => ({ ...prev, ...patch }))
      const setProfile = (name, patch) =>
        setForm((prev) => ({
          ...prev,
          profiles: { ...prev.profiles, [name]: { ...(prev.profiles[name] ?? {}), ...patch } },
        }))

      const save = async () => {
        setSaved('')
        const llm = {
          baseURL: form.baseURL,
          model: form.model,
          profiles: {},
        }
        if (form.apiKey) llm.apiKey = form.apiKey
        for (const meta of LOGIC_META) {
          const row = form.profiles[meta.name] ?? {}
          llm.profiles[meta.name] = {
            enabled: row.enabled !== false,
            baseURL: row.baseURL ?? '',
            model: row.model ?? '',
          }
          if (row.apiKey) llm.profiles[meta.name].apiKey = row.apiKey
        }
        await act('/settings', {
          llm,
          snowluma: {
            sendEnabled: form.sendEnabled,
            allowGroups: form.allowGroups
              .split(/[\s,，]+/)
              .map((item) => item.trim())
              .filter(Boolean),
            allowPrivate: form.allowPrivate,
          },
        })
        setForm((prev) => ({ ...prev, apiKey: '', profiles: Object.fromEntries(Object.entries(prev.profiles).map(([k, v]) => [k, { ...v, apiKey: '' }])) }))
        setSaved(t('saved'))
        setTimeout(() => setSaved(''), 2600)
      }

      return h(
        'div',
        { className: 'bb-stack' },
        h(
          Card,
          { title: t('settingsLlmTitle'), hint: t('settingsLlmHint') },
          h(Stat, { label: t('settingsModelSource'), value: `${snap.llmConfig?.useLlm ? t('llmOn') : t('llmOff')} · ${snap.llm?.provider || '—'}` }),
          h(
            'div',
            { className: 'bb-field' },
            h('label', {}, 'baseURL'),
            h('input', {
              className: 'bb-input',
              value: form.baseURL,
              placeholder: 'https://api.deepseek.com',
              onChange: (event) => set({ baseURL: event.target.value }),
            }),
          ),
          h(
            'div',
            { className: 'bb-field' },
            h('label', {}, 'model'),
            h('input', {
              className: 'bb-input',
              value: form.model,
              placeholder: 'deepseek-chat',
              onChange: (event) => set({ model: event.target.value }),
            }),
          ),
          h(
            'div',
            { className: 'bb-field' },
            h('label', {}, 'apiKey'),
            h('input', {
              className: 'bb-input',
              type: 'password',
              value: form.apiKey,
              placeholder: cfg.hasKey ? cfg.keyMask : 'sk-…（只存本机 settings.json）',
              onChange: (event) => set({ apiKey: event.target.value }),
            }),
          ),
          h('div', { className: 'bb-muted' }, t('settingsKeyHint')),
        ),
        h(
          Card,
          { title: t('settingsLogicTitle'), hint: t('settingsLogicHint') },
          LOGIC_META.map((meta) => {
            const row = form.profiles[meta.name] ?? {}
            const status = (cfg.profiles ?? []).find((item) => item.name === meta.name) ?? {}
            return h(
              'div',
              { key: meta.name, className: 'bb-logicRow' },
              h(
                'div',
                { className: 'bb-inline' },
                h('strong', { className: 'bb-logicName' }, meta.label),
                h(Chip, {
                  children: status.active ? status.source : 'local',
                  tone: status.active ? 'good' : '',
                }),
                status.resolvedModel ? h('span', { className: 'bb-muted' }, status.resolvedModel) : null,
              ),
              h('div', { className: 'bb-muted' }, meta.hint),
              h(
                'label',
                { className: 'bb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: row.enabled !== false,
                  onChange: (event) => setProfile(meta.name, { enabled: event.target.checked }),
                }),
                t('settingsUseOwn'),
              ),
              row.enabled !== false
                ? h(
                    'div',
                    { className: 'bb-logicGrid' },
                    h('input', {
                      className: 'bb-input',
                      value: row.baseURL ?? '',
                      placeholder: t('settingsInheritBase'),
                      onChange: (event) => setProfile(meta.name, { baseURL: event.target.value }),
                    }),
                    h('input', {
                      className: 'bb-input',
                      value: row.model ?? '',
                      placeholder: t('settingsInheritModel'),
                      onChange: (event) => setProfile(meta.name, { model: event.target.value }),
                    }),
                    h('input', {
                      className: 'bb-input',
                      type: 'password',
                      value: row.apiKey ?? '',
                      placeholder: status.hasKey ? status.keyMask : t('settingsInheritKey'),
                      onChange: (event) => setProfile(meta.name, { apiKey: event.target.value }),
                    }),
                  )
                : null,
            )
          }),
        ),
        h(
          Card,
          { title: 'snowluma', hint: t('settingsSnowHint') },
          h(
            'div',
            { className: 'bb-field' },
            h('label', {}, t('settingsAllowGroups')),
            h('input', {
              className: 'bb-input',
              value: form.allowGroups,
              placeholder: '576268399',
              onChange: (event) => set({ allowGroups: event.target.value }),
            }),
          ),
          h(
            'div',
            { className: 'bb-inline bb-inline--wrap' },
            h(
              'label',
              { className: 'bb-check' },
              h('input', {
                type: 'checkbox',
                checked: form.sendEnabled,
                onChange: (event) => set({ sendEnabled: event.target.checked }),
              }),
              t('settingsAllowSend'),
            ),
            h(
              'label',
              { className: 'bb-check' },
              h('input', {
                type: 'checkbox',
                checked: form.allowPrivate,
                onChange: (event) => set({ allowPrivate: event.target.checked }),
              }),
              t('settingsAllowPrivate'),
            ),
          ),
          h('div', { className: 'bb-muted' }, t('settingsSnowNote')),
        ),
        h(
          'div',
          { className: 'bb-actions' },
          h('button', { type: 'button', className: 'bb-btn primary', disabled: busy, onClick: save }, t('save')),
          saved ? h('span', { className: 'bb-chip good' }, saved) : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 验脑面板                                                            */
    /* ------------------------------------------------------------------ */

    function GateTab({ snap, t, onRefresh }) {
      const [gate, setGate] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      const run = async () => {
        setBusy(true)
        setError('')
        try {
          const payload = await request('/sandbox/run', { method: 'POST', body: '{}' })
          setGate(payload.gate)
          onRefresh?.()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }

      const report = gate
      const passed = report?.passed ?? snap?.gate?.passed ?? 0
      const total = report?.total ?? snap?.gate?.total ?? 6
      const unlocked = report?.phase2Unlocked ?? snap?.phase2?.unlocked ?? false

      return h(
        'div',
        { className: 'bb-stack' },
        h(
          Card,
          { title: t('gateTitle'), hint: t('gateHint') },
          h(
            'div',
            { className: 'bb-inline' },
            h(Chip, { children: `${passed}/${total}`, tone: unlocked ? 'good' : 'bad' }),
            h(Chip, { children: unlocked ? t('gateUnlocked') : t('gateLocked'), tone: unlocked ? 'good' : 'warn' }),
            report ? h('span', { className: 'bb-muted' }, `${report.durationMs}ms`) : null,
            h(
              'button',
              { type: 'button', className: 'bb-btn primary', disabled: busy, onClick: run },
              busy ? t('running') : t('runAll'),
            ),
          ),
          error ? h('div', { className: 'bb-error' }, error) : null,
          h('p', { className: 'bb-muted' }, t('gateHint')),
        ),
        (report?.results ?? []).map((item) =>
          h(
            'section',
            { key: item.id, className: `bb-gateCard${item.passed ? ' is-pass' : ' is-fail'}` },
            h(
              'header',
              { className: 'bb-groupHead' },
              h('span', { className: 'bb-cardTitle' }, `${item.id} · ${item.name}`),
              h(Chip, { children: item.passed ? t('passed') : t('failed'), tone: item.passed ? 'good' : 'bad' }),
              h('span', { className: 'bb-muted' }, item.law),
            ),
            h('p', { className: 'bb-muted' }, item.hypothesis),
            item.error ? h('pre', { className: 'bb-pre' }, item.error) : null,
            h(
              'div',
              { className: 'bb-metrics' },
              Object.entries(item.metrics ?? {}).map(([key, value]) =>
                h(
                  'div',
                  { key, className: 'bb-metric' },
                  h('span', { className: 'bb-metricKey' }, key),
                  h('span', { className: 'bb-metricValue' }, Array.isArray(value) ? value.join(' / ') : String(value)),
                ),
              ),
            ),
            h(
              'details',
              { className: 'bb-details' },
              h('summary', {}, t('steps')),
              h('ol', { className: 'bb-steps' }, (item.steps ?? []).map((step, index) => h('li', { key: index }, step))),
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 输入框下方的常驻状态条（也是主面板打不开时的备用入口）                 */
    /* ------------------------------------------------------------------ */

    function BibaoStrip(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [snap, setSnap] = useState(null)
      const [failed, setFailed] = useState('')

      useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const payload = await request('/state')
            if (alive) {
              setSnap(payload)
              setFailed('')
            }
          } catch (error) {
            if (alive) setFailed(error.message)
          }
        }
        void load()
        const timer = setInterval(load, 15_000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      const cortisol = snap?.neuro?.hormones?.find((item) => item.key === 'cortisol')?.value
      return h(
        'div',
        { className: 'bb-strip' },
        h('span', { className: 'bb-stripMark' }, h(BibaoIcon, { size: 16 })),
        h('span', { className: 'bb-stripName' }, t('nav')),
        failed
          ? h('span', { className: 'bb-stripMeta' }, `${t('failedLoad')}：${failed}`)
          : h(
              'span',
              { className: 'bb-stripMeta' },
              snap
                ? `${snap.neuro.moodLabel} · 皮质醇 ${pct(cortisol ?? 0)} · ${t('clock')} ${snap.clock.label}`
                : t('waking'),
            ),
        h(
          'button',
          {
            type: 'button',
            className: 'bb-stripBtn',
            onClick: () => props.open?.(),
          },
          t('openPanel'),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 主面板                                                              */
    /* ------------------------------------------------------------------ */

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error) {
          return h(
            'div',
            { className: 'bb-card' },
            h('div', { className: 'bb-error' }, `${this.props.label ?? ''} ${this.props.crashLabel ?? 'render failed'}`),
            h('pre', { className: 'bb-pre' }, String(this.state.error?.stack ?? this.state.error)),
          )
        }
        return this.props.children
      }
    }

    function BibaoPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      // initialSnapshot / initialTab 只服务于离线渲染冒烟与设计预览，正常挂载时不传
      const [snap, setSnap] = useState(props.initialSnapshot ?? null)
      const [tab, setTab] = useState(props.initialTab ?? 'brain')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState('')
      const alive = useRef(true)

      const refresh = useCallback(async () => {
        try {
          const payload = await request('/state')
          if (alive.current) {
            setSnap(payload)
            setError('')
          }
        } catch (err) {
          if (alive.current) setError(`${t('failedLoad')}：${err.message}`)
        }
      }, [t])

      useEffect(() => {
        alive.current = true
        if (props.surface === 'main') {
          mainMountedAt = Date.now()
          beacon('panel-mounted')
          const beat = setInterval(() => {
            mainMountedAt = Date.now()
          }, 1500)
          return () => {
            alive.current = false
            clearInterval(beat)
          }
        }
        return () => {
          alive.current = false
        }
      }, [props.surface])

      useEffect(() => {
        alive.current = true
        void refresh()
        const timer = setInterval(refresh, 3500)
        return () => {
          alive.current = false
          clearInterval(timer)
        }
      }, [refresh])

      const flash = (message) => {
        setToast(message)
        setTimeout(() => setToast(''), 2600)
      }

      const act = async (path, body) => {
        setBusy(true)
        try {
          await request(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
          await refresh()
          flash(
            path === '/tick' ? t('ticked') : path === '/sleep' ? t('slept') : path === '/reset' ? t('resetDone') : t('ok'),
          )
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }

      if (!snap) {
        return h(
          'div',
          { className: 'bb-panel' },
          h(
            'div',
            { className: 'bb-empty' },
            h('div', { className: 'bb-emptyMark' }, h(BibaoIcon, { size: 34 })),
            h('p', { className: 'bb-emptyTitle' }, error ? t('failedLoad') : t('waking')),
            error ? h('pre', { className: 'bb-pre' }, error) : null,
            h('p', { className: 'bb-muted' }, `API ${API} · ${window.location.origin}`),
            h(
              'button',
              { type: 'button', className: 'bb-btn', onClick: () => void refresh() },
              t('retry'),
            ),
          ),
        )
      }

      const tabs = [
        ['brain', t('tabBrain')],
        ['talk', t('tabTalk')],
        ['memory', t('tabMemory')],
        ['groups', t('tabGroups')],
        ['gate', t('tabGate')],
        ['settings', t('tabSettings')],
      ]

      return h(
        'div',
        { className: 'bb-panel' },
        h(
          Boundary,
          { label: t('crash'), crashLabel: t('crash') },
          h(
            'header',
            { className: 'bb-head' },
            h('div', { className: 'bb-mark' }, h(BibaoIcon, { size: 30 })),
            h(
              'div',
              { className: 'bb-heroText' },
              h('h1', { className: 'bb-title' }, snap.identity.name),
              h('p', { className: 'bb-sub' }, snap.identity.oneLine || t('subtitle')),
            ),
            h(
              'div',
              { className: 'bb-chips' },
              h(Chip, { children: t('phase1'), tone: 'on' }),
              h(Chip, { children: `${t('clock')} ${snap.clock.label}` }),
              h(Chip, {
                children: `${snap.neuro.moodLabel} · 皮质醇 ${pct(snap.neuro.hormones.find((item) => item.key === 'cortisol')?.value ?? 0)}`,
                tone: snap.workspace.hijacked ? 'bad' : '',
              }),
              h(Chip, {
                children: snap.llm.enabled ? t('llmOn') : t('llmOff'),
                tone: snap.llm.enabled ? 'good' : '',
              }),
            ),
          ),
          error ? h('div', { className: 'bb-error' }, error) : null,
          h(
            'nav',
            { className: 'bb-tabs', role: 'tablist' },
            tabs.map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': tab === key,
                  className: `bb-tab${tab === key ? ' is-active' : ''}`,
                  onClick: () => setTab(key),
                },
                label,
              ),
            ),
          ),
          h(
            Boundary,
            { key: tab, label: t('crash'), crashLabel: t('crash') },
            tab === 'brain' ? h(BrainTab, { snap, t, act, busy }) : null,
            tab === 'talk' ? h(TalkTab, { snap, t }) : null,
            tab === 'memory' ? h(MemoryTab, { snap, t, refresh }) : null,
            tab === 'groups' ? h(GroupsTab, { snap, t, onGoGate: () => setTab('gate') }) : null,
            tab === 'gate' ? h(GateTab, { snap, t, onRefresh: refresh }) : null,
            tab === 'settings' ? h(SettingsTab, { snap, t, act, busy }) : null,
          ),
          toast ? h('div', { className: 'bb-toast', role: 'status' }, toast) : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 设置页（class 组件，刻意不用 hooks：DSH 里 React 是双副本）             */
    /* ------------------------------------------------------------------ */

    const BIO_IMPACT_KEYS = ['self_worth', 'world_trust', 'attachment_anxiety', 'conflict_avoidance', 'autonomy_need', 'fairness']

    function Field({ label, children }) {
      return h('label', { className: 'bb-field' }, h('span', {}, label), children)
    }

    class BibaoSettingsPanel extends React.Component {
      constructor(props) {
        super(props)
        this.state = {
          snap: null,
          error: '',
          note: '',
          section: 'model',
          loading: true,
          bio: null,
          bioDirty: false,
          form: {
            baseURL: '',
            model: '',
            apiKey: '',
            profiles: {},
            httpBase: '',
            httpToken: '',
            wsUrl: '',
            wsToken: '',
            allowGroups: '',
            allowPrivate: false,
            sendEnabled: false,
            tuning: { memoryStrength: 1, talkativeness: 1 },
          },
        }
        this.load = this.load.bind(this)
        this.loadBio = this.loadBio.bind(this)
        this.save = this.save.bind(this)
        this.set = this.set.bind(this)
        this.setProfile = this.setProfile.bind(this)
        this.syncForm = this.syncForm.bind(this)
        this.updateEvent = this.updateEvent.bind(this)
        this.saveBio = this.saveBio.bind(this)
      }

      componentDidMount() {
        this.alive = true
        this.load()
        this.timer = setInterval(this.load, 6000)
      }

      componentWillUnmount() {
        this.alive = false
        clearInterval(this.timer)
      }

      syncForm(snap) {
        const cfg = snap.llmConfig ?? {}
        const snow = snap.snow ?? {}
        const profiles = {}
        for (const item of cfg.profiles ?? []) {
          profiles[item.name] = {
            enabled: item.enabled !== false,
            baseURL: item.baseURL ?? '',
            model: item.model ?? '',
            apiKey: '',
          }
        }
        this.setState((prev) => ({
          form: {
            ...prev.form,
            baseURL: cfg.baseURL ?? '',
            model: cfg.model ?? '',
            profiles,
            httpBase: snow.httpBase || prev.form.httpBase,
            wsUrl: snow.wsUrl || prev.form.wsUrl,
            allowGroups: (snow.allowGroups ?? []).join(','),
            allowPrivate: Boolean(snow.allowPrivate),
            sendEnabled: Boolean(snow.sendEnabled),
            tuning: { ...(snap.tuning ?? { memoryStrength: 1, talkativeness: 1 }) },
          },
        }))
      }

      async load() {
        try {
          const snap = await request('/state')
          if (!this.alive) return
          const first = !this.state.snap
          this.setState({ snap, error: '', loading: false })
          if (first) this.syncForm(snap)
        } catch (error) {
          if (this.alive) this.setState({ error: `读取失败：${error.message}`, loading: false })
        }
      }

      async loadBio() {
        try {
          const bio = await request('/biography')
          if (this.alive) this.setState({ bio, bioDirty: false })
        } catch (error) {
          if (this.alive) this.setState({ error: `读取传记失败：${error.message}` })
        }
      }

      set(patch) {
        this.setState((prev) => ({ form: { ...prev.form, ...patch } }))
      }

      setProfile(name, patch) {
        this.setState((prev) => ({
          form: {
            ...prev.form,
            profiles: { ...prev.form.profiles, [name]: { ...(prev.form.profiles[name] ?? {}), ...patch } },
          },
        }))
      }

      async save() {
        const { form } = this.state
        this.setState({ saving: '保存中…', note: '' })
        const llm = {
          baseURL: form.baseURL,
          model: form.model,
          profiles: {},
        }
        if (form.apiKey) llm.apiKey = form.apiKey
        for (const meta of LOGIC_META) {
          const row = form.profiles[meta.name] ?? {}
          llm.profiles[meta.name] = {
            enabled: row.enabled !== false,
            baseURL: row.baseURL ?? '',
            model: row.model ?? '',
          }
          if (row.apiKey) llm.profiles[meta.name].apiKey = row.apiKey
        }
        const snowluma = {
          sendEnabled: form.sendEnabled,
          allowPrivate: form.allowPrivate,
          allowGroups: form.allowGroups.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean),
          httpBase: form.httpBase,
          wsUrl: form.wsUrl,
        }
        if (form.httpToken) snowluma.httpToken = form.httpToken
        if (form.wsToken) snowluma.wsToken = form.wsToken
        try {
          const data = await request('/settings', {
            method: 'POST',
            body: JSON.stringify({ llm, snowluma, tuning: form.tuning }),
          })
          this.setState({ snap: data.snapshot, saving: '', note: '已保存', apiKey: '' })
          this.syncForm(data.snapshot)
          setTimeout(() => this.alive && this.setState({ note: '' }), 2400)
        } catch (error) {
          this.setState({ saving: '', error: `保存失败：${error.message}` })
        }
      }

      updateEvent(index, patch) {
        this.setState((prev) => {
          const events = prev.bio.events.map((event, i) => (i === index ? { ...event, ...patch } : event))
          return { bio: { ...prev.bio, events }, bioDirty: true }
        })
      }

      async saveBio() {
        const { bio } = this.state
        if (!bio) return
        this.setState({ note: '重建中…' })
        try {
          const data = await request('/biography', {
            method: 'POST',
            body: JSON.stringify({
              name: bio.name,
              fullName: bio.fullName,
              ageNow: bio.ageNow,
              oneLine: bio.oneLine,
              coreWound: bio.coreWound,
              copingStyle: bio.copingStyle,
              events: bio.events,
              relations: bio.relations,
            }),
          })
          this.setState({ snap: data.snapshot, bioDirty: false, note: '已按新的人生重建' })
          setTimeout(() => this.alive && this.setState({ note: '' }), 2600)
        } catch (error) {
          this.setState({ note: '' , error: `保存传记失败：${error.message}` })
        }
      }

      render() {
        const { snap, error, note, section, form, bio, loading, saving } = this.state
        const t = typeof this.props.t === 'function' ? this.props.t : (key) => key
        const tabs = [
          ['model', '模型与 Key'],
          ['snow', 'snowluma'],
          ['bio', '过去的经历'],
        ]
        const snow = snap?.snow ?? {}
        return h(
          'div',
          { className: 'bb-settings' },
          h(
            'header',
            { className: 'bb-setHead' },
            h('div', { className: 'bb-mark' }, h(BibaoIcon, { size: 26 })),
            h(
              'div',
              { className: 'bb-heroText' },
              h('h1', { className: 'bb-title' }, '比宝'),
              h('p', { className: 'bb-sub' }, snap ? snap.identity.oneLine : loading ? '正在唤醒…' : '未连接'),
            ),
            h(
              'div',
              { className: 'bb-chips' },
              snap ? h(Chip, { children: `${snap.identity.age} 岁 · ${snap.clock.label}` }) : null,
              snow.connected
                ? h(Chip, { children: `QQ 在线 · ${snow.selfName || snow.selfId}`, tone: 'good' })
                : h(Chip, { children: 'QQ 离线', tone: 'bad' }),
              snow.sendEnabled ? h(Chip, { children: '允许发送', tone: 'warn' }) : h(Chip, { children: '只读' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'bb-btn bb-btn--tiny',
                  onClick: () => {
                    const url = snap?.console?.url
                    if (url) window.open(url, '_blank', 'noopener')
                  },
                },
                '打开控制台',
              ),
            ),
          ),
          h(
            'nav',
            { className: 'bb-setTabs' },
            tabs.map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  className: `bb-tab${section === key ? ' is-active' : ''}`,
                  onClick: () => {
                    this.setState({ section: key })
                    if (key === 'bio' && !this.state.bio) this.loadBio()
                  },
                },
                label,
              ),
            ),
          ),
          error ? h('div', { className: 'bb-error' }, error) : null,
          note ? h('div', { className: 'bb-chip good' }, note) : null,

          section === 'model'
            ? h(
                'section',
                { className: 'bb-card' },
                h('div', { className: 'bb-cardTitle' }, '默认模型'),
                h(Field, { label: 'baseURL' }, h('input', { className: 'bb-input', value: form.baseURL, placeholder: 'https://api.deepseek.com', onChange: (e) => this.set({ baseURL: e.target.value }) })),
                h(Field, { label: 'model' }, h('input', { className: 'bb-input', value: form.model, placeholder: 'deepseek-chat', onChange: (e) => this.set({ model: e.target.value }) })),
                h(Field, { label: 'apiKey' }, h('input', { className: 'bb-input', type: 'password', value: form.apiKey, placeholder: snap?.llmConfig?.hasKey ? `${snap.llmConfig.keyMask}（留空不变）` : '留空 = 用 DSH 默认模型', onChange: (e) => this.set({ apiKey: e.target.value }) })),
                h('div', { className: 'bb-muted' }, '每个逻辑可以各用一套；留空就继承上面的默认'),
                LOGIC_META.map((meta) => {
                  const row = form.profiles[meta.name] ?? {}
                  const status = (snap?.llmConfig?.profiles ?? []).find((item) => item.name === meta.name) ?? {}
                  return h(
                    'div',
                    { key: meta.name, className: 'bb-logicRow' },
                    h('div', { className: 'bb-inline' },
                      h('strong', { className: 'bb-logicName' }, meta.label),
                      h(Chip, { children: status.active ? status.source : 'local', tone: status.active ? 'good' : '' }),
                      h('label', { className: 'bb-check' },
                        h('input', { type: 'checkbox', checked: row.enabled !== false, onChange: (e) => this.setProfile(meta.name, { enabled: e.target.checked }) }),
                        '独立配置',
                      ),
                    ),
                    h('div', { className: 'bb-muted' }, meta.hint),
                    row.enabled !== false
                      ? h('div', { className: 'bb-logicGrid' },
                          h('input', { className: 'bb-input', value: row.baseURL ?? '', placeholder: '继承 baseURL', onChange: (e) => this.setProfile(meta.name, { baseURL: e.target.value }) }),
                          h('input', { className: 'bb-input', value: row.model ?? '', placeholder: '继承 model', onChange: (e) => this.setProfile(meta.name, { model: e.target.value }) }),
                          h('input', { className: 'bb-input', type: 'password', value: row.apiKey ?? '', placeholder: status.hasKey ? `${status.keyMask}（留空不变）` : '继承 apiKey', onChange: (e) => this.setProfile(meta.name, { apiKey: e.target.value }) }),
                        )
                      : null,
                  )
                }),
                h('button', { type: 'button', className: 'bb-btn primary', disabled: Boolean(saving), onClick: this.save }, '保存'),
              )
            : null,

          section === 'snow'
            ? h(
                'section',
                { className: 'bb-card' },
                h('div', { className: 'bb-cardTitle' }, 'snowluma OneBot 连接'),
                h(Field, { label: 'HTTP' }, h('input', { className: 'bb-input', value: form.httpBase, placeholder: 'http://127.0.0.1:3000', onChange: (e) => this.set({ httpBase: e.target.value }) })),
                h(Field, { label: 'HTTP token' }, h('input', { className: 'bb-input', type: 'password', value: form.httpToken, placeholder: snow.hasHttpToken ? '已有 token（留空不变）' : 'HTTP accessToken', onChange: (e) => this.set({ httpToken: e.target.value }) })),
                h(Field, { label: 'WS' }, h('input', { className: 'bb-input', value: form.wsUrl, placeholder: 'ws://127.0.0.1:3001/', onChange: (e) => this.set({ wsUrl: e.target.value }) })),
                h(Field, { label: 'WS token' }, h('input', { className: 'bb-input', type: 'password', value: form.wsToken, placeholder: snow.hasWsToken ? '已有 token（留空不变）' : 'WS accessToken', onChange: (e) => this.set({ wsToken: e.target.value }) })),
                h(Field, { label: '允许群' }, h('input', { className: 'bb-input', value: form.allowGroups, placeholder: '576268399', onChange: (e) => this.set({ allowGroups: e.target.value }) })),
                h('div', { className: 'bb-inline bb-inline--wrap' },
                  h('label', { className: 'bb-check' },
                    h('input', { type: 'checkbox', checked: form.sendEnabled, onChange: (e) => this.set({ sendEnabled: e.target.checked }) }),
                    '允许真的发到 QQ',
                  ),
                  h('label', { className: 'bb-check' },
                    h('input', { type: 'checkbox', checked: form.allowPrivate, onChange: (e) => this.set({ allowPrivate: e.target.checked }) }),
                    '允许私聊',
                  ),
                ),
                h('div', { className: 'bb-muted' }, snow.reason || '白名单为空 = 谁都不理'),
                h('button', { type: 'button', className: 'bb-btn primary', disabled: Boolean(saving), onClick: this.save }, '保存并重连'),
              )
            : null,

          section === 'bio'
            ? h(
                'section',
                { className: 'bb-card' },
                h('div', { className: 'bb-cardTitle' }, '过去的经历'),
                h('div', { className: 'bb-muted' }, '改完保存会按新的人生重新出生（当前情绪与近期记忆会重置）'),
                !bio
                  ? h('button', { type: 'button', className: 'bb-btn', onClick: this.loadBio }, '载入传记')
                  : h(
                      'div',
                      { className: 'bb-bio' },
                      h(Field, { label: '名字' }, h('input', { className: 'bb-input', value: bio.name ?? '', onChange: (e) => this.setState({ bio: { ...bio, name: e.target.value }, bioDirty: true }) })),
                      h(Field, { label: '一句话' }, h('input', { className: 'bb-input', value: bio.oneLine ?? '', onChange: (e) => this.setState({ bio: { ...bio, oneLine: e.target.value }, bioDirty: true }) })),
                      h(Field, { label: '核心创伤' }, h('input', { className: 'bb-input', value: bio.coreWound ?? '', onChange: (e) => this.setState({ bio: { ...bio, coreWound: e.target.value }, bioDirty: true }) })),
                      (bio.events ?? []).map((event, index) =>
                        h(
                          'div',
                          { key: index, className: 'bb-bioRow' },
                          h('div', { className: 'bb-inline' },
                            h('input', { className: 'bb-input bb-bioAge', type: 'number', step: '0.1', value: event.age, onChange: (e) => this.updateEvent(index, { age: Number(e.target.value) }) }),
                            h('input', { className: 'bb-input', value: event.title ?? '', placeholder: '标题', onChange: (e) => this.updateEvent(index, { title: e.target.value }) }),
                            h('button', { type: 'button', className: 'bb-btn bb-btn--tiny', onClick: () => this.setState({ bio: { ...bio, events: bio.events.filter((_, i) => i !== index) }, bioDirty: true }) }, '删'),
                          ),
                          h('textarea', { className: 'bb-textarea', rows: 2, value: event.narrative ?? '', onChange: (e) => this.updateEvent(index, { narrative: e.target.value }) }),
                          h('div', { className: 'bb-inline bb-inline--wrap' },
                            h('span', { className: 'bb-muted' }, '效价'),
                            h('input', { className: 'bb-input bb-bioNum', type: 'number', step: '0.1', min: '-1', max: '1', value: event.valence, onChange: (e) => this.updateEvent(index, { valence: Number(e.target.value) }) }),
                            h('span', { className: 'bb-muted' }, '唤醒'),
                            h('input', { className: 'bb-input bb-bioNum', type: 'number', step: '0.1', min: '0', max: '1', value: event.arousal, onChange: (e) => this.updateEvent(index, { arousal: Number(e.target.value) }) }),
                            h('span', { className: 'bb-muted' }, '影响'),
                            BIO_IMPACT_KEYS.map((key) =>
                              h('input', {
                                key,
                                className: 'bb-input bb-bioNum',
                                type: 'number',
                                step: '0.01',
                                title: key,
                                value: event.impact?.[key] ?? 0,
                                onChange: (e) =>
                                  this.updateEvent(index, {
                                    impact: { ...(event.impact ?? {}), [key]: Number(e.target.value) },
                                  }),
                              }),
                            ),
                          ),
                        ),
                      ),
                      h('div', { className: 'bb-actions' },
                        h('button', {
                          type: 'button',
                          className: 'bb-btn',
                          onClick: () =>
                            this.setState({
                              bio: {
                                ...bio,
                                events: [
                                  ...(bio.events ?? []),
                                  { age: (bio.events?.at(-1)?.age ?? 0) + 1, title: '新的事件', narrative: '', valence: 0, arousal: 0.4, impact: {}, tags: [] },
                                ],
                              },
                              bioDirty: true,
                            }),
                        }, '加一个事件'),
                        h('button', { type: 'button', className: 'bb-btn primary', disabled: !this.state.bioDirty, onClick: this.saveBio }, '保存并重建'),
                      ),
                    ),
              )
            : null,
        )
      }
    }

    /**
     * 兜底抽屉：点侧边栏图标后，如果主面板 1.8 秒内没有任何心跳，
     * 就用悬浮层把同一套面板画出来——主面板正常时它什么都不做。
     */
    function BibaoOverlay(props) {
      const usePanelInfo = props.usePanelInfo
      const active =
        typeof usePanelInfo === 'function' ? usePanelInfo((info) => info.activePanelId === PANEL_ID) : false
      const [show, setShow] = useState(false)

      useEffect(() => {
        if (!active) {
          setShow(false)
          return undefined
        }
        const timer = setTimeout(() => {
          setShow(Date.now() - mainMountedAt > 2500)
        }, 1800)
        return () => clearTimeout(timer)
      }, [active])

      if (!active || !show) return null
      const t = typeof props.t === 'function' ? props.t : (key) => key
      return h(
        'div',
        { className: 'bb-drawer' },
        h(
          'div',
          { className: 'bb-drawerBar' },
          h('span', { className: 'bb-drawerTitle' }, h(BibaoIcon, { size: 16 }), t('nav')),
          h(
            'button',
            { type: 'button', className: 'bb-btn bb-btn--tiny', onClick: () => props.close?.() },
            t('close'),
          ),
        ),
        h('div', { className: 'bb-drawerBody' }, h(BibaoPanel, { t, initialTab: 'brain', surface: 'drawer' })),
      )
    }

    /* ------------------------------------------------------------------ */
    /* 样式                                                                */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* 主面板（class 组件：DSH 里 hooks 不可用，只能用 setState）             */
    /* ------------------------------------------------------------------ */

    class BibaoMindPanel extends React.Component {
      constructor(props) {
        super(props)
        this.state = {
          snap: null,
          tab: 'brain',
          error: '',
          busy: false,
          toast: '',
          draft: '',
          messages: [],
          typing: false,
          showInner: true,
          asId: 'owner',
          memTier: 'all',
          memData: null,
          recall: null,
          group: null,
          groupDraft: '',
          groupId: 'g_class',
          groupSender: '44719023',
          groupAtMe: false,
          gate: null,
          gateBusy: false,
          bio: null,
          bioDirty: false,
          note: '',
          saving: '',
          form: null,
        }
        this.timers = []
        this.load = this.load.bind(this)
        this.act = this.act.bind(this)
        this.flash = this.flash.bind(this)
        this.renderBrain = this.renderBrain.bind(this)
        this.renderTalk = this.renderTalk.bind(this)
        this.renderMemory = this.renderMemory.bind(this)
        this.renderGroups = this.renderGroups.bind(this)
        this.renderGate = this.renderGate.bind(this)
        this.renderSettings = this.renderSettings.bind(this)
        this.sendTalk = this.sendTalk.bind(this)
        this.loadMemory = this.loadMemory.bind(this)
        this.loadGroups = this.loadGroups.bind(this)
        this.feedGroup = this.feedGroup.bind(this)
        this.setGroupLayer = this.setGroupLayer.bind(this)
        this.runGate = this.runGate.bind(this)
        this.loadBio = this.loadBio.bind(this)
        this.saveBio = this.saveBio.bind(this)
        this.saveSettings = this.saveSettings.bind(this)
        this.syncForm = this.syncForm.bind(this)
        this.setField = this.setField.bind(this)
        this.setProfile = this.setProfile.bind(this)
      }

      componentDidMount() {
        this.alive = true
        this.load()
        this.timer = setInterval(this.load, 4000)
      }

      componentWillUnmount() {
        this.alive = false
        clearInterval(this.timer)
        for (const timer of this.timers) clearTimeout(timer)
      }

      t() {
        return typeof this.props.t === 'function' ? this.props.t : (key) => key
      }

      async load() {
        try {
          const snap = await request('/state')
          if (!this.alive) return
          const first = !this.state.snap
          this.setState({ snap, error: '' })
          if (first) this.syncForm(snap)
          if (first && this.state.tab === 'groups') this.loadGroups()
        } catch (error) {
          if (this.alive) this.setState({ error: `${this.t()('failedLoad')}：${error.message}` })
        }
      }

      async act(path, body) {
        this.setState({ busy: true })
        try {
          const data = await request(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
          await this.load()
          this.flash(path === '/tick' ? '生物钟已推进' : path === '/sleep' ? '睡眠归纳完成' : '完成')
          if (data?.snapshot) this.setState({ snap: data.snapshot })
        } catch (error) {
          this.setState({ error: error.message })
        } finally {
          this.setState({ busy: false })
        }
      }

      flash(message) {
        this.setState({ toast: message })
        setTimeout(() => this.alive && this.setState({ toast: '' }), 2400)
      }

      syncForm(snap) {
        const cfg = snap.llmConfig ?? {}
        const snow = snap.snow ?? {}
        const profiles = {}
        for (const item of cfg.profiles ?? []) {
          profiles[item.name] = { enabled: item.enabled !== false, baseURL: item.baseURL ?? '', model: item.model ?? '', apiKey: '' }
        }
        this.setState({
          form: {
            baseURL: cfg.baseURL ?? '',
            model: cfg.model ?? '',
            apiKey: '',
            profiles,
            httpBase: snow.httpBase || '',
            httpToken: '',
            wsUrl: snow.wsUrl || '',
            wsToken: '',
            allowGroups: (snow.allowGroups ?? []).join(','),
            allowPrivate: Boolean(snow.allowPrivate),
            sendEnabled: Boolean(snow.sendEnabled),
          },
        })
      }

      setField(patch) {
        this.setState((prev) => ({ form: { ...prev.form, ...patch } }))
      }

      setProfile(name, patch) {
        this.setState((prev) => ({
          form: {
            ...prev.form,
            profiles: { ...prev.form.profiles, [name]: { ...(prev.form.profiles[name] ?? {}), ...patch } },
          },
        }))
      }

      async sendTalk() {
        const text = this.state.draft.trim()
        if (!text || this.state.typing) return
        const t = this.t()
        const asId = this.state.asId
        const owner = (this.state.snap?.social ?? []).find((item) => item.id === asId)
        const id = `m${Date.now()}`
        this.setState((prev) => ({
          draft: '',
          typing: true,
          messages: [...prev.messages, { id: `${id}-me`, role: 'me', bubbles: [text] }],
        }))
        try {
          const data = await request('/talk', {
            method: 'POST',
            body: JSON.stringify({ text, entityId: asId, entityName: owner?.name ?? '你' }),
          })
          const result = data.result
          if (!result.ignited) {
            this.setState((prev) => ({
              typing: false,
              snap: data.snapshot,
              messages: [
                ...prev.messages,
                { id, role: 'bibao', bubbles: [], note: `${t('noIgnite')}：${result.reason}` },
              ],
            }))
            return
          }
          const reply = {
            id,
            role: 'bibao',
            bubbles: [],
            inner: result.dual?.inner_monologue,
            route: result.dual?.action_route,
            pe: result.pe,
            salience: result.salience,
            budget: result.budget,
            source: result.dual?.meta?.source,
            regret: Boolean(result.dual?.trigger_regret_recall),
          }
          this.setState((prev) => ({ messages: [...prev.messages, reply], snap: data.snapshot }))
          const motor = result.motor ?? []
          if (!motor.length) {
            this.setState((prev) => ({
              typing: false,
              messages: prev.messages.map((item) => (item.id === id ? { ...item, note: `（${reply.route}：压住不发）` } : item)),
            }))
          }
          motor.forEach((step, index) => {
            const timer = setTimeout(() => {
              if (!this.alive) return
              this.setState((prev) => ({
                typing: index === motor.length - 1 ? false : prev.typing,
                messages: prev.messages.map((item) =>
                  item.id === id ? { ...item, bubbles: [...item.bubbles, step.text] } : item,
                ),
              }))
              if (reply.regret && index === motor.length - 1) {
                const recallTimer = setTimeout(() => {
                  if (!this.alive) return
                  this.setState((prev) => ({
                    messages: prev.messages.map((item) => (item.id === id ? { ...item, recalled: true } : item)),
                  }))
                }, 3600)
                this.timers.push(recallTimer)
              }
            }, 360 + step.delayMs)
            this.timers.push(timer)
          })
        } catch (error) {
          this.setState({ typing: false, error: error.message })
        }
      }

      async loadMemory(tier = this.state.memTier) {
        try {
          const data = await request(`/memory?tier=${tier}&limit=60`)
          if (this.alive) this.setState({ memData: data, memTier: tier })
        } catch (error) {
          if (this.alive) this.setState({ error: error.message })
        }
      }

      async loadGroups() {
        try {
          const data = await request('/group/state')
          if (this.alive) this.setState({ group: data })
        } catch (error) {
          if (this.alive) this.setState({ error: error.message })
        }
      }

      async setGroupLayer(groupId, layer) {
        try {
          const data = await request('/group/layer', {
            method: 'POST',
            body: JSON.stringify({ groupId, layer }),
          })
          this.setState((prev) => ({ group: { ...prev.group, group: data.group } }))
        } catch (error) {
          this.setState({ error: error.message })
        }
      }

      async feedGroup() {
        const text = this.state.groupDraft.trim()
        if (!text) return
        try {
          await request('/group/feed', {
            method: 'POST',
            body: JSON.stringify({
              groupId: this.state.groupId,
              senderId: this.state.groupSender,
              text,
              atMe: this.state.groupAtMe,
            }),
          })
          this.setState({ groupDraft: '' })
          await this.loadGroups()
          setTimeout(() => this.alive && this.loadGroups(), 3600)
        } catch (error) {
          this.setState({ error: error.message })
        }
      }

      async runGate() {
        this.setState({ gateBusy: true })
        try {
          const data = await request('/sandbox/run', { method: 'POST', body: '{}' })
          this.setState({ gate: data.gate })
        } catch (error) {
          this.setState({ error: error.message })
        } finally {
          this.setState({ gateBusy: false })
        }
      }

      async loadBio() {
        try {
          const bio = await request('/biography')
          if (this.alive) this.setState({ bio, bioDirty: false })
        } catch (error) {
          this.setState({ error: error.message })
        }
      }

      async saveBio() {
        const bio = this.state.bio
        if (!bio) return
        this.setState({ note: '重建中…' })
        try {
          const data = await request('/biography', {
            method: 'POST',
            body: JSON.stringify({
              name: bio.name,
              fullName: bio.fullName,
              ageNow: bio.ageNow,
              oneLine: bio.oneLine,
              coreWound: bio.coreWound,
              copingStyle: bio.copingStyle,
              events: bio.events,
              relations: bio.relations,
            }),
          })
          this.setState({ snap: data.snapshot, bioDirty: false, note: '已按新的人生重建' })
        } catch (error) {
          this.setState({ note: '', error: `保存传记失败：${error.message}` })
        }
      }

      async testWs() {
        const { form } = this.state
        this.setState({ note: '正在试连 WS…' })
        try {
          const data = await request('/snowluma/test-ws', {
            method: 'POST',
            body: JSON.stringify({ wsUrl: form.wsUrl, wsToken: form.wsToken }),
          })
          this.setState({ note: data.ok ? `WS 通了：${data.wsUrl}` : `WS 失败：${data.error}（${data.wsUrl}）` })
        } catch (error) {
          this.setState({ note: `测试失败：${error.message}` })
        }
      }

      /** 拖完滑块 350ms 自动保存，避免每一格都打一次接口。 */
      queueTuningSave(tuning) {
        if (this.tuningTimer) clearTimeout(this.tuningTimer)
        this.tuningTimer = setTimeout(async () => {
          try {
            const data = await request('/settings', { method: 'POST', body: JSON.stringify({ tuning }) })
            if (this.alive) this.setState({ snap: data.snapshot })
          } catch (error) {
            if (this.alive) this.setState({ error: error.message })
          }
        }, 350)
      }

      async saveSettings() {
        const { form } = this.state
        if (this.tuningTimer) {
          clearTimeout(this.tuningTimer)
          this.tuningTimer = null
        }
        this.setState({ saving: '保存中…' })
        const llm = { baseURL: form.baseURL, model: form.model, profiles: {} }
        if (form.apiKey) llm.apiKey = form.apiKey
        for (const meta of LOGIC_META) {
          const row = form.profiles[meta.name] ?? {}
          llm.profiles[meta.name] = { enabled: row.enabled !== false, baseURL: row.baseURL ?? '', model: row.model ?? '' }
          if (row.apiKey) llm.profiles[meta.name].apiKey = row.apiKey
        }
        const snowluma = {
          sendEnabled: form.sendEnabled,
          allowPrivate: form.allowPrivate,
          allowGroups: form.allowGroups.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean),
          httpBase: form.httpBase,
          wsUrl: form.wsUrl,
        }
        if (form.httpToken) snowluma.httpToken = form.httpToken
        if (form.wsToken) snowluma.wsToken = form.wsToken
        try {
          const data = await request('/settings', { method: 'POST', body: JSON.stringify({ llm, snowluma }) })
          this.setState({ snap: data.snapshot, saving: '', note: '已保存' })
          this.syncForm(data.snapshot)
        } catch (error) {
          this.setState({ saving: '', error: `保存失败：${error.message}` })
        }
      }

      renderBrain(t, snap) {
        return h(BrainTab, { snap, t, act: this.act, busy: this.state.busy })
      }

      renderTalk(t, snap) {
        const { messages, draft, typing, showInner, asId } = this.state
        const options = [{ id: 'owner', name: '我自己', hint: '亲密度 42' }].concat(
          (snap.social ?? []).filter((item) => item.id !== 'owner').map((item) => ({
            id: item.id,
            name: item.name,
            hint: `亲 ${Math.round(item.intimacy)} / 惧 ${Number(item.powerFear).toFixed(2)}`,
          })),
        )
        return h(
          'div',
          { className: 'bb-stack' },
          h(
            Card,
            { title: t('talkTitle'), hint: t('talkHint') },
            h(
              'div',
              { className: 'bb-inline bb-inline--wrap' },
              h('span', { className: 'bb-muted' }, t('asWho')),
              h(
                'select',
                { className: 'bb-select', value: asId, onChange: (event) => this.setState({ asId: event.target.value }) },
                options.map((item) => h('option', { key: item.id, value: item.id }, `${item.name} · ${item.hint}`)),
              ),
              h(
                'label',
                { className: 'bb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: showInner,
                  onChange: (event) => this.setState({ showInner: event.target.checked }),
                }),
                t('showInner'),
              ),
            ),
            h(
              'div',
              { className: 'bb-thread' },
              messages.length
                ? messages.map((message) =>
                    h(
                      'div',
                      { key: message.id, className: `bb-msg${message.role === 'me' ? ' me' : ''}` },
                      h('div', { className: 'bb-avatar' }, message.role === 'me' ? '我' : '比'),
                      h(
                        'div',
                        { className: 'bb-bubbles' },
                        message.bubbles.map((text, index) =>
                          h(
                            'div',
                            { key: `${message.id}-b${index}`, className: `bb-bubble${message.recalled ? ' is-recalled' : ''}` },
                            message.recalled ? t('recalledMsg') : text,
                          ),
                        ),
                        message.note ? h('div', { className: 'bb-replyMeta' }, message.note) : null,
                        message.role === 'bibao' && showInner && message.inner
                          ? h('div', { className: 'bb-innerBubble' }, message.inner)
                          : null,
                        message.role === 'bibao' && message.route
                          ? h(
                              'div',
                              { className: 'bb-replyMeta' },
                              `${t('route')} ${message.route} · ${t('pe')} ${Number(message.pe).toFixed(2)} · ${t('salience')} ${Number(message.salience).toFixed(2)} · ${t('budget')} ${message.budget?.maxChars ?? '—'} ${t('chars')} · ${message.source ?? 'local'}`,
                            )
                          : null,
                      ),
                    ),
                  )
                : h('div', { className: 'bb-muted' }, t('talkHint')),
              typing ? h('div', { className: 'bb-typing' }, t('thinking')) : null,
            ),
            h(
              'div',
              { className: 'bb-compose' },
              h('textarea', {
                className: 'bb-textarea',
                rows: 2,
                value: draft,
                placeholder: t('placeholder'),
                onChange: (event) => this.setState({ draft: event.target.value }),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    this.sendTalk()
                  }
                },
              }),
              h(
                'button',
                { type: 'button', className: 'bb-btn primary', disabled: typing || !draft.trim(), onClick: this.sendTalk },
                t('send'),
              ),
            ),
          ),
        )
      }

      renderMemory(t) {
        const { memData, memTier, recall, busy } = this.state
        const items = memData?.items ?? []
        return h(
          'div',
          { className: 'bb-stack' },
          h(
            Card,
            { title: t('memoryTitle'), hint: t('memoryHint') },
            h(
              'div',
              { className: 'bb-inline' },
              ['all', 'conscious', 'subconscious', 'pruning'].map((key) =>
                h(
                  'button',
                  { key, type: 'button', className: `bb-tab${memTier === key ? ' is-active' : ''}`, onClick: () => this.loadMemory(key) },
                  t(key),
                ),
              ),
              memData?.stats
                ? h(Chip, { children: `共 ${memData.stats.total} · 显 ${memData.stats.conscious} · 潜 ${memData.stats.subconscious} · 归档 ${memData.stats.archived}` })
                : null,
            ),
            recall
              ? h(
                  'div',
                  { className: `bb-banner${recall.ok ? ' is-good' : ' is-warn'}` },
                  recall.ok
                    ? `${t('recalled')}：${recall.narrativeBefore} → ${recall.narrativeAfter}`
                    : `${t('submerged')}：${recall.message ?? ''}`,
                )
              : null,
            h(
              'div',
              { className: 'bb-memList' },
              items.length
                ? items.map((item) =>
                    h(
                      'div',
                      { key: item.id, className: 'bb-memRow' },
                      h(
                        'div',
                        { className: 'bb-memHead' },
                        h('span', { className: 'bb-memTitle' }, item.title),
                        h(Chip, { children: t(item.tier), tone: TIER_CLASS[item.tier] }),
                        h('span', { className: 'bb-muted' }, ago(item.at, t)),
                      ),
                      h('div', { className: 'bb-memNarrative' }, item.narrative ?? t('noNarrative')),
                      h(
                        'div',
                        { className: 'bb-memMeta' },
                        h('span', {}, `R ${Number(item.r).toFixed(3)}`),
                        h('span', {}, `S ${Number(item.sDays).toFixed(1)}d`),
                        h('span', {}, `V ${Number(item.valence) >= 0 ? '+' : ''}${Number(item.valence).toFixed(2)}`),
                        item.recalls ? h('span', {}, `${t('recalled')} ×${item.recalls}`) : null,
                        item.distortions ? h(Chip, { children: `涂抹 ×${item.distortions}`, tone: 'warn' }) : null,
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'bb-btn bb-btn--tiny',
                            disabled: busy || item.tier !== 'conscious',
                            onClick: async () => {
                              try {
                                const data = await request('/recall', {
                                  method: 'POST',
                                  body: JSON.stringify({ memoryId: item.id }),
                                })
                                this.setState({ recall: data.result, snap: data.snapshot })
                                this.loadMemory(memTier)
                              } catch (error) {
                                this.setState({ recall: { ok: false, message: error.message } })
                              }
                            },
                          },
                          t('recall'),
                        ),
                      ),
                      h(Bar, { value: item.r, tone: item.tier === 'conscious' ? 'brand' : 'warn' }),
                    ),
                  )
                : h('div', { className: 'bb-muted' }, t('none')),
            ),
          ),
          h(
            'div',
            { className: 'bb-grid' },
            h(
              Card,
              { title: t('dreams'), hint: '睡眠交叉回放的副产品' },
              (memData?.dreams ?? this.state.snap?.memory?.dreams ?? []).length
                ? (memData?.dreams ?? this.state.snap.memory.dreams)
                    .slice()
                    .reverse()
                    .map((dream) =>
                      h(
                        'div',
                        { key: dream.id, className: 'bb-innerItem' },
                        h('div', { className: 'bb-innerMeta' }, h('span', {}, clockOf(dream.at)), h(Chip, { children: t('dream') })),
                        h('div', {}, dream.narrative),
                      ),
                    )
                : h('div', { className: 'bb-muted' }, t('none')),
            ),
            h(
              Card,
              { title: t('semantics'), hint: '重复出现的模式才配进新皮层' },
              (memData?.semantics ?? this.state.snap?.memory?.semantics ?? []).length
                ? (memData?.semantics ?? this.state.snap.memory.semantics)
                    .slice()
                    .reverse()
                    .map((item) =>
                      h('div', { key: item.id, className: 'bb-a9' }, h(Chip, { children: item.tag }), h('span', { className: 'bb-muted' }, `×${item.count} · ${item.text}`)),
                    )
                : h('div', { className: 'bb-muted' }, t('none')),
            ),
          ),
          h('div', { className: 'bb-grid' }, h(RecentTalkCard, { snap: this.state.snap, t })),
        )
      }

      renderGroups(t, snap) {
        const state = this.state.group
        const unlocked = state?.unlocked ?? snap.phase2?.unlocked
        if (!unlocked) {
          return h(
            Card,
            { title: t('groupsLocked'), hint: t('groupsHint') },
            h('p', { className: 'bb-quote' }, t('groupsLockedHint')),
            h('div', { className: 'bb-inline' }, h(Chip, { children: `${snap?.gate?.passed ?? 0}/${snap?.gate?.total ?? 6}`, tone: 'bad' }), h('button', { type: 'button', className: 'bb-btn primary', onClick: () => this.setState({ tab: 'gate' }) }, t('goGate'))),
          )
        }
        const groups = state?.group?.groups ?? []
        const roster = state?.roster ?? []
        return h(
          'div',
          { className: 'bb-stack' },
          h(
            Card,
            { title: t('groupsTitle'), hint: t('groupsHint') },
            h(
              'div',
              { className: 'bb-inline' },
              h(Chip, { children: `收到 ${state?.group?.stats?.received ?? 0}` }),
              h(Chip, { children: `进脑 ${state?.group?.stats?.escalated ?? 0}`, tone: 'on' }),
              h(Chip, { children: `本地丢弃 ${state?.group?.stats?.mutedIgnored ?? 0}` }),
              h(Chip, { children: `${t('transfer')} ${state?.group?.stats?.transfers ?? 0}`, tone: 'warn' }),
              h('span', { className: 'bb-muted' }, `精力 ${state?.energy ?? '—'} · 皮质醇 ${state?.cortisol ?? '—'}`),
            ),
            h(
              'div',
              { className: 'bb-groups' },
              groups.slice(0, 12).map((group) =>
                h(
                  'div',
                  { key: group.id, className: `bb-group is-${group.layer}${group.id === this.state.groupId ? ' is-picked' : ''}`, onClick: () => this.setState({ groupId: group.id }) },
                  h('div', { className: 'bb-groupHead' }, h('span', { className: 'bb-groupName' }, group.name), h(Chip, { children: t(group.layer), tone: group.layer === 'foveal' ? 'good' : group.layer === 'peripheral' ? 'on' : '' })),
                  h('div', { className: 'bb-slotMeta' }, `${group.memberCount} 人 · ${group.unread} ${t('unread')}`),
                  h(
                    'div',
                    { className: 'bb-layerBtns' },
                    ['foveal', 'peripheral', 'muted'].map((layer) =>
                      h(
                        'button',
                        {
                          key: layer,
                          type: 'button',
                          className: `bb-layerBtn${group.layer === layer ? ' is-active' : ''}`,
                          onClick: (event) => {
                            event.stopPropagation()
                            this.setGroupLayer(group.id, layer)
                          },
                        },
                        layer === 'foveal' ? '焦点' : layer === 'peripheral' ? '余光' : '免打扰',
                      ),
                    ),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { className: 'bb-feed' },
              h(
                'div',
                { className: 'bb-inline bb-inline--wrap' },
                h('select', { className: 'bb-select', value: this.state.groupId, onChange: (e) => this.setState({ groupId: e.target.value }) }, groups.map((g) => h('option', { key: g.id, value: g.id }, `${g.name}（${t(g.layer)}）`))),
                h('select', { className: 'bb-select', value: this.state.groupSender, onChange: (e) => this.setState({ groupSender: e.target.value }) }, roster.map((m) => h('option', { key: m.id, value: m.id }, `${m.name}${m.tags.length ? ` · ${m.tags[0]}` : ''}`))),
                h('label', { className: 'bb-check' }, h('input', { type: 'checkbox', checked: this.state.groupAtMe, onChange: (e) => this.setState({ groupAtMe: e.target.checked }) }), t('atMe')),
              ),
              h(
                'div',
                { className: 'bb-compose' },
                h('input', { className: 'bb-input', value: this.state.groupDraft, placeholder: t('feed'), onChange: (e) => this.setState({ groupDraft: e.target.value }), onKeyDown: (e) => e.key === 'Enter' && this.feedGroup() }),
                h('button', { type: 'button', className: 'bb-btn primary', onClick: this.feedGroup }, t('send')),
              ),
            ),
          ),
          h(
            Card,
            { title: t('decisions'), hint: t('noLlm') },
            h(
              'div',
              { className: 'bb-log' },
              (state?.group?.log ?? []).slice().reverse().map((entry, index) =>
                h(
                  'div',
                  { key: `${entry.at}-${index}`, className: 'bb-logRow' },
                  h('div', { className: 'bb-innerMeta' }, h('span', {}, clockOf(entry.at)), h(Chip, { children: entry.kind, tone: entry.kind === 'transfer' ? 'warn' : entry.kind === 'brain' ? 'on' : '' }), entry.group ? h('span', {}, entry.group) : null),
                  entry.text ? h('div', { className: 'bb-logText' }, entry.text) : null,
                  entry.reason ? h('div', { className: 'bb-muted' }, entry.reason) : null,
                  entry.route ? h('div', { className: 'bb-muted' }, `路由 ${entry.route} · 内心：${entry.inner}`) : null,
                  entry.bubbles?.length ? h('div', { className: 'bb-logText' }, `外显：${entry.bubbles.join(' / ')}`) : null,
                ),
              ),
            ),
          ),
        )
      }

      renderGate(t, snap) {
        const report = this.state.gate
        const passed = report?.passed ?? snap?.gate?.passed ?? 0
        const total = report?.total ?? snap?.gate?.total ?? 6
        const unlocked = report?.phase2Unlocked ?? snap?.phase2?.unlocked ?? false
        return h(
          'div',
          { className: 'bb-stack' },
          h(
            Card,
            { title: t('gateTitle'), hint: t('gateHint') },
            h(
              'div',
              { className: 'bb-inline' },
              h(Chip, { children: `${passed}/${total}`, tone: unlocked ? 'good' : 'bad' }),
              h(Chip, { children: unlocked ? t('gateUnlocked') : t('gateLocked'), tone: unlocked ? 'good' : 'warn' }),
              h('button', { type: 'button', className: 'bb-btn primary', disabled: this.state.gateBusy, onClick: this.runGate }, this.state.gateBusy ? t('running') : t('runAll')),
            ),
          ),
          (report?.results ?? []).map((item) =>
            h(
              'section',
              { key: item.id, className: `bb-gateCard${item.passed ? ' is-pass' : ' is-fail'}` },
              h('header', { className: 'bb-groupHead' }, h('span', { className: 'bb-cardTitle' }, `${item.id} · ${item.name}`), h(Chip, { children: item.passed ? t('passed') : t('failed'), tone: item.passed ? 'good' : 'bad' }), h('span', { className: 'bb-muted' }, item.law)),
              h('p', { className: 'bb-muted' }, item.hypothesis),
              h('div', { className: 'bb-metrics' }, Object.entries(item.metrics ?? {}).map(([key, value]) => h('div', { key, className: 'bb-metric' }, h('span', { className: 'bb-metricKey' }, key), h('span', { className: 'bb-metricValue' }, Array.isArray(value) ? value.join(' / ') : String(value))))),
              h('details', { className: 'bb-details' }, h('summary', {}, t('steps')), h('ol', { className: 'bb-steps' }, (item.steps ?? []).map((step, index) => h('li', { key: index }, step)))),
            ),
          ),
        )
      }

      renderSettings(t, snap) {
        const { form, bio, bioDirty, saving, note } = this.state
        if (!form) return h('div', { className: 'bb-muted' }, '正在读取设置…')
        const snow = snap.snow ?? {}
        return h(
          'div',
          { className: 'bb-stack' },
          h(
            Card,
            { title: '行为调节', hint: '两个旋钮，拉满就是现在的样子' },
            h(
              'div',
              { className: 'bb-tune' },
              h(
                'div',
                { className: 'bb-tuneHead' },
                h('strong', {}, '记忆力'),
                h('span', { className: 'bb-muted' }, memoryLabel(form.tuning?.memoryStrength ?? 1)),
              ),
              h('input', {
                type: 'range',
                className: 'bb-slider',
                min: '0',
                max: '1',
                step: '0.05',
                value: form.tuning?.memoryStrength ?? 1,
                onChange: (event) => {
                  const tuning = { ...(form.tuning ?? {}), memoryStrength: Number(event.target.value) }
                  this.setField({ tuning })
                  this.queueTuningSave(tuning)
                },
              }),
              h(
                'div',
                { className: 'bb-tuneHead', style: { marginBlockStart: '10px' } },
                h('strong', {}, '说话频率'),
                h('span', { className: 'bb-muted' }, talkLabel(form.tuning?.talkativeness ?? 1)),
              ),
              h('input', {
                type: 'range',
                className: 'bb-slider',
                min: '0',
                max: '1',
                step: '0.05',
                value: form.tuning?.talkativeness ?? 1,
                onChange: (event) => {
                  const tuning = { ...(form.tuning ?? {}), talkativeness: Number(event.target.value) }
                  this.setField({ tuning })
                  this.queueTuningSave(tuning)
                },
              }),
              h('div', { className: 'bb-muted' }, '记忆拉低＝只有刚才十几分钟清晰；频率拉低＝更容易装死。都不改四定律，只改这个人的参数。'),
            ),
          ),
          h(
            Card,
            { title: '语言区模型', hint: '留空则用 DSH 当前默认模型' },
            h(Field, { label: 'baseURL' }, h('input', { className: 'bb-input', value: form.baseURL, placeholder: 'https://api.deepseek.com', onChange: (e) => this.setField({ baseURL: e.target.value }) })),
            h(Field, { label: 'model' }, h('input', { className: 'bb-input', value: form.model, placeholder: 'deepseek-chat', onChange: (e) => this.setField({ model: e.target.value }) })),
            h(Field, { label: 'apiKey' }, h('input', { className: 'bb-input', type: 'password', value: form.apiKey, placeholder: snap.llmConfig?.hasKey ? `${snap.llmConfig.keyMask}（留空不变）` : '留空 = 用 DSH 默认模型', onChange: (e) => this.setField({ apiKey: e.target.value }) })),
            h('div', { className: 'bb-muted' }, '三种逻辑可各指向不同厂商 / 不同 key；关掉「独立配置」就继承默认'),
            LOGIC_META.map((meta) => {
              const row = form.profiles[meta.name] ?? {}
              const status = (snap.llmConfig?.profiles ?? []).find((item) => item.name === meta.name) ?? {}
              if (meta.wired === false) {
                return h(
                  'div',
                  { key: meta.name, className: 'bb-logicRow is-static' },
                  h('div', { className: 'bb-inline' },
                    h('strong', { className: 'bb-logicName' }, meta.label),
                    h(Chip, { children: '纯数学' }),
                  ),
                  h('div', { className: 'bb-muted' }, meta.hint),
                )
              }
              return h(
                'div',
                { key: meta.name, className: 'bb-logicRow' },
                h('div', { className: 'bb-inline' }, h('strong', { className: 'bb-logicName' }, meta.label), h(Chip, { children: status.active ? status.source : 'local', tone: status.active ? 'good' : '' }), h('label', { className: 'bb-check' }, h('input', { type: 'checkbox', checked: row.enabled !== false, onChange: (e) => this.setProfile(meta.name, { enabled: e.target.checked }) }), '独立配置')),
                h('div', { className: 'bb-muted' }, meta.hint),
                row.enabled !== false
                  ? h('div', { className: 'bb-logicGrid' },
                      h('input', { className: 'bb-input', value: row.baseURL ?? '', placeholder: '继承 baseURL', onChange: (e) => this.setProfile(meta.name, { baseURL: e.target.value }) }),
                      h('input', { className: 'bb-input', value: row.model ?? '', placeholder: '继承 model', onChange: (e) => this.setProfile(meta.name, { model: e.target.value }) }),
                      h('input', { className: 'bb-input', type: 'password', value: row.apiKey ?? '', placeholder: status.hasKey ? `${status.keyMask}（留空不变）` : '继承 apiKey', onChange: (e) => this.setProfile(meta.name, { apiKey: e.target.value }) }),
                    )
                  : null,
              )
            }),
          ),
          h(
            Card,
            { title: 'snowluma', hint: 'OneBot HTTP 发送 + WS 收事件' },
            h(Field, { label: 'HTTP' }, h('input', { className: 'bb-input', value: form.httpBase, placeholder: 'http://127.0.0.1:3000', onChange: (e) => this.setField({ httpBase: e.target.value }) })),
            h(Field, { label: 'HTTP token' }, h('input', { className: 'bb-input', type: 'password', value: form.httpToken, placeholder: '留空 = 沿用已保存的', onChange: (e) => this.setField({ httpToken: e.target.value }) })),
            h(Field, { label: 'WS' }, h('input', { className: 'bb-input', value: form.wsUrl, placeholder: 'ws://127.0.0.1:3001/', onChange: (e) => this.setField({ wsUrl: e.target.value }) })),
            h(Field, { label: 'WS token' }, h('input', { className: 'bb-input', type: 'password', value: form.wsToken, placeholder: '留空 = 沿用已保存的', onChange: (e) => this.setField({ wsToken: e.target.value }) })),
            h(Field, { label: '允许群' }, h('input', { className: 'bb-input', value: form.allowGroups, placeholder: '576268399', onChange: (e) => this.setField({ allowGroups: e.target.value }) })),
            h('div', { className: 'bb-inline bb-inline--wrap' },
              h('label', { className: 'bb-check' }, h('input', { type: 'checkbox', checked: form.sendEnabled, onChange: (e) => this.setField({ sendEnabled: e.target.checked }) }), '允许真的发到 QQ'),
              h('label', { className: 'bb-check' }, h('input', { type: 'checkbox', checked: form.allowPrivate, onChange: (e) => this.setField({ allowPrivate: e.target.checked }) }), '允许私聊'),
              snow.connected ? h(Chip, { children: `已连接 · ${snow.selfName || snow.selfId}`, tone: 'good' }) : h(Chip, { children: '未连接', tone: 'bad' }),
              h('button', { type: 'button', className: 'bb-btn bb-btn--tiny', onClick: () => this.testWs() }, '测试 WS'),
            ),
            h('div', { className: 'bb-muted' }, snow.reason || '白名单为空 = 谁都不理'),
          ),
          h(
            Card,
            { title: '过去的经历', hint: '改完按新人生重建' },
            !bio
              ? h('button', { type: 'button', className: 'bb-btn', onClick: this.loadBio }, '载入传记')
              : h(
                  'div',
                  { className: 'bb-bio' },
                  h(Field, { label: '名字' }, h('input', { className: 'bb-input', value: bio.name ?? '', onChange: (e) => this.setState({ bio: { ...bio, name: e.target.value }, bioDirty: true }) })),
                  h(Field, { label: '一句话' }, h('input', { className: 'bb-input', value: bio.oneLine ?? '', onChange: (e) => this.setState({ bio: { ...bio, oneLine: e.target.value }, bioDirty: true }) })),
                  h(Field, { label: '核心创伤' }, h('input', { className: 'bb-input', value: bio.coreWound ?? '', onChange: (e) => this.setState({ bio: { ...bio, coreWound: e.target.value }, bioDirty: true }) })),
                  (bio.events ?? []).map((event, index) =>
                    h(
                      'div',
                      { key: index, className: 'bb-bioRow' },
                      h('div', { className: 'bb-inline' },
                        h('input', { className: 'bb-input bb-bioAge', type: 'number', step: '0.1', value: event.age, onChange: (e) => this.updateEvent(index, { age: Number(e.target.value) }) }),
                        h('input', { className: 'bb-input', value: event.title ?? '', placeholder: '标题', onChange: (e) => this.updateEvent(index, { title: e.target.value }) }),
                        h('button', { type: 'button', className: 'bb-btn bb-btn--tiny', onClick: () => this.setState({ bio: { ...bio, events: bio.events.filter((_, i) => i !== index) }, bioDirty: true }) }, '删'),
                      ),
                      h('textarea', { className: 'bb-textarea', rows: 2, value: event.narrative ?? '', onChange: (e) => this.updateEvent(index, { narrative: e.target.value }) }),
                      h('div', { className: 'bb-inline bb-inline--wrap' },
                        h('span', { className: 'bb-muted' }, '效价'),
                        h('input', { className: 'bb-input bb-bioNum', type: 'number', step: '0.1', min: '-1', max: '1', value: event.valence, onChange: (e) => this.updateEvent(index, { valence: Number(e.target.value) }) }),
                        h('span', { className: 'bb-muted' }, '唤醒'),
                        h('input', { className: 'bb-input bb-bioNum', type: 'number', step: '0.1', min: '0', max: '1', value: event.arousal, onChange: (e) => this.updateEvent(index, { arousal: Number(e.target.value) }) }),
                        h('span', { className: 'bb-muted' }, '影响'),
                        BIO_IMPACT_KEYS.map((key) => h('input', { key, className: 'bb-input bb-bioNum', type: 'number', step: '0.01', title: key, value: event.impact?.[key] ?? 0, onChange: (e) => this.updateEvent(index, { impact: { ...(event.impact ?? {}), [key]: Number(e.target.value) } }) })),
                      ),
                    ),
                  ),
                  h('div', { className: 'bb-actions' },
                    h('button', { type: 'button', className: 'bb-btn', onClick: () => this.setState({ bio: { ...bio, events: [...(bio.events ?? []), { age: (bio.events?.at(-1)?.age ?? 0) + 1, title: '新的事件', narrative: '', valence: 0, arousal: 0.4, impact: {}, tags: [] }] }, bioDirty: true }) }, '加一个事件'),
                    h('button', { type: 'button', className: 'bb-btn primary', disabled: !bioDirty, onClick: this.saveBio }, '保存并重建'),
                  ),
                ),
          ),
          h(
            'div',
            { className: 'bb-actions' },
            h('button', { type: 'button', className: 'bb-btn primary', disabled: Boolean(saving), onClick: this.saveSettings }, '保存模型与连接'),
            saving ? h('span', { className: 'bb-chip' }, saving) : null,
            note ? h('span', { className: 'bb-chip good' }, note) : null,
            snap.console?.url
              ? h('button', { type: 'button', className: 'bb-btn', onClick: () => window.open(snap.console.url, '_blank', 'noopener') }, '打开独立控制台')
              : null,
          ),
        )
      }

      updateEvent(index, patch) {
        this.setState((prev) => ({
          bio: { ...prev.bio, events: prev.bio.events.map((event, i) => (i === index ? { ...event, ...patch } : event)) },
          bioDirty: true,
        }))
      }

      render() {
        const t = this.t()
        const { snap, tab, error, toast } = this.state
        if (!snap) {
          return h(
            'div',
            { className: 'bb-panel' },
            h(
              'div',
              { className: 'bb-empty' },
              h('div', { className: 'bb-emptyMark' }, h(BibaoIcon, { size: 34 })),
              h('p', { className: 'bb-emptyTitle' }, error ? t('failedLoad') : t('waking')),
              error ? h('pre', { className: 'bb-pre' }, error) : null,
              h('button', { type: 'button', className: 'bb-btn', onClick: this.load }, t('retry')),
            ),
          )
        }
        const tabs = [
          ['brain', t('tabBrain')],
          ['talk', t('tabTalk')],
          ['memory', t('tabMemory')],
          ['groups', t('tabGroups')],
          ['gate', t('tabGate')],
          ['senses', '感官'],
          ['settings', t('tabSettings')],
        ]
        return h(
          'div',
          { className: 'bb-panel' },
          h(
            'header',
            { className: 'bb-head' },
            h('div', { className: 'bb-mark' }, h(BibaoIcon, { size: 30 })),
            h(
              'div',
              { className: 'bb-heroText' },
              h('h1', { className: 'bb-title' }, snap.identity.name),
              h('p', { className: 'bb-sub' }, snap.identity.oneLine || t('subtitle')),
            ),
            h(
              'div',
              { className: 'bb-chips' },
              h(Chip, { children: t('phase1'), tone: 'on' }),
              h(Chip, { children: `${t('clock')} ${snap.clock.label}` }),
              h(Chip, {
                children: `${snap.neuro.moodLabel} · 皮质醇 ${pct(snap.neuro.hormones.find((item) => item.key === 'cortisol')?.value ?? 0)}`,
                tone: snap.workspace.hijacked ? 'bad' : '',
              }),
              h(Chip, { children: snap.llm?.enabled ? t('llmOn') : t('llmOff'), tone: snap.llm?.enabled ? 'good' : '' }),
              snap.llm?.lastError
                ? h(Chip, { children: '语言区降级：' + snap.llm.lastError.slice(0, 28), tone: 'bad' })
                : null,
            ),
          ),
          error ? h('div', { className: 'bb-error' }, error) : null,
          h(
            'nav',
            { className: 'bb-tabs', role: 'tablist' },
            tabs.map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': tab === key,
                  className: `bb-tab${tab === key ? ' is-active' : ''}`,
                  onClick: () => {
                    this.setState({ tab: key })
                    if (key === 'memory' && !this.state.memData) this.loadMemory()
                    if (key === 'groups') this.loadGroups()
                    if (key === 'settings' && !this.state.bio) this.loadBio()
                  },
                },
                label,
              ),
            ),
          ),
          tab === 'brain' ? this.renderBrain(t, snap) : null,
          tab === 'talk' ? this.renderTalk(t, snap) : null,
          tab === 'memory' ? this.renderMemory(t) : null,
          tab === 'groups' ? this.renderGroups(t, snap) : null,
          tab === 'gate' ? this.renderGate(t, snap) : null,
          tab === 'settings' ? this.renderSettings(t, snap) : null,
          tab === 'senses' ? h(SensesPanel, { t, snap }) : null,
          toast ? h('div', { className: 'bb-toast', role: 'status' }, toast) : null,
        )
      }
    }


    /* ------------------------------------------------------------------ */
    /* 脑机接口（实验性）：六个感官通道                                      */
    /* ------------------------------------------------------------------ */

    class SensesPanel extends React.Component {
      constructor(props) {
        super(props)
        this.state = { channels: [], recent: [], drafts: {}, levels: {}, error: '', note: '' }
        this.load = this.load.bind(this)
        this.feed = this.feed.bind(this)
        this.toggle = this.toggle.bind(this)
      }

      componentDidMount() {
        this.alive = true
        this.load()
      }

      componentWillUnmount() {
        this.alive = false
      }

      async load() {
        try {
          const data = await request('/senses')
          if (!this.alive) return
          this.setState({ channels: data.channels ?? [], recent: data.recent ?? [], error: '' })
        } catch (error) {
          if (this.alive) this.setState({ error: error.message })
        }
      }

      async toggle(channel) {
        try {
          const data = await request('/senses', {
            method: 'POST',
            body: JSON.stringify({ toggle: true, channel: channel.key, enabled: !channel.enabled }),
          })
          this.setState({ channels: data.channels ?? [] })
        } catch (error) {
          this.setState({ error: error.message })
        }
      }

      async feed(channel) {
        const text = (this.state.drafts[channel.key] ?? '').trim()
        if (!text) return
        this.setState({ note: '投喂中…' })
        try {
          const data = await request('/senses', {
            method: 'POST',
            body: JSON.stringify({
              channel: channel.key,
              text,
              intensity: Number(this.state.levels[channel.key] ?? 0.6),
            }),
          })
          const result = data.result
          this.setState((prev) => ({ drafts: { ...prev.drafts, [channel.key]: '' } }))
          this.setState({
            note: result.ignited
              ? `${channel.label}进了工作空间（显著性 ${result.salience}）`
              : `${channel.label}没进意识（显著性 ${result.salience}）`,
          })
          await this.load()
        } catch (error) {
          this.setState({ note: `失败：${error.message}` })
        }
      }

      render() {
        const t = typeof this.props.t === 'function' ? this.props.t : (key) => key
        const { channels, recent, drafts, levels, error, note } = this.state
        return h(
          'div',
          { className: 'bb-stack' },
          h(
            Card,
            { title: '脑机接口 · 实验性', hint: '感官皮层' },
            h(
              'p',
              { className: 'bb-quote' },
              '六个通道各占一个接口位。现在只有「手动投喂」是真的：一段画面、一句听到的话、一股气味，会当成一次真实知觉进入丘脑，参与点火、写记忆、改变激素。摄像头、麦克风、屏幕与浏览器的自动采集还没接，开关只记状态。',
            ),
            h(
              'div',
              { className: 'bb-senseStrip' },
              channels.map((channel) =>
                h(
                  'div',
                  { key: channel.key, className: `bb-senseChip${channel.enabled ? ' is-on' : ''}` },
                  h('span', { className: 'bb-senseGlyph' }, channel.glyph),
                  h('span', {}, channel.label),
                  h('span', { className: 'bb-muted' }, channel.samples ? `${channel.samples} 次` : '未接'),
                ),
              ),
            ),
            note ? h('div', { className: 'bb-chip good' }, note) : null,
            error ? h('div', { className: 'bb-error' }, error) : null,
          ),
          h(
            'div',
            { className: 'bb-senseGrid' },
            channels.map((channel) =>
              h(
                'section',
                { key: channel.key, className: `bb-card bb-senseCard${channel.enabled ? ' is-on' : ''}` },
                h(
                  'header',
                  { className: 'bb-senseHead' },
                  h('span', { className: 'bb-senseGlyph bb-senseGlyph--big' }, channel.glyph),
                  h(
                    'div',
                    { className: 'bb-senseMeta' },
                    h('strong', {}, channel.label),
                    h('span', { className: 'bb-muted' }, `${channel.modality} · ${channel.hint}`),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'bb-btn bb-btn--tiny', onClick: () => this.toggle(channel) },
                    channel.enabled ? '已启用' : '接入',
                  ),
                ),
                channel.lastText
                  ? h('div', { className: 'bb-senseLast' }, h('span', { className: 'bb-muted' }, '最近：'), channel.lastText)
                  : h('div', { className: 'bb-muted' }, '还没有信号'),
                h(
                  'div',
                  { className: 'bb-senseFeed' },
                  h('textarea', {
                    className: 'bb-textarea',
                    rows: 2,
                    placeholder: `模拟一次「${channel.modality}」…`,
                    value: drafts[channel.key] ?? '',
                    onChange: (event) =>
                      this.setState((prev) => ({ drafts: { ...prev.drafts, [channel.key]: event.target.value } })),
                  }),
                  h(
                    'div',
                    { className: 'bb-inline' },
                    h('span', { className: 'bb-muted' }, '强度'),
                    h('input', {
                      className: 'bb-slider',
                      type: 'range',
                      min: '0',
                      max: '1',
                      step: '0.05',
                      value: levels[channel.key] ?? 0.6,
                      onChange: (event) =>
                        this.setState((prev) => ({ levels: { ...prev.levels, [channel.key]: event.target.value } })),
                    }),
                    h('button', { type: 'button', className: 'bb-btn primary bb-btn--tiny', onClick: () => this.feed(channel) }, '投喂'),
                  ),
                ),
              ),
            ),
          ),
          h(
            Card,
            { title: '感知流', hint: '最近进入意识的感官事件' },
            recent.length
              ? recent
                  .slice()
                  .reverse()
                  .map((item, index) =>
                    h(
                      'div',
                      { key: `${item.at}-${index}`, className: 'bb-innerItem' },
                      h('div', { className: 'bb-innerMeta' }, h('span', {}, clockOf(item.at)), h(Chip, { children: item.source.replace('sense:', '') })),
                      h('div', {}, item.thought),
                    ),
                  )
              : h('div', { className: 'bb-muted' }, '还没有任何感官事件'),
          ),
        )
      }
    }

    const CSS = `
.bb-strip {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 5px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1); font-size: 11.5px; color: var(--dsw-alias-label-secondary);
}
.bb-stripMark {
  display: grid; place-items: center; inline-size: 22px; block-size: 22px; border-radius: 7px;
  color: #6C5CE7; background: color-mix(in oklab, #6C5CE7 14%, var(--dsw-alias-bg-layer-1));
}
.bb-stripName { font-weight: 600; color: var(--dsw-alias-label-primary); }
.bb-stripMeta { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bb-stripBtn {
  margin-inline-start: auto; font: inherit; font-size: 11px; height: 24px; padding: 0 9px;
  border-radius: 8px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
}
.bb-settings {
  display: flex; flex-direction: column; gap: 12px; padding: 4px 2px 24px;
  color: var(--dsw-alias-label-primary); font-size: 13px;
}
.bb-setHead { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.bb-setTabs { display: flex; gap: 6px; flex-wrap: wrap; }
.bb-bio { display: flex; flex-direction: column; gap: 8px; margin-block-start: 8px; }
.bb-bioRow { border-block-start: 1px dashed var(--dsw-alias-border-l1); padding-block-start: 8px; display: flex; flex-direction: column; gap: 6px; }
.bb-bioAge { max-inline-size: 84px; }
.bb-bioNum { max-inline-size: 76px; }
.bb-layerBtns { display: flex; gap: 4px; margin-block-start: 6px; }
.bb-layerBtn {
  font: inherit; font-size: 10.5px; line-height: 1; padding: 3px 7px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary);
}
.bb-layerBtn:hover { color: var(--dsw-alias-label-primary); }
.bb-layerBtn.is-active {
  color: var(--dsw-alias-label-primary);
  border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 45%, transparent);
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 14%, transparent);
}
.bb-tune { display: flex; flex-direction: column; gap: 6px; }
.bb-tuneHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12.5px; }
.bb-senseStrip { display: flex; gap: 8px; flex-wrap: wrap; margin-block: 8px; }
.bb-senseChip {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); font-size: 11.5px; color: var(--dsw-alias-label-secondary);
}
.bb-senseChip.is-on { border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 45%, transparent); color: var(--dsw-alias-label-primary); }
.bb-senseGlyph {
  display: inline-grid; place-items: center; inline-size: 20px; block-size: 20px; border-radius: 7px;
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-brand-primary); font-size: 11px;
}
.bb-senseGlyph--big { inline-size: 30px; block-size: 30px; border-radius: 10px; font-size: 13px; }
.bb-senseGrid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.bb-senseCard { display: flex; flex-direction: column; gap: 8px; }
.bb-senseCard.is-on { box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary); }
.bb-senseHead { display: flex; align-items: center; gap: 8px; }
.bb-senseMeta { display: flex; flex-direction: column; min-inline-size: 0; flex: 1 1 auto; font-size: 12px; }
.bb-senseLast { font-size: 11.5px; }
.bb-senseFeed { display: flex; flex-direction: column; gap: 6px; }
.bb-slider { flex: 1 1 auto; min-inline-size: 60px; accent-color: var(--dsw-alias-brand-primary); }
.bb-badge {
  position: fixed; inset-block-end: 18px; inset-inline-end: 18px; z-index: 58;
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; cursor: pointer; pointer-events: auto;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
}
.bb-badge:hover { background: var(--dsw-alias-bg-layer-2); }
.bb-drawer {  position: fixed; inset-block: 0; inset-inline-end: 0; z-index: 60;
  inline-size: min(820px, 94vw); display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  border-inline-start: 1px solid var(--dsw-alias-border-l2);
  box-shadow: -18px 0 48px rgb(0 0 0 / 0.18);
  pointer-events: auto;
}
.bb-drawerBar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-block-end: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.bb-drawerTitle { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; }
.bb-drawerBar .bb-btn { margin-inline-start: auto; }
.bb-drawerBody { flex: 1 1 auto; min-block-size: 0; overflow: auto; }
.bb-drawerBody .bb-panel { block-size: auto; min-block-size: 0; padding-block-end: 32px; }
.bb-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
  block-size: 100%;
  min-block-size: 360px;
  min-inline-size: 0;
  overflow: auto;
  padding: 22px clamp(16px, 3vw, 38px) 72px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.55;
}
.bb-panel > * { inline-size: 100%; max-inline-size: 1120px; margin-inline: auto; }
.bb-head {
  display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap;
  padding: 16px 18px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 18px;
  background: linear-gradient(135deg,
    color-mix(in oklab, var(--dsw-alias-brand-primary) 9%, var(--dsw-alias-bg-layer-1)),
    var(--dsw-alias-bg-layer-1) 62%);
}
.bb-mark {
  display: grid; place-items: center; flex: 0 0 auto;
  inline-size: 46px; block-size: 46px; border-radius: 14px;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-1));
  border: 1px solid color-mix(in oklab, var(--dsw-alias-brand-primary) 30%, transparent);
}
.bb-heroText { min-inline-size: 0; flex: 1 1 300px; }
.bb-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.bb-sub { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.bb-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; margin-inline-start: auto; }
.bb-chip {
  display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.bb-chip.on {
  color: var(--dsw-alias-label-primary);
  border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 42%, transparent);
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 10%, transparent);
}
.bb-chip.good {
  color: var(--dsw-alias-state-success-primary);
  border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 40%, transparent);
}
.bb-chip.warn {
  color: var(--dsw-alias-state-warn-primary);
  border-color: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 40%, transparent);
}
.bb-chip.bad {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in oklab, var(--dsw-alias-state-error-primary) 40%, transparent);
}
.bb-tabs {
  display: flex; gap: 6px; flex-wrap: wrap; position: sticky; inset-block-start: 0; z-index: 3;
  padding: 6px 0; background: var(--dsw-alias-bg-base);
}
.bb-tab {
  font: inherit; font-size: 12.5px; height: 30px; padding: 0 13px; cursor: pointer;
  border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
}
.bb-tab:hover { color: var(--dsw-alias-label-primary); }
.bb-tab.is-active {
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base);
  border-color: transparent;
}
.bb-stack { display: flex; flex-direction: column; gap: 14px; }
.bb-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); }
.bb-grid > .bb-card:only-child { grid-column: 1 / -1; }
.bb-card {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1); padding: 14px 16px; min-inline-size: 0;
}
.bb-cardHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-block-end: 10px; }
.bb-cardTitle { font-size: 13px; font-weight: 600; }
.bb-cardHint { font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: end; }
.bb-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 2px 0; }
.bb-rowLabel { color: var(--dsw-alias-label-secondary); flex: 0 0 auto; }
.bb-rowValue { text-align: end; }
.bb-muted { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.bb-quote { margin: 0 0 8px; font-size: 13px; }
.bb-inline { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }
.bb-inline--wrap { flex-wrap: wrap; }
.bb-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.bb-btn {
  font: inherit; font-size: 12px; height: 30px; padding: 0 12px; cursor: pointer;
  border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
}
.bb-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.bb-btn.primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; }
.bb-btn--tiny { height: 24px; padding: 0 8px; font-size: 11px; }
.bb-btn:disabled { opacity: .45; cursor: default; }
.bb-bar { block-size: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; margin-block-start: 4px; }
.bb-barFill { display: block; block-size: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); transition: inline-size .45s ease; }
.bb-tone-cortisol { background: var(--dsw-alias-state-error-primary); }
.bb-tone-dopamine { background: var(--dsw-alias-state-warn-primary); }
.bb-tone-oxytocin { background: var(--dsw-alias-state-success-primary); }
.bb-tone-serotonin { background: var(--dsw-alias-brand-primary); }
.bb-tone-energy { background: var(--dsw-alias-label-secondary); }
.bb-tone-warn { background: var(--dsw-alias-state-warn-primary); }
.bb-mood { display: flex; align-items: baseline; gap: 8px; margin-block-end: 10px; }
.bb-moodLabel { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.bb-moodValue { font-size: 15px; }
.bb-hormone { margin-block-end: 9px; }
.bb-hormoneHead { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.bb-hormoneName { inline-size: 54px; flex: 0 0 auto; }
.bb-hormoneValue { font-variant-numeric: tabular-nums; }
.bb-schema { margin-block-end: 9px; }
.bb-theta { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-block-end: 10px; }
.bb-thetaValue { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.bb-thetaParts { flex: 1 1 160px; min-inline-size: 140px; }
.bb-slots { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(126px, 1fr)); }
.bb-slot {
  border: 1px dashed var(--dsw-alias-border-l1); border-radius: 12px;
  padding: 8px 9px; min-block-size: 64px; font-size: 11.5px;
}
.bb-slot.filled { border-style: solid; background: var(--dsw-alias-bg-layer-2); }
.bb-slotTitle {
  font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.bb-slotMeta { color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.bb-lost { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-block-start: 10px; padding-block-start: 8px; border-block-start: 1px dashed var(--dsw-alias-border-l1); }
.bb-inner { max-block-size: 236px; overflow: auto; display: flex; flex-direction: column; gap: 9px; }
.bb-innerItem { border-inline-start: 2px solid var(--dsw-alias-border-l2); padding-inline-start: 9px; font-size: 12px; }
.bb-innerMeta { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin-block-end: 2px; }
.bb-relation { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; flex-wrap: wrap; }
.bb-relationName { font-weight: 600; inline-size: 64px; }
.bb-social { max-block-size: 340px; overflow: auto; }
.bb-relationSay { inline-size: 100%; margin-block-start: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bb-pending { padding: 6px 0; border-block-end: 1px dashed var(--dsw-alias-border-l1); font-size: 12px; }
.bb-pending:last-child { border-block-end: none; }
.bb-talk { display: flex; flex-direction: column; gap: 10px; }
.bb-thread {
  display: flex; flex-direction: column; gap: 10px; min-block-size: 260px;
  max-block-size: 50vh; overflow: auto; padding: 6px; border-radius: 12px;
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 45%, transparent);
}
.bb-msg { display: flex; gap: 8px; max-inline-size: 88%; align-items: flex-start; }
.bb-msg.me { align-self: flex-end; flex-direction: row-reverse; }
.bb-avatar {
  display: grid; place-items: center; flex: 0 0 auto; inline-size: 26px; block-size: 26px;
  border-radius: 9px; font-size: 11px; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
}
.bb-msg:not(.me) .bb-avatar {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 13%, var(--dsw-alias-bg-layer-1));
}
.bb-bubbles { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; min-inline-size: 0; }
.bb-msg.me .bb-bubbles { align-items: flex-end; }
.bb-bubble {
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 13px; padding: 6px 11px; font-size: 12.5px; line-height: 1.5;
  animation: bb-in .18s ease;
}
.bb-msg.me .bb-bubble {
  background: color-mix(in oklab, var(--dsw-alias-brand-primary) 16%, var(--dsw-alias-bg-layer-1));
  border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 30%, transparent);
}
.bb-replyMeta { font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin-block-start: 2px; }
.bb-bubble.is-recalled {
  color: var(--dsw-alias-label-secondary); font-style: italic;
  background: transparent; border-style: dashed;
}
.bb-innerBubble {
  border-inline-start: 2px solid color-mix(in oklab, var(--dsw-alias-brand-primary) 50%, transparent);
  padding: 3px 8px; font-size: 11.5px; color: var(--dsw-alias-label-secondary);
  background: color-mix(in oklab, var(--dsw-alias-bg-layer-2) 60%, transparent); border-radius: 0 8px 8px 0;
}
.bb-typing { font-size: 11.5px; color: var(--dsw-alias-label-secondary); padding-inline-start: 6px; }
.bb-compose { display: flex; gap: 8px; align-items: flex-end; margin-block-start: 8px; }
.bb-input, .bb-select, .bb-textarea {
  font: inherit; font-size: 12.5px; color: inherit; min-inline-size: 0;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px; padding: 7px 10px;
}
.bb-input { flex: 1 1 auto; }
.bb-textarea { flex: 1 1 auto; resize: vertical; min-block-size: 44px; max-block-size: 140px; }
.bb-select { max-inline-size: 260px; }
.bb-check { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.bb-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.bb-banner { border-radius: 10px; padding: 8px 10px; font-size: 12px; margin-block-end: 10px; border: 1px solid var(--dsw-alias-border-l1); }
.bb-banner.is-good { border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 35%, transparent); background: color-mix(in oklab, var(--dsw-alias-state-success-primary) 8%, transparent); }
.bb-banner.is-warn { border-color: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 35%, transparent); background: color-mix(in oklab, var(--dsw-alias-state-warn-primary) 8%, transparent); }
.bb-memList { display: flex; flex-direction: column; gap: 10px; margin-block-start: 8px; }
.bb-memRow { border-block-end: 1px dashed var(--dsw-alias-border-l1); padding-block-end: 9px; }
.bb-memRow:last-child { border-block-end: none; }
.bb-memHead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bb-memTitle { font-weight: 600; font-size: 12.5px; }
.bb-memNarrative { font-size: 12px; margin-block: 3px; color: var(--dsw-alias-label-primary); }
.bb-memMeta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.bb-a9 { display: flex; align-items: baseline; gap: 8px; font-size: 12px; padding: 3px 0; flex-wrap: wrap; }
.bb-loop { inline-size: 100%; block-size: auto; max-block-size: 300px; display: block; }
.bb-edge { stroke: var(--dsw-alias-border-l2); stroke-width: 1.2; stroke-dasharray: 3 4; }
.bb-edge.is-active { stroke: var(--dsw-alias-brand-primary); stroke-dasharray: 0; opacity: .85; }
.bb-nodeShape { fill: var(--dsw-alias-bg-layer-2); stroke: var(--dsw-alias-border-l1); stroke-width: 1; }
.bb-node.is-active .bb-nodeShape {
  fill: color-mix(in oklab, var(--dsw-alias-brand-primary) 16%, var(--dsw-alias-bg-layer-1));
  stroke: var(--dsw-alias-brand-primary); stroke-width: 1.4;
}
.bb-nodeText { fill: var(--dsw-alias-label-secondary); font-size: 11px; font-family: inherit; }
.bb-node.is-active .bb-nodeText { fill: var(--dsw-alias-label-primary); }
.bb-nodeDot { fill: var(--dsw-alias-state-warn-primary); }
.bb-nodeDot.is-off { fill: var(--dsw-alias-state-idle-primary); }
.bb-groups { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); margin-block-end: 12px; }
.bb-group {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 8px 10px;
  cursor: pointer; background: var(--dsw-alias-bg-layer-2); font-size: 11.5px;
}
.bb-group.is-picked { border-color: color-mix(in oklab, var(--dsw-alias-brand-primary) 55%, transparent); }
.bb-group.is-foveal { box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary); }
.bb-group.is-peripheral { box-shadow: inset 3px 0 0 var(--dsw-alias-state-warn-primary); }
.bb-group.is-muted { opacity: .72; }
.bb-groupHead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bb-groupName { font-weight: 600; font-size: 12px; }
.bb-groupPreview { margin-block-start: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.bb-feed { display: flex; flex-direction: column; gap: 8px; }
.bb-log { display: flex; flex-direction: column; max-block-size: 320px; overflow: auto; }
.bb-logRow { padding: 7px 0; border-block-end: 1px dashed var(--dsw-alias-border-l1); font-size: 11.5px; }
.bb-logRow:last-child { border-block-end: none; }
.bb-logText { margin-block-start: 2px; }
.bb-gateCard { border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; padding: 13px 16px; background: var(--dsw-alias-bg-layer-1); }
.bb-gateCard.is-pass { box-shadow: inset 3px 0 0 var(--dsw-alias-state-success-primary); }
.bb-gateCard.is-fail { box-shadow: inset 3px 0 0 var(--dsw-alias-state-error-primary); }
.bb-metrics { display: grid; gap: 4px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); margin-block: 8px; }
.bb-metric { display: flex; gap: 8px; justify-content: space-between; font-size: 11.5px; border-block-end: 1px dotted var(--dsw-alias-border-l1); padding-block-end: 2px; }
.bb-metricKey { color: var(--dsw-alias-label-secondary); }
.bb-metricValue { text-align: end; }
.bb-details { margin-block-start: 6px; }
.bb-details summary { cursor: pointer; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.bb-steps { margin: 6px 0 0; padding-inline-start: 18px; font-size: 11.5px; }
.bb-pre { white-space: pre-wrap; font-size: 10.5px; overflow: auto; }
.bb-field { display: flex; align-items: center; gap: 8px; margin-block: 6px; }
.bb-field > label { flex: 0 0 72px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.bb-field > .bb-input { flex: 1 1 auto; }
.bb-logicRow { padding-block: 8px; border-block-end: 1px dashed var(--dsw-alias-border-l1); }
.bb-logicRow:last-child { border-block-end: none; }
.bb-logicName { font-size: 12.5px; }
.bb-logicGrid { display: grid; gap: 6px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-block-start: 6px; }
.bb-empty { display: grid; place-items: center; gap: 10px; padding: 48px 12px; color: var(--dsw-alias-label-secondary); text-align: center; }
.bb-emptyMark {
  display: grid; place-items: center; inline-size: 58px; block-size: 58px; border-radius: 18px;
  color: #6C5CE7;
  background: color-mix(in oklab, #6C5CE7 15%, var(--dsw-alias-bg-layer-1));
  border: 1px solid color-mix(in oklab, #6C5CE7 38%, transparent);
}
.bb-emptyTitle { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.bb-toast {
  position: sticky; inset-block-end: 8px; align-self: center; z-index: 5;
  padding: 6px 14px; border-radius: 999px; font-size: 12px;
  color: var(--dsw-alias-bg-base); background: var(--dsw-alias-label-primary);
}
@keyframes bb-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (max-width: 720px) {
  .bb-panel { padding: 14px 12px 64px; }
  .bb-head { padding: 12px; }
  .bb-title { font-size: 18px; }
}
`

    function injectStyles() {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'bibao-brain'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /* ------------------------------------------------------------------ */
    /* 注册                                                                */
    /* ------------------------------------------------------------------ */

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'bibao: dictionaries')
      ctx.effect(() => injectStyles(), 'bibao: stylesheet')

      const t = ctx.locale.bind(NS)

      // 侧边栏入口和主面板按用户要求移除；设置页保留（class 组件，不用 hooks）。
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'bibao', order: 36, label: () => t('nav'), locale: NS },
              BibaoMindPanel,
            ),
          ),
        'bibao: settings section',
      )

      ctx.effect(() => {
        const onError = (event) =>
          beacon('error', {
            message: String(event?.message ?? ''),
            stack: String(event?.error?.stack ?? '').slice(0, 900),
          })
        const onRejection = (event) =>
          beacon('unhandledrejection', {
            message: String(event?.reason?.message ?? event?.reason ?? '').slice(0, 400),
          })
        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onRejection)
        return () => {
          window.removeEventListener('error', onError)
          window.removeEventListener('unhandledrejection', onRejection)
        }
      }, 'bibao: client error beacon')
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply,
    }
  },
})
