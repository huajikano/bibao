#!/usr/bin/env node
/**
 * 渲染冒烟：用极简 React shim 在 Node 里把面板组件树跑一遍，
 * 目的是抓"点开就白屏"这类运行时异常，而不是替代浏览器视觉验证。
 *
 * node bin/render-smoke.mjs
 */
import { readFile } from 'node:fs/promises'
import { BibaoBrain } from '../core/brain.js'

const biography = JSON.parse(await readFile(new URL('../core/biography.json', import.meta.url), 'utf8'))

/* ---------- 极简 React ---------- */
const hookValues = new Map()
let hookIndex = 0

function createElement(type, props, ...children) {
  const merged = { ...(props || {}) }
  const flat = children.length <= 1 ? children[0] : children
  if (flat !== undefined) merged.children = flat
  return { type, props: merged }
}

class Component {
  constructor(props) {
    this.props = props ?? {}
    this.state = {}
  }

  setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state) : patch
    this.state = { ...this.state, ...(next ?? {}) }
  }
}

const React = {
  createElement,
  Component,
  Fragment: Symbol('fragment'),
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect() {},
  useLayoutEffect() {},
  useRef(value) {
    return { current: value ?? null }
  },
  useCallback(fn) {
    return fn
  },
  useMemo(fn) {
    return fn()
  },
  memo(fn) {
    return fn
  },
}

/* ---------- 载入 Client 半 ---------- */
let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(options) {
      captured = options
    },
  },
  location: { origin: 'http://127.0.0.1:8326' },
  addEventListener() {},
  removeEventListener() {},
  open() {},
}
globalThis.document = {
  head: { appendChild() {} },
  createElement() {
    return { dataset: {}, textContent: '', remove() {} }
  },
  querySelector() {
    return null
  },
}
globalThis.fetch = async () => {
  throw new Error('render-smoke: network disabled')
}

await import('../client.js')
if (!captured) throw new Error('client.js did not call __ModuleLoader__.load')

const registered = []
const factory = captured.factory((name) => {
  if (name === 'react') return React
  return {}
})
const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  locale: {
    register() {
      return () => {}
    },
    bind() {
      return (key) => key
    },
  },
  slots: {
    inject(_name, callback) {
      callback()
      return () => {}
    },
    register(meta, component) {
      registered.push({ meta, component })
    },
  },
}
factory.apply(ctx)

const panel = registered.find((item) => item.meta.name === 'settings.section')?.component
const icon = registered.find((item) => item.meta.name === 'sidebar.panellist')?.component
const badge = registered.find((item) => item.meta.id === 'bibao-badge')?.component
if (!panel) {
  console.log('no main panel registered (removed by design)')
  if (!badge) { console.log('FAIL badge not registered'); process.exit(1) }
  render(badge({}), 'badge')
  console.log('OK   badge')
  process.exit(0)
}

/* ---------- 真实快照 ---------- */
const brain = new BibaoBrain({
  biography,
  seed: 20261101,
  startMs: Date.now(),
  virtual: true,
  userName: '你',
  userId: 'owner',
})
brain.social.upsert({ qq: 'owner', name: '你', intimacy: 42, trust: 58, tags: ['就在对面'] })
await brain.perceive({ entityId: 'owner', text: '在干嘛呢？', channel: 'private' })
const snapshot = {
  ...brain.snapshot(),
  gate: { allPassed: true, passed: 6, total: 6, checkedAt: Date.now() },
  phase2: { unlocked: true, simulated: true },
  roster: [
    { id: '44719023', name: '阿柚', tags: ['死党'] },
    { id: '6682341', name: '陈老师', tags: ['班主任'] },
  ],
  group: {
    fovealId: 'g_class',
    groups: [
      {
        id: 'g_class',
        name: '22届毕业摸鱼群',
        layer: 'foveal',
        layerLabel: '焦点注视',
        memberCount: 186,
        unread: 3,
        buffer: [{ at: Date.now(), senderName: '老周', text: '有人在吗', atMe: false }],
      },
    ],
    pending: [],
    log: [
      {
        at: Date.now(),
        kind: 'ingest',
        group: '22届毕业摸鱼群',
        sender: '阿柚',
        text: '笑死',
        decision: 'foveal-buffer',
        reason: '焦点群消息进入防抖缓冲',
        anchors: [],
      },
    ],
    stats: { received: 1, escalated: 0, mutedIgnored: 0, debounced: 0, transfers: 0 },
    limits: { foveal: 1, peripheral: 3 },
  },
  settings: { useLlm: false, provider: '', model: '' },
}

/* ---------- 遍历渲染 ---------- */
let failures = 0
function render(node, path) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    node.forEach((child, index) => render(child, `${path}[${index}]`))
    return
  }
  if (typeof node === 'string' || typeof node === 'number') return
  if (typeof node.type === 'function') {
    if (node.type.prototype && typeof node.type.prototype.render === 'function') {
      try {
        const instance = new node.type(node.props)
        const output = instance.render()
        render(output, `${path}>${node.type.name || 'class'}`)
      } catch (error) {
        failures += 1
        console.log(`FAIL ${path} <${node.type.name || 'class'}>`)
        console.log(`     ${error?.stack?.split('\n').slice(0, 4).join('\n     ')}`)
      }
      return
    }
    let output
    try {
      output = node.type(node.props)
    } catch (error) {
      failures += 1
      console.log(`FAIL ${path} <${node.type.name || 'anonymous'}>`)
      console.log(`     ${error?.stack?.split('\n').slice(0, 4).join('\n     ')}`)
      return
    }
    render(output, `${path}>${node.type.name || 'anonymous'}`)
    return
  }
  render(node.props?.children, path)
}

for (const tab of ['brain', 'talk', 'memory', 'groups', 'gate', 'settings', 'senses']) {
  try {
    const instance = new panel({ t: (key) => key, close: () => {} })
    instance.state.snap = snapshot
    instance.syncForm(snapshot)
    instance.state.tab = tab
    instance.state.memData = { items: [], dreams: [], semantics: [], stats: { total: 0 } }
    instance.state.group = { unlocked: true, group: { groups: [], log: [], stats: {} }, roster: [] }
    instance.state.bio = {
      name: '比宝',
      oneLine: 'x',
      events: [{ age: 1, title: 't', narrative: 'n', valence: 0.2, arousal: 0.5, impact: {} }],
      relations: [],
    }
    render(instance.render(), tab)
    console.log(`OK   tab=${tab}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL tab=${tab}`)
    console.log(`     ${error?.stack?.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

console.log(`\n${failures} failure(s)`)
process.exit(failures ? 1 : 0)
