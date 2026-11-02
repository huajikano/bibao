/**
 * 独立页面（不依赖 DSH 的 React 槽位）。
 *
 * 用途：当主面板在浏览器里画不出来时，仍有一个能看状态、能说话、
 * 能配模型、能管好友和表情包的界面。它只调用同一套 /api/bibao/* 接口。
 * 视觉风格与设置页保持一致：同一套卡片 / 芯片 / 标签页。
 */

export function renderUiHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>比宝 · 控制台</title>
<style>
:root { color-scheme: light dark; --bg:#f7f6f3; --panel:#fff; --line:#e4e1da; --ink:#1f1d1a; --mute:#6b665e; --brand:#6C5CE7; --ok:#1f9d55; --bad:#c0392b; }
@media (prefers-color-scheme: dark) { :root { --bg:#16151a; --panel:#1e1d24; --line:#332f3c; --ink:#ece9f2; --mute:#a9a3b5; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
.wrap { max-width:1060px; margin:0 auto; padding:20px 18px 60px; display:flex; flex-direction:column; gap:14px; }
header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 16px; border:1px solid var(--line); border-radius:16px; background:var(--panel); }
h1 { margin:0; font-size:18px; }
.sub { color:var(--mute); font-size:12px; }
.chips { margin-left:auto; display:flex; gap:6px; flex-wrap:wrap; }
.chip { border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:11.5px; color:var(--mute); }
.chip.on { color:var(--ink); border-color:color-mix(in oklab, var(--brand) 45%, transparent); background:color-mix(in oklab, var(--brand) 12%, transparent); }
.chip.bad { color:var(--bad); border-color:color-mix(in oklab, var(--bad) 45%, transparent); }
nav { display:flex; gap:6px; flex-wrap:wrap; }
nav button { font:inherit; font-size:12.5px; padding:6px 12px; border-radius:999px; border:1px solid var(--line); background:var(--panel); color:var(--mute); cursor:pointer; }
nav button.on { color:var(--ink); border-color:color-mix(in oklab, var(--brand) 45%, transparent); background:color-mix(in oklab, var(--brand) 12%, transparent); }
.panel { display:none; flex-direction:column; gap:14px; }
.panel.on { display:flex; }
.card { border:1px solid var(--line); border-radius:16px; background:var(--panel); padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
.card h2 { margin:0; font-size:13.5px; display:flex; align-items:center; gap:8px; }
.card h2 span { color:var(--mute); font-weight:400; font-size:11.5px; }
.grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); }
.row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.muted { color:var(--mute); font-size:12px; }
label.field { display:flex; flex-direction:column; gap:4px; font-size:11.5px; color:var(--mute); }
input[type=text], input[type=password], input[type=number], textarea, select {
  font:inherit; font-size:13px; color:var(--ink); background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:8px 10px; width:100%;
}
textarea { resize:vertical; min-height:64px; }
button.btn { font:inherit; font-size:12.5px; padding:7px 14px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:var(--ink); cursor:pointer; }
button.btn.primary { border-color:color-mix(in oklab, var(--brand) 55%, transparent); background:color-mix(in oklab, var(--brand) 16%, transparent); }
button.btn:disabled { opacity:.5; cursor:default; }
input[type=range] { width:100%; accent-color:var(--brand); }
.stat { display:flex; justify-content:space-between; gap:10px; font-size:12.5px; }
.list { display:flex; flex-direction:column; gap:6px; max-height:340px; overflow:auto; }
.item { border:1px solid var(--line); border-radius:10px; padding:8px 10px; font-size:12.5px; display:flex; gap:8px; align-items:center; }
.item .grow { flex:1 1 auto; min-width:0; }
.stickers { display:grid; grid-template-columns:repeat(auto-fill, minmax(112px, 1fr)); gap:10px; }
.sticker { border:1px solid var(--line); border-radius:12px; padding:6px; display:flex; flex-direction:column; gap:5px; background:var(--bg); }
.sticker img { width:100%; height:96px; object-fit:contain; border-radius:8px; background:var(--panel); }
.sticker .gist { font-size:11px; color:var(--mute); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.toast { position:sticky; bottom:12px; align-self:center; padding:8px 14px; border-radius:999px; background:var(--ink); color:var(--bg); font-size:12.5px; opacity:0; transition:opacity .2s; }
.toast.on { opacity:.92; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1 id="name">比宝</h1>
      <div class="sub" id="oneLine">正在唤醒…</div>
    </div>
    <div class="chips" id="chips"></div>
  </header>

  <nav id="tabs">
    <button data-tab="brain" class="on">脑内</button>
    <button data-tab="talk">对话</button>
    <button data-tab="memory">记忆</button>
    <button data-tab="groups">群聊</button>
    <button data-tab="friends">好友</button>
    <button data-tab="stickers">表情包</button>
    <button data-tab="settings">设置</button>
  </nav>

  <section class="panel on" id="panel-brain">
    <div class="grid">
      <div class="card"><h2>神经状态 <span id="clock"></span></h2><div id="neuro"></div></div>
      <div class="card"><h2>工作空间 <span id="threshold"></span></h2><div id="slots" class="list"></div></div>
    </div>
    <div class="grid">
      <div class="card"><h2>她今天 <span id="lifeDay"></span></h2><div class="list" id="life"></div></div>
      <div class="card"><h2>自我复盘 <span id="selfMeta"></span></h2><div class="list" id="self"></div></div>
    </div>
    <div class="card"><h2>接口 <span id="bciCount"></span></h2><div class="list" id="bci"></div></div>
    <div class="card"><h2>内心独白</h2><div class="list" id="inner"></div></div>
  </section>

  <section class="panel" id="panel-talk">
    <div class="card">
      <h2>和比宝说话 <span>先看状态，再决定回不回</span></h2>
      <div class="row">
        <input type="text" id="talkText" placeholder="说点什么…" style="flex:1 1 260px" />
        <button class="btn primary" id="talkSend">发送</button>
      </div>
      <div class="list" id="talkLog"></div>
    </div>
  </section>

  <section class="panel" id="panel-memory">
    <div class="grid">
      <div class="card"><h2>记忆分层 <span id="memStats"></span></h2><div class="list" id="memory"></div></div>
      <div class="card"><h2>长期记住的事</h2><div class="list" id="facts"></div></div>
    </div>
  </section>

  <section class="panel" id="panel-groups">
    <div class="card"><h2>群聊状态 <span>焦点只有一个，余光最多三个</span></h2><div class="list" id="groups"></div></div>
    <div class="card"><h2>漏斗日志</h2><div class="list" id="groupLog"></div></div>
  </section>

  <section class="panel" id="panel-friends">
    <div class="card"><h2>好友管理 <span id="friendCount"></span></h2><div class="list" id="friends"></div></div>
  </section>

  <section class="panel" id="panel-stickers">
    <div class="card">
      <h2>表情包收藏 <span id="stickerStats"></span></h2>
      <div class="row">
        <button class="btn primary" id="stickerImport">导入表情包</button>
        <input type="file" id="stickerFile" accept="image/*" multiple hidden />
        <span class="muted">一次最多 10 张，自动让视觉模型写梗概和情绪</span>
      </div>
      <div class="stickers" id="stickerGrid"></div>
    </div>
  </section>

  <section class="panel" id="panel-settings">
    <div class="card">
      <h2>行为调节 <span>拉满就是当前表现</span></h2>
      <label class="field">记忆力 <span id="memLabel"></span><input type="range" id="memoryStrength" min="0" max="1" step="0.05" /></label>
      <label class="field">说话频率 <span id="talkLabel"></span><input type="range" id="talkativeness" min="0" max="1" step="0.05" /></label>
      <label class="field"><input type="checkbox" id="growthSelfReview" /> 自我复盘（把对话里的反馈变成说话经验）</label>
      <label class="field"><input type="checkbox" id="growthLife" /> 生活流（让她有自己的今天）</label>
      <label class="field"><input type="checkbox" id="outreachEnabled" /> 允许她偶尔主动私聊（默认关，需要同时允许私聊）</label>
    </div>
    <div class="card">
      <h2>对话模型 <span>必须写 provider/model</span></h2>
      <div class="grid">
        <label class="field">baseURL<input type="text" id="baseURL" /></label>
        <label class="field">模型<input type="text" id="model" /></label>
        <label class="field">API Key<input type="password" id="apiKey" placeholder="留空不变" /></label>
      </div>
    </div>
    <div class="card">
      <h2>视觉模型 <span>看图用，和对话模型分开</span></h2>
      <div class="grid">
        <label class="field">模型<input type="text" id="visionModel" /></label>
        <label class="field">每小时上限<input type="number" id="visionMax" min="1" max="200" /></label>
      </div>
      <div class="row">
        <label class="row"><input type="checkbox" id="visionEnabled" /> 允许她自动看群里的图</label>
        <button class="btn" id="visionTest">测试一下</button>
      </div>
    </div>
    <div class="card">
      <h2>snowluma</h2>
      <div class="grid">
        <label class="field">HTTP<input type="text" id="httpBase" /></label>
        <label class="field">HTTP token<input type="password" id="httpToken" placeholder="留空不变" /></label>
        <label class="field">WS<input type="text" id="wsUrl" /></label>
        <label class="field">WS token<input type="password" id="wsToken" placeholder="留空不变" /></label>
        <label class="field">允许群<input type="text" id="allowGroups" /></label>
      </div>
      <div class="row">
        <label class="row"><input type="checkbox" id="sendEnabled" /> 允许发送</label>
        <label class="row"><input type="checkbox" id="recallEnabled" /> 允许冲动撤回</label>
        <label class="row"><input type="checkbox" id="stickersEnabled" /> 允许发表情包</label>
      </div>
    </div>
    <div class="row"><button class="btn primary" id="save">保存全部</button><span class="muted" id="saveNote"></span></div>
  </section>

  <div class="toast" id="toast"></div>
</div>
<script>
const token = new URL(location.href).searchParams.get('token') || '';
const api = async (path, opts) => {
  const url = '/api/bibao' + path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
  return data;
};
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const el = (id) => document.getElementById(id);
const esc = (value) => String(value == null ? '' : value).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
let toastTimer = null;
function toast(text) {
  const node = el('toast');
  node.textContent = text;
  node.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('on'), 2600);
}

document.querySelectorAll('#tabs button').forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll('#tabs button').forEach((other) => other.classList.toggle('on', other === button));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('on'));
    el('panel-' + button.dataset.tab).classList.add('on');
    if (button.dataset.tab === 'friends') loadFriends();
    if (button.dataset.tab === 'stickers') loadStickers();
    if (button.dataset.tab === 'groups') loadGroups();
  };
});

