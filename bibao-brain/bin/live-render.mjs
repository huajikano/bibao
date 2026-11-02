#!/usr/bin/env node
/** 用真实快照渲染八个标签，抓运行时错误（合成快照会漏掉的字段）。 */
import { readFile } from 'node:fs/promises'

const boot = JSON.parse(await readFile(new URL('file://' + process.env.DSH_HOME.replace(/\\/g, '/') + '/bibao/boot-report.json'), 'utf8'))
const base = boot.consoleUrl.split('?')[0]
const token = new URL(boot.consoleUrl).searchParams.get('token')
const res = await fetch(`${base}api/bibao/state?token=${token}`)
const snap = await res.json()
snap.gate = { passed: 6, total: 6 }
snap.phase2 = { unlocked: true }
snap.console = { url: boot.consoleUrl }
snap.group = snap.group ?? { groups: [], log: [], stats: {} }
snap.roster = snap.roster ?? []

const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children: children.length <= 1 ? children[0] : children } }),
  Component: class {
    constructor(p) { this.props = p || {}; this.state = {} }
    setState(patch) { this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) } }
  },
}
let captured = null
globalThis.window = { __ModuleLoader__: { load: (o) => { captured = o } }, location: { origin: 'http://x' }, addEventListener() {}, removeEventListener() {} }
globalThis.document = { head: { appendChild() {} }, createElement: () => ({ dataset: {}, textContent: '', remove() {} }), querySelector: () => null }
globalThis.fetch = async () => { throw new Error('no network') }
await import('../client.js')
const factory = captured.factory((name) => (name === 'react' ? React : {}))
const regs = []
factory.apply({ effect: (f) => { f(); return () => {} }, locale: { register: () => () => {}, bind: () => (k) => k }, slots: { inject: (_n, cb) => { cb(); return () => {} }, register: (meta, comp) => regs.push({ meta, comp }) } })

const Panel = regs[0].comp
const failures = []
for (const tab of ['brain', 'talk', 'memory', 'groups', 'gate', 'settings', 'senses', 'friends']) {
  try {
    const inst = new Panel({ t: (k) => k })
    inst.state.snap = snap
    inst.syncForm(snap)
    inst.state.tab = tab
    walk(inst.render())
    console.log(`OK   tab=${tab}`)
  } catch (error) {
    failures.push(`${tab}: ${error.message}`)
    console.log(`FAIL tab=${tab} — ${error.message}`)
  }
}

function walk(node) {
  if (!node || typeof node === 'string') return
  if (Array.isArray(node)) return node.forEach(walk)
  if (typeof node.type === 'function') {
    const proto = node.type.prototype
    if (proto && typeof proto.render === 'function') return walk(new node.type(node.props).render())
    return walk(node.type(node.props))
  }
  if (node.props?.children) walk(node.props.children)
}

console.log(`\n${8 - failures.length}/8 通过`)
process.exit(failures.length ? 1 : 0)
