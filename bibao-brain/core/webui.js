/**
 * 独立页面（不依赖 DSH 的 React 槽位）。
 *
 * 用途：当主面板/设置页在浏览器里画不出来时，仍有一个能看状态、能说话、
 * 能配模型和 key、能跑验脑的界面。它只调用同一套 /api/bibao/* 接口。
 */

export function renderUiHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>比宝 · 脑内</title>
<style>
:root { color-scheme: light dark; --bg:#f7f6f3; --panel:#fff; --line:#e4e1da; --ink:#1f1d1a; --mute:#6b665e; --brand:#6C5CE7; }
@media (prefers-color-scheme: dark) { :root { --bg:#16151a; --panel:#1e1d24; --line:#332f3c; --ink:#ece9f2; --mute:#a9a3b5; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
.wrap { max-width:1040px; margin:0 auto; padding:20px 18px 60px; display:flex; flex-direction:column; gap:14px; }
header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 16px; border:1px solid var(--line); border-radius:16px; background:var(--panel); }
h1 { margin:0; font-size:18px; }
.sub { color:var(--mute); font-size:12px; }
.chips { margin-left:auto; display:flex; gap:6px; flex-wrap:wrap; }
.chip { border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:11.5px; color:var(--mute); }
.chip.on { color:var(--ink); border-color:color-mix(in oklab, var(--brand) 45%, transparent); background:color-mix(in oklab, var(--brand) 12%, transparent); }
.grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); }
.card { border:1px solid var(--line); border-radius:16px; background:var(--panel); padding:14px 16px; }
.card h2 { margin:0 0 8px; font-size:13px; }
.row { display:flex; justify-content:space-between; gap:8px; font-size:12.5px; padding:2px 0; }
.bar { height:6px; border-radius:999px; background:var(--line); overflow:hidden; margin-top:4px; }
.bar > i { display:block; height:100%; background:var(--brand); }
.muted { color:var(--mute); font-size:11.5px; }
input, select, textarea, button { font:inherit; }
input, select, textarea { background:var(--panel); color:var(--ink); border:1px solid var(--line); border-radius:9px; padding:6px 9px; width:100%; }
button { cursor:pointer; border-radius:9px; border:1px solid var(--line); background:var(--panel); color:var(--ink); padding:6px 12px; }
button.primary { background:var(--brand); border-color:transparent; color:#fff; }
button:disabled { opacity:.5; cursor:default; }
.stack { display:flex; flex-direction:column; gap:8px; }
.inline { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.bubble { border:1px solid var(--line); border-radius:12px; padding:6px 10px; display:inline-block; margin:2px 0; }
.me { background:color-mix(in oklab, var(--brand) 14%, var(--panel)); }
.thread { display:flex; flex-direction:column; gap:8px; max-height:44vh; overflow:auto; }
.inner { border-left:2px solid var(--brand); padding:2px 8px; color:var(--mute); font-size:11.5px; }
.log { max-height:240px; overflow:auto; font-size:11.5px; }
.log div { padding:3px 0; border-bottom:1px dashed var(--line); }
label.field { display:flex; gap:8px; align-items:center; }
label.field > span { flex:0 0 78px; color:var(--mute); font-size:11.5px; }
.ok { color:#1f9d55; } .bad { color:#d64545; }
pre { white-space:pre-wrap; font-size:11px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>比宝 · 脑内</h1>
      <div class="sub" id="identity">正在唤醒…</div>
    </div>
    <div class="chips" id="chips"></div>
  </header>

  <div class="grid">
    <section class="card">
      <h2>神经状态</h2>
      <div id="neuro" class="stack"></div>
    </section>
    <section class="card">
      <h2>工作空间</h2>
      <div id="slots" class="stack"></div>
      <div class="muted" id="theta"></div>
    </section>
  </div>

  <section class="card">
    <h2>和比宝说话</h2>
    <div class="thread" id="thread"></div>
    <div class="inline" style="margin-top:8px">
      <input id="msg" placeholder="说点什么，回车发送" />
      <button class="primary" id="send">发送</button>
      <label class="muted"><input type="checkbox" id="inner" checked style="width:auto" /> 内心独白</label>
    </div>
    <div class="muted" id="talkMeta"></div>
  </section>

  <div class="grid">
    <section class="card">
      <h2>模型与 Key（每个逻辑可各配一套）</h2>
      <div class="stack">
        <label class="field"><span>baseURL</span><input id="baseURL" placeholder="https://api.deepseek.com" /></label>
        <label class="field"><span>model</span><input id="model" placeholder="deepseek-chat" /></label>
        <label class="field"><span>apiKey</span><input id="apiKey" type="password" placeholder="留空 = 不变" /></label>
        <div id="profiles" class="stack"></div>
      </div>
    </section>

    <section class="card">
      <h2>snowluma</h2>
      <div class="stack">
        <label class="field"><span>允许群</span><input id="allowGroups" placeholder="576268399" /></label>
        <div class="inline">
          <label class="muted"><input type="checkbox" id="allowSend" style="width:auto" /> 允许真的发到 QQ</label>
          <label class="muted"><input type="checkbox" id="allowPrivate" style="width:auto" /> 允许私聊</label>
        </div>
        <div class="inline">
          <button class="primary" id="save">保存全部</button>
          <button id="gate">跑 6 大验脑</button>
          <button id="sendTest">往群里发一条</button>
        </div>
        <div class="muted" id="saveState"></div>
        <div class="log" id="gateOut"></div>
      </div>
    </section>
  </div>

  <div class="grid">
    <section class="card"><h2>内心独白</h2><div class="stack" id="innerLog"></div></section>
    <section class="card"><h2>记忆（最近）</h2><div class="stack" id="memory"></div></section>
  </div>
</div>
<script>
const API = '/api/bibao'
let snap = null
const $ = (id) => document.getElementById(id)
const esc = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

async function req(path, options) {
  const opts = options || {}
  let url = API + path
  // 控制台的请求体在某些链路里会丢，POST 的 JSON 同时塞进查询串，服务端优先读 body
  if (opts.method === 'POST' && typeof opts.body === 'string') {
    url += (url.includes('?') ? '&' : '?') + 'payload=' + encodeURIComponent(opts.body)
  }
  const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!res.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status)
  return data
}

function render(s) {
  snap = s
  $('identity').textContent = s.identity.oneLine + ' · ' + s.identity.age + ' 岁'
  const cortisol = (s.neuro.hormones.find((h) => h.key === 'cortisol') || {}).value || 0
  $('chips').innerHTML = [
    '<span class="chip on">' + esc(s.neuro.moodLabel) + '</span>',
    '<span class="chip">皮质醇 ' + Math.round(cortisol * 100) + '</span>',
    '<span class="chip">精力 ' + Math.round(s.neuro.energy) + '</span>',
    '<span class="chip">' + esc(s.clock.label) + '</span>',
    '<span class="chip ' + (s.snow && s.snow.connected ? 'on' : '') + '">snowluma ' + (s.snow && s.snow.connected ? '在线' : '离线') + '</span>',
    '<span class="chip ' + (s.workspace.hijacked ? 'on' : '') + '">' + (s.workspace.hijacked ? '杏仁核劫持' : '常态') + '</span>'
  ].join('')

  $('neuro').innerHTML = s.neuro.hormones.map((h) =>
    '<div><div class="row"><span>' + esc(h.label) + '</span><span>' + Math.round(h.value * 100) + '</span></div>' +
    '<div class="bar"><i style="width:' + Math.round(h.value * 100) + '%"></i></div></div>'
  ).join('')

  $('slots').innerHTML = s.workspace.slots.length
    ? s.workspace.slots.map((slot) =>
        '<div><div class="row"><span>' + esc(slot.title) + '</span><span class="muted">' + esc(slot.kind) + '</span></div>' +
        '<div class="muted">sal ' + slot.salience + ' · act ' + slot.activation + (slot.written ? ' · 已落库' : ' · 未落库') + '</div></div>'
      ).join('')
    : '<div class="muted">空</div>'
  $('theta').textContent = 'Θ = ' + s.threshold.value + ' · 容量 ' + s.workspace.capacity + ' · 静默 ' + s.clock.silenceMin + ' 分钟'

  $('innerLog').innerHTML = (s.inner || []).slice(-8).reverse().map((item) =>
    '<div class="inner"><div class="muted">' + esc(item.kind) + ' · ' + esc(item.source || '') + '</div>' + esc(item.thought) + '</div>'
  ).join('') || '<div class="muted">还没有</div>'

  $('memory').innerHTML = (s.memory.recent || []).slice(0, 8).map((m) =>
    '<div><div class="row"><span>' + esc(m.title) + '</span><span class="muted">' + esc(m.tier) + ' · R ' + m.r + '</span></div>' +
    (m.narrative ? '<div class="muted">' + esc(m.narrative) + '</div>' : '') + '</div>'
  ).join('')

  if (document.activeElement !== $('baseURL')) $('baseURL').value = s.llmConfig.baseURL || ''
  if (document.activeElement !== $('model')) $('model').value = s.llmConfig.model || ''
  $('apiKey').placeholder = s.llmConfig.hasKey ? s.llmConfig.keyMask + '（留空 = 不变）' : '留空 = 不变'
  $('allowGroups').value = (s.snow.allowGroups || []).join(',')
  $('allowSend').checked = !!s.snow.sendEnabled
  $('allowPrivate').checked = !!s.snow.allowPrivate

  const prof = s.llmConfig.profiles || []
  if (!$('profiles').dataset.built) {
    $('profiles').innerHTML = prof.map((p) =>
      '<div class="stack" data-logic="' + p.name + '" style="border-top:1px dashed var(--line);padding-top:6px">' +
      '<div class="row"><strong>' + p.name + '</strong><span class="chip ' + (p.active ? 'on' : '') + '">' + esc(p.source) + '</span></div>' +
      '<label class="field"><span>baseURL</span><input data-k="baseURL" placeholder="继承默认" /></label>' +
      '<label class="field"><span>model</span><input data-k="model" placeholder="继承默认" /></label>' +
      '<label class="field"><span>apiKey</span><input data-k="apiKey" type="password" placeholder="继承默认" /></label>' +
      '</div>'
    ).join('')
    $('profiles').dataset.built = '1'
  }
  for (const p of prof) {
    const box = $('profiles').querySelector('[data-logic="' + p.name + '"]')
    if (!box) continue
    const b = box.querySelector('[data-k="baseURL"]')
    const m = box.querySelector('[data-k="model"]')
    if (document.activeElement !== b) b.value = p.baseURL || ''
    if (document.activeElement !== m) m.value = p.model || ''
    box.querySelector('[data-k="apiKey"]').placeholder = p.hasKey ? p.keyMask + '（留空 = 不变）' : '继承默认'
  }
}

async function refresh() {
  try { render(await req('/state')) } catch (e) { $('identity').textContent = '读取失败：' + e.message }
}

$('send').onclick = async () => {
  const text = $('msg').value.trim()
  if (!text) return
  $('msg').value = ''
  const thread = $('thread')
  thread.insertAdjacentHTML('beforeend', '<div style="text-align:right"><span class="bubble me">' + esc(text) + '</span></div>')
  $('send').disabled = true
  try {
    const data = await req('/talk', { method: 'POST', body: JSON.stringify({ text }) })
    const r = data.result
    if (!r.ignited) {
      thread.insertAdjacentHTML('beforeend', '<div class="muted">没进意识：' + esc(r.reason) + '（sal ' + r.salience + ' < Θ ' + r.theta + '）</div>')
    } else {
      for (const step of r.motor || []) {
        await new Promise((res) => setTimeout(res, Math.max(80, step.delayMs)))
        thread.insertAdjacentHTML('beforeend', '<div><span class="bubble">' + esc(step.text) + '</span></div>')
      }
      if (!(r.motor || []).length) thread.insertAdjacentHTML('beforeend', '<div class="muted">（' + esc(r.dual.action_route) + '：压住不发）</div>')
      if ($('inner').checked) thread.insertAdjacentHTML('beforeend', '<div class="inner">' + esc(r.dual.inner_monologue) + '</div>')
      $('talkMeta').textContent = r.dual.action_route + ' · PE ' + r.pe + ' · sal ' + r.salience + ' · 预算 ' + r.budget.maxChars + ' 字 · ' + (r.dual.meta.source || 'local')
    }
    thread.scrollTop = thread.scrollHeight
    render(data.snapshot)
  } catch (e) {
    thread.insertAdjacentHTML('beforeend', '<div class="bad">' + esc(e.message) + '</div>')
  } finally {
    $('send').disabled = false
  }
}
$('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('send').click() })

$('save').onclick = async () => {
  $('saveState').textContent = '保存中…'
  const llm = { baseURL: $('baseURL').value, model: $('model').value, profiles: {} }
  if ($('apiKey').value) llm.apiKey = $('apiKey').value
  for (const box of $('profiles').querySelectorAll('[data-logic]')) {
    const entry = { enabled: true }
    const b = box.querySelector('[data-k="baseURL"]').value
    const m = box.querySelector('[data-k="model"]').value
    const k = box.querySelector('[data-k="apiKey"]').value
    if (b) entry.baseURL = b
    if (m) entry.model = m
    if (k) entry.apiKey = k
    llm.profiles[box.dataset.logic] = entry
  }
  try {
    const data = await req('/settings', {
      method: 'POST',
      body: JSON.stringify({
        llm,
        snowluma: {
          sendEnabled: $('allowSend').checked,
          allowPrivate: $('allowPrivate').checked,
          allowGroups: $('allowGroups').value.split(/[\\s,，]+/).filter(Boolean),
        },
      }),
    })
    $('saveState').textContent = '已保存（' + new Date().toLocaleTimeString() + '）'
    $('apiKey').value = ''
    for (const k of $('profiles').querySelectorAll('[data-k="apiKey"]')) k.value = ''
    render(data.snapshot)
  } catch (e) { $('saveState').textContent = '保存失败：' + e.message }
}

$('sendTest').onclick = async () => {
  $('gateOut').textContent = '发送中…'
  try {
    const data = await req('/snowluma/test', { method: 'POST', body: JSON.stringify({ text: '在 我上线了' }) })
    $('gateOut').textContent = '已发送到群 ' + data.groupId + '（message_id ' + data.messageId + '）'
  } catch (e) { $('gateOut').textContent = '发送失败：' + e.message }
}

$('gate').onclick = async () => {
  $('gateOut').textContent = '推演中…'
  try {
    const data = await req('/sandbox/run', { method: 'POST', body: '{}' })
    $('gateOut').innerHTML = data.gate.results.map((r) =>
      '<div>' + (r.passed ? '✅' : '❌') + ' ' + esc(r.id) + ' ' + esc(r.name) + '</div>'
    ).join('') + '<div class="muted">' + data.gate.passed + '/' + data.gate.total + ' · ' + (data.gate.phase2Unlocked ? 'Phase 2 可挂载' : 'Phase 2 锁死') + '</div>'
  } catch (e) { $('gateOut').textContent = e.message }
}

refresh()
setInterval(refresh, 4000)
</script>
</body>
</html>`
}