let snap = null;
function renderHeader(state) {
  el('name').textContent = state.identity.name;
  el('oneLine').textContent = state.identity.oneLine || '';
  el('clock').textContent = state.clock.day + ' ' + state.clock.label;
  const chips = [];
  chips.push('<span class="chip">精力 ' + Math.round(state.neuro.energy) + '</span>');
  chips.push('<span class="chip">皮质醇 ' + state.neuro.cortisol.toFixed(2) + '</span>');
  if (state.llm && state.llm.enabled) chips.push('<span class="chip on">语言区 ' + esc(state.llm.model) + '</span>');
  else chips.push('<span class="chip bad">语言区离线</span>');
  if (state.llm && state.llm.lastError) chips.push('<span class="chip bad">语言区降级</span>');
  if (state.vision) chips.push('<span class="chip">视觉 ' + esc(state.vision.model) + '</span>');
  el('chips').innerHTML = chips.join('');
}
function renderGrowth(state) {
  const life = state.life || {};
  el('lifeDay').textContent = life.dayKey || '';
  const rows = (life.today || []).slice(-5).map((item) => ({ label: item.label, text: item.text }));
  if (life.current) rows.push({ label: '刚才', text: life.current.text });
  el('life').innerHTML = rows.length
    ? rows.map((item) => '<div class="item"><span class="muted">' + esc(item.label) + '</span><span class="grow">' + esc(item.text) + '</span></div>').join('')
    : '<div class="muted">今天还没发生什么</div>';
  const self = state.self || {};
  el('selfMeta').textContent = (self.reviews || 0) + ' 次复盘';
  const lines = [];
  if (self.styleLine) lines.push({ label: '倾向', text: self.styleLine });
  if (self.narrative) lines.push({ label: '自述', text: self.narrative });
  for (const lesson of (self.lessons || []).slice(0, 4)) lines.push({ label: '学到', text: lesson.text });
  el('self').innerHTML = lines.length
    ? lines.map((item) => '<div class="item"><span class="muted">' + esc(item.label) + '</span><span class="grow">' + esc(item.text) + '</span></div>').join('')
    : '<div class="muted">还没复盘过</div>';
  const bci = state.bci || {};
  el('bciCount').textContent = (bci.adapters || []).length + ' 个通道 · 动作默认关闭';
  el('bci').innerHTML = (bci.adapters || []).length
    ? bci.adapters.map((adapter) => '<div class="item"><span class="grow">' + esc(adapter.label) + ' <span class="muted">' + esc((adapter.capabilities || []).join(' / ')) + '</span></span><span class="muted">' + (adapter.readOnly ? '只读' : '可动作') + '</span></div>').join('')
    : '<div class="muted">还没有注册接口</div>';
}

function renderBrain(state) {
  const n = state.neuro;
  el('neuro').innerHTML = [
    ['精力', Math.round(n.energy) + '%'],
    ['皮质醇', n.cortisol.toFixed(2)],
    ['多巴胺', n.dopamine.toFixed(2)],
    ['催产素', n.oxytocin.toFixed(2)],
    ['血清素', n.serotonin.toFixed(2)],
    ['心境', n.mood],
  ].map((pair) => '<div class="stat"><span class="muted">' + pair[0] + '</span><span>' + esc(pair[1]) + '</span></div>').join('');
  el('threshold').textContent = '阈值 ' + Number(state.threshold || 0).toFixed(2);
  const slots = state.workspace.slots || [];
  el('slots').innerHTML = slots.length
    ? slots.map((slot) => '<div class="item"><span class="grow">' + esc(slot.title || slot.content || '') + '</span><span class="muted">' + Number(slot.salience || 0).toFixed(2) + '</span></div>').join('')
    : '<div class="muted">工作空间是空的</div>';
  const inner = (state.inner || []).slice(-8).reverse();
  el('inner').innerHTML = inner.length
    ? inner.map((item) => '<div class="item"><span class="grow">' + esc(item.thought || '') + '</span><span class="muted">' + esc(item.kind || '') + '</span></div>').join('')
    : '<div class="muted">还没有独白</div>';
  const stats = state.memory.stats || {};
  el('memStats').textContent = '共 ' + (stats.total || 0) + ' · 显意识 ' + (stats.conscious || 0) + ' · 潜意识 ' + (stats.subconscious || 0);
  const rows = (state.memory.recent || []).slice(0, 12);
  el('memory').innerHTML = rows.length
    ? rows.map((row) => '<div class="item"><span class="grow">' + esc(row.title || '') + '</span><span class="muted">' + esc(row.tier || '') + '</span></div>').join('')
    : '<div class="muted">还没有记忆</div>';
  const facts = state.facts || [];
  el('facts').innerHTML = facts.length
    ? facts.map((fact) => '<div class="item"><span class="grow">' + esc(fact.text) + '</span><span class="muted">' + Math.round((fact.confidence || 0) * 100) + '%</span></div>').join('')
    : '<div class="muted">还没有归纳出事实</div>';
}

async function refresh() {
  try {
    const state = await api('/state');
    snap = state;
    renderHeader(state);
    renderBrain(state);
    renderGrowth(state);
    fillSettings(state);
  } catch (error) {
    toast('读取失败：' + error.message);
  }
}

function fillSettings(state) {
  const form = {
    baseURL: (state.llmConfig && state.llmConfig.baseURL) || '',
    model: (state.llm && state.llm.model) || '',
    visionModel: (state.vision && state.vision.model) || '',
    visionMax: (state.vision && state.vision.maxPerHour) || 20,
    httpBase: (state.snow && state.snow.httpBase) || '',
    wsUrl: (state.snow && state.snow.wsUrl) || '',
    allowGroups: ((state.snow && state.snow.allowGroups) || []).join(','),
  };
  for (const key of Object.keys(form)) {
    const node = el(key);
    if (node && !node.dataset.dirty) node.value = form[key];
  }
  el('visionEnabled').checked = !!(state.vision && state.vision.enabled);
  el('growthSelfReview').checked = !state.growth || state.growth.selfReview !== false;
  el('growthLife').checked = !state.growth || state.growth.life !== false;
  el('outreachEnabled').checked = !!(state.outreach && state.outreach.enabled);
  el('sendEnabled').checked = !!(state.snow && state.snow.sendEnabled);
  el('recallEnabled').checked = !!(state.snow && state.snow.recallEnabled);
  el('stickersEnabled').checked = !state.snow || state.snow.stickers !== false;
  if (!el('memoryStrength').dataset.dirty && state.tuning) {
    el('memoryStrength').value = state.tuning.memoryStrength;
    el('talkativeness').value = state.tuning.talkativeness;
    labels();
  }
}

function labels() {
  const memory = Number(el('memoryStrength').value);
  const days = 60 * Math.pow(10, (memory - 1) * 4);
  el('memLabel').textContent = memory >= 0.995
    ? '拉满'
    : days < 1 / 24
      ? '半衰期约 ' + Math.round(days * 1440) + ' 分钟'
      : days < 1
        ? '半衰期约 ' + Math.round(days * 24) + ' 小时'
        : '半衰期约 ' + days.toFixed(1) + ' 天';
  const talk = Number(el('talkativeness').value);
  el('talkLabel').textContent = talk >= 0.995
    ? '拉满'
    : '冷却 ' + Math.round((1 - talk) * 30) + ' 秒，一次约 ' + Math.max(1, Math.round(3 * (0.35 + 0.65 * talk))) + ' 句';
}
el('memoryStrength').oninput = () => { el('memoryStrength').dataset.dirty = '1'; labels(); };
el('talkativeness').oninput = () => { el('talkativeness').dataset.dirty = '1'; labels(); };
['baseURL', 'model', 'visionModel', 'visionMax', 'httpBase', 'wsUrl', 'allowGroups', 'apiKey', 'httpToken', 'wsToken'].forEach((id) => {
  el(id).addEventListener('input', () => { el(id).dataset.dirty = '1'; });
});

el('save').onclick = async () => {
  el('saveNote').textContent = '保存中…';
  try {
    const body = {
      llm: { baseURL: el('baseURL').value, model: el('model').value },
      vision: { model: el('visionModel').value, maxPerHour: Number(el('visionMax').value), enabled: el('visionEnabled').checked },
      snowluma: {
        httpBase: el('httpBase').value,
        wsUrl: el('wsUrl').value,
        allowGroups: el('allowGroups').value.split(/[\\s,，]+/).filter(Boolean),
        sendEnabled: el('sendEnabled').checked,
        recallEnabled: el('recallEnabled').checked,
        stickers: el('stickersEnabled').checked,
      },
      tuning: { memoryStrength: Number(el('memoryStrength').value), talkativeness: Number(el('talkativeness').value) },
      growth: { selfReview: el('growthSelfReview').checked, life: el('growthLife').checked },
      outreach: { enabled: el('outreachEnabled').checked },
    };
    if (el('apiKey').value) body.llm.apiKey = el('apiKey').value;
    if (el('httpToken').value) body.snowluma.httpToken = el('httpToken').value;
    if (el('wsToken').value) body.snowluma.wsToken = el('wsToken').value;
    await post('/settings', body);
    document.querySelectorAll('[data-dirty]').forEach((node) => { delete node.dataset.dirty; });
    el('apiKey').value = '';
    el('httpToken').value = '';
    el('wsToken').value = '';
    el('saveNote').textContent = '已保存';
    toast('已保存');
    refresh();
  } catch (error) {
    el('saveNote').textContent = '保存失败：' + error.message;
  }
};
el('visionTest').onclick = async () => {
  el('saveNote').textContent = '测试视觉中…';
  try {
    const data = await post('/vision/test', {});
    el('saveNote').textContent = '可用：' + data.text + '（' + data.ms + 'ms）';
  } catch (error) {
    el('saveNote').textContent = '测试失败：' + error.message;
  }
};

el('talkSend').onclick = async () => {
  const text = el('talkText').value.trim();
  if (!text) return;
  el('talkText').value = '';
  const log = el('talkLog');
  log.insertAdjacentHTML('afterbegin', '<div class="item"><span class="grow">我：' + esc(text) + '</span></div>');
  try {
    const data = await api('/talk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text, entityId: 'owner' }) });
    const bubbles = (data.result && data.result.dual && data.result.dual.bubbles) || [];
    const who = (data.identity && data.identity.name) || '比宝';
    log.insertAdjacentHTML('afterbegin', '<div class="item"><span class="grow">' + esc(who) + '：' + esc(bubbles.join(' / ') || '（沉默）') + '</span></div>');
    refresh();
  } catch (error) {
    log.insertAdjacentHTML('afterbegin', '<div class="item"><span class="grow">失败：' + esc(error.message) + '</span></div>');
  }
};
el('talkText').addEventListener('keydown', (event) => { if (event.key === 'Enter') el('talkSend').click(); });

async function loadGroups() {
  try {
    const data = await api('/group/state');
    const groups = (data.group && data.group.groups) || [];
    el('groups').innerHTML = groups.map((group) => {
      const layer = group.layer || 'muted';
      const buttons = ['foveal', 'peripheral', 'muted'].map((key) =>
        '<button class="btn" data-group="' + esc(group.id) + '" data-layer="' + key + '"' + (layer === key ? ' style="border-color:var(--brand)"' : '') + '>' +
        (key === 'foveal' ? '焦点' : key === 'peripheral' ? '余光' : '免打扰') + '</button>').join('');
      return '<div class="item"><span class="grow">' + esc(group.name) + ' <span class="muted">' + (group.memberCount || 0) + ' 人</span></span>' + buttons + '</div>';
    }).join('') || '<div class="muted">还没有群</div>';
    el('groups').querySelectorAll('button[data-group]').forEach((button) => {
      button.onclick = async () => {
        await post('/group/layer', { groupId: button.dataset.group, layer: button.dataset.layer });
        loadGroups();
      };
    });
    const log = (data.group && data.group.log) || [];
    el('groupLog').innerHTML = log.slice(-12).reverse().map((entry) =>
      '<div class="item"><span class="grow">' + esc(entry.text || entry.reason || entry.kind) + '</span><span class="muted">' + esc(entry.kind) + '</span></div>').join('') || '<div class="muted">还没有日志</div>';
  } catch (error) {
    toast('群聊读取失败：' + error.message);
  }
}

async function loadFriends() {
  try {
    const data = await api('/friends');
    const friends = data.friends || [];
    el('friendCount').textContent = '共 ' + friends.length + ' 人';
    el('friends').innerHTML = friends.map((friend) =>
      '<div class="item" style="flex-direction:column;align-items:stretch">' +
        '<div class="row"><strong>' + esc(friend.name) + '</strong><span class="muted">聊过 ' + friend.interactions + ' 次</span></div>' +
        '<label class="field">好感 <span>' + friend.intimacy + '</span><input type="range" min="-50" max="100" value="' + friend.intimacy + '" data-friend="' + esc(friend.id) + '" data-field="intimacy" /></label>' +
        '<label class="field">信任 <span>' + friend.trust + '</span><input type="range" min="0" max="100" value="' + friend.trust + '" data-friend="' + esc(friend.id) + '" data-field="trust" /></label>' +
        '<label class="field">敬畏 <span>' + friend.powerFear + '</span><input type="range" min="0" max="100" value="' + friend.powerFear + '" data-friend="' + esc(friend.id) + '" data-field="powerFear" /></label>' +
        '<input type="text" value="' + esc(friend.impression) + '" placeholder="她对这个人的印象" data-friend="' + esc(friend.id) + '" data-field="impression" />' +
        '<div class="row"><button class="btn primary" data-save="' + esc(friend.id) + '">保存这个人</button></div>' +
      '</div>').join('') || '<div class="muted">还没有好友。有人私聊过她就会出现在这里。</div>';
    el('friends').querySelectorAll('button[data-save]').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.save;
        const body = { id: id };
        el('friends').querySelectorAll('[data-friend="' + id + '"]').forEach((node) => {
          body[node.dataset.field] = node.dataset.field === 'impression' ? node.value : Number(node.value);
        });
        try {
          await post('/friends', body);
          toast('已保存');
          loadFriends();
        } catch (error) {
          toast('保存失败：' + error.message);
        }
      };
    });
  } catch (error) {
    toast('好友读取失败：' + error.message);
  }
}

async function loadStickers() {
  try {
    const data = await api('/stickers');
    const items = data.items || [];
    el('stickerStats').textContent = '共 ' + ((data.stats && data.stats.count) || 0) + ' 张';
    el('stickerGrid').innerHTML = items.slice().reverse().map((item) =>
      '<div class="sticker"><img src="/api/bibao/stickers/file?id=' + encodeURIComponent(item.id) + '&token=' + encodeURIComponent(token) + '" alt="" />' +
      '<div class="gist">' + esc(item.gist) + '</div>' +
      '<div class="row"><span class="chip">' + esc(item.mood || '日常') + '</span><span class="muted">用 ' + (item.uses || 0) + ' 次</span></div>' +
      '<div class="row"><button class="btn" data-edit="' + esc(item.id) + '">改描述</button><button class="btn" data-send="' + esc(item.id) + '">发一张</button><button class="btn" data-del="' + esc(item.id) + '">删掉</button></div></div>').join('') ||
      '<div class="muted">还没有收藏</div>';
    el('stickerGrid').querySelectorAll('[data-del]').forEach((button) => {
      button.onclick = async () => { await post('/stickers', { remove: button.dataset.del }); loadStickers(); };
    });
    el('stickerGrid').querySelectorAll('[data-edit]').forEach((button) => {
      button.onclick = async () => {
        const item = items.find((row) => row.id === button.dataset.edit);
        const gist = window.prompt('这张表情包在表达什么？', item?.gist || '');
        if (gist == null) return;
        try { await post('/stickers', { update: { id: button.dataset.edit, gist } }); toast('描述已更新'); loadStickers(); }
        catch (error) { toast('更新失败：' + error.message); }
      };
    });
    el('stickerGrid').querySelectorAll('[data-send]').forEach((button) => {
      button.onclick = async () => {
        try { await post('/stickers', { send: button.dataset.send }); toast('发出去了'); }
        catch (error) { toast('发送失败：' + error.message); }
      };
    });
  } catch (error) {
    toast('表情包读取失败：' + error.message);
  }
}

el('stickerImport').onclick = () => el('stickerFile').click();
el('stickerFile').onchange = async (event) => {
  const files = Array.from(event.target.files || []).slice(0, 10);
  event.target.value = '';
  for (const file of files) {
    try {
      const dataUrl = await shrink(file, 320);
      await post('/stickers/import', { dataUrl: dataUrl });
    } catch (error) {
      toast('导入失败：' + error.message);
    }
  }
  toast('导入完成');
  loadStickers();
};

function shrink(file, maxSide) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('不是图片'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

refresh();
setInterval(refresh, 6000);
</script>
</body>
</html>`
}
