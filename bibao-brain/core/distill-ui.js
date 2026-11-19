import { DISTILL_BUILD } from './distill-version.js'
/** 本机后台蒸馏工作台：创建、任务与结果分区，模型参数和任务状态相互独立。 */
export function renderDistillHtml(){
return String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>蒸馏人生工作台 · 比宝</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7fb;--card:#fff;--ink:#292631;--muted:#716c7e;--line:#e4e0ec;--brand:#6c5ce7;--soft:#f1eefc;--bad:#bd4141;--good:#27836a}
@media(prefers-color-scheme:dark){:root{--bg:#18171d;--card:#211f29;--ink:#efecf5;--muted:#b3acbf;--line:#3c3749;--brand:#b4a7ff;--soft:#2e2743;--bad:#ff9b9b;--good:#7bd1b5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1320px;margin:auto;padding:18px}h1,h2,h3,p{margin:0}h1{font-size:22px;letter-spacing:.02em}h2{font-size:15px}h3{font-size:13px}p+p{margin-top:6px}.muted{color:var(--muted);font-size:12px}.hero{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}.eyebrow{font-size:11px;letter-spacing:.12em;color:var(--brand);margin-bottom:3px}.build{font-size:11px;border:1px solid var(--line);padding:4px 9px;border-radius:20px;white-space:nowrap;color:var(--muted)}.tabs{display:flex;gap:4px;padding:4px;background:var(--card);border:1px solid var(--line);border-radius:12px;position:sticky;top:0;z-index:5;margin:12px 0 16px}.tabs button{flex:1;border:0;background:transparent;color:var(--muted);border-radius:8px}.tabs button.active{background:var(--soft);color:var(--brand);font-weight:600}.tabs small{font:inherit;opacity:.75}.layout{display:grid;grid-template-columns:minmax(260px,.85fr) minmax(340px,1.15fr);gap:16px;align-items:start}.task-layout{display:grid;grid-template-columns:minmax(240px,.7fr) minmax(320px,1.3fr);gap:16px;align-items:start}.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}.card+.card{margin-top:14px}.cardhead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.step{display:inline-grid;place-items:center;width:23px;height:23px;background:var(--soft);border-radius:7px;color:var(--brand);font-size:11px;margin-right:7px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.stack{display:grid;gap:12px}.filezone{display:block;padding:18px 14px;border:1px dashed var(--brand);border-radius:10px;background:var(--soft);text-align:center}.filezone strong{display:block;font-size:13px;margin-bottom:8px}.filezone input{font-size:12px;width:100%}label{display:block;font-size:12px;color:var(--muted)}label>input,label>select,label>textarea{margin-top:5px}input,textarea,select,button{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;max-width:100%}input:not([type=file]),textarea,select{width:100%;display:block}textarea{resize:vertical;min-height:95px;font-size:13px}select[size]{min-height:170px}option{padding:5px}button{cursor:pointer;font-size:12px}button.primary{background:var(--brand);color:var(--card);border-color:var(--brand);font-weight:600}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--brand);outline-offset:2px}.section{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}.notice{white-space:pre-wrap;overflow-wrap:anywhere}.banner{border-radius:9px;padding:10px 12px;margin:10px 0;font-size:12px}.banner:empty{display:none}.error{color:var(--bad);border:1px solid var(--bad)}.success{color:var(--good);border:1px solid var(--line)}.selected,.scope{padding:10px 12px;border-radius:9px;background:var(--soft);font-size:12px}.scope{border-left:3px solid var(--brand);line-height:1.9}.empty{padding:28px 14px;text-align:center;border:1px dashed var(--line);border-radius:10px;color:var(--muted);font-size:12px}.pill,.badge{font-size:11px;border:1px solid var(--line);border-radius:16px;padding:3px 8px;color:var(--muted)}.badge.active{background:var(--soft);color:var(--brand);border-color:var(--brand)}progress{width:100%;height:9px;accent-color:var(--brand)}details{font-size:12px}summary{cursor:pointer;color:var(--muted);padding:6px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.9 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;margin:8px 0}.scroll{max-height:340px;overflow:auto}.entry{padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}.entry:last-child{border:0}.entry p{white-space:pre-wrap}.task-list{display:grid;gap:8px;margin-top:12px;max-height:600px;overflow:auto}.task-row{width:100%;text-align:left;padding:12px;display:grid;gap:4px}.task-row.selected-task{border-color:var(--brand);background:var(--soft)}.task-row strong{font-size:13px}.task-row small{font-size:11px;color:var(--muted)}.task-actions{position:sticky;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:12px 0 0;margin-top:16px}.result-apply{margin-bottom:14px}.result-apply select{max-width:470px}.compact-report{max-height:400px;overflow:auto}.footer-note{padding:12px 2px;font-size:11px;color:var(--muted)}[hidden]{display:none!important}@media(max-width:820px){main{padding:12px}.layout,.task-layout,.review-grid{grid-template-columns:1fr}.hero{align-items:flex-start}.build{white-space:normal;max-width:150px}.tabs{top:0}.card{padding:13px}.task-list{max-height:260px}}
</style></head><body><main>
<header class="hero"><div><div class="eyebrow">BIBAO · DISTILLATION</div><h1>蒸馏人生工作台</h1><p class="muted">导入材料，提炼一个人的经历、性格与表达方式。</p></div><span id="hostBuild" class="build">连接后台中…</span></header>
<nav class="tabs" aria-label="蒸馏工作区"><button class="active" data-view="create">新建蒸馏</button><button data-view="tasks">后台任务 <small id="taskCount">0</small></button><button data-view="review" id="reviewTab" disabled>审核结果</button></nav>
<p id="error" class="banner error notice" role="alert"></p><p id="note" class="banner success notice" role="status" aria-live="polite"></p>
<section id="view-create" data-panel="create"><div class="layout">
<div><section class="card"><div class="cardhead"><h2><span class="step">1</span>导入材料</h2><span class="pill">先解析，后调用模型</span></div><div class="stack">
<div class="grid"><label>材料类型<select id="kind"><option value="auto">自动识别</option><option value="novel">小说 / 人物传记</option><option value="chat">QQ / 微信聊天记录</option></select></label><label>编码<select id="encoding"><option value="auto">自动识别</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="utf-16le">UTF-16 LE</option></select></label></div>
<label class="filezone"><strong>点击选择一份或多份文件</strong><input id="files" type="file" multiple accept=".txt,.md,.markdown,.epub,.html,.htm,.json,.jsonl,.csv"><span class="muted">TXT · MD · EPUB · HTML · JSON · JSONL · CSV</span></label><p id="sourceSummary" class="muted notice">单文件最高100MB，每批最多32份、200MB。</p>
<label>也可直接粘贴<textarea id="text" rows="5" placeholder="小说正文，或保留发送者信息的聊天文本"></textarea></label>
<div class="row"><button id="preview" class="primary">上传并解析</button><button id="clear">清空导入</button></div>
<div id="uploadCard" hidden><progress id="uploadProgress" max="1" value="0"></progress><p id="uploadNote" class="muted notice" role="status"></p><button id="stopUpload">停止上传</button></div>
<p id="sourceInfo" class="muted notice"></p><details><summary>格式与本地保存说明</summary><p class="muted">QQ / 微信数据库、备份、截图、PDF 请先导出文本。上传原文件解析后删除；启动后台任务后，解析材料、阶段结果和草稿会保存到本机任务目录，供关闭页面或重启后恢复。删除后台任务可清理其不再使用的缓存。模型密钥不会写入任务存档。</p></details>
</div></section></div>
<div><section class="card"><div class="cardhead"><h2><span class="step">2</span>模型与思考</h2><button id="refreshModel" disabled>刷新模型</button></div><p id="modelInfo" class="muted notice">正在读取模型配置…</p><div class="grid section"><label>思考强度<select id="reasoningEffort" disabled><option value="">跟随模型默认</option></select></label><label>阶段等待上限<select id="stageTimeout"><option value="300000">5分钟</option><option value="600000" selected>10分钟</option><option value="1200000">20分钟</option></select></label></div><p id="reasoningNote" class="muted notice" style="margin-top:8px">将实际传递所选参数，不会仅改变显示。</p>
<div class="grid section"><label>模型来源<select id="modelSource"><option value="current">按比宝设置（直连或继承）</option><option value="dsh">DSH 已保存的模型</option></select></label></div>
<div id="dshModelPicker" hidden><div class="grid"><label>模型来源（DSH 目录）<select id="dshProvider"></select></label><label>模型<select id="dshModel"></select></label></div><div class="row" style="margin-top:8px"><button id="saveDshModel" class="primary">保存并使用</button><span id="dshModelNote" class="muted notice"></span></div><p class="muted">保存后蒸馏经 DSH 的模型目录调用与计量，不需要在比宝里另存密钥。</p></div><details class="section"><summary>生成预算</summary><label>每阶段最大生成Token<select id="outputTokens"><option value="3000">3,000</option><option value="4000">4,000</option><option value="6000">6,000</option><option value="12000" selected>12,000</option><option value="24000">24,000</option></select></label><p class="muted">高思考强度可能需要更多时间和生成预算；上限须在所用模型支持范围内。模型地址和密钥在比宝设置中配置。</p></details></section>
<section class="card"><div class="cardhead"><h2><span class="step">3</span>人物与范围</h2></div><div id="previewEmpty" class="empty">先在左侧上传并解析材料，再选择人物。</div><div id="previewCard" hidden><div class="stack">
<div id="chatPicker" hidden><label>搜索昵称 / 账号 / 历史昵称<input id="personSearch" type="search" placeholder="输入关键字筛选"></label><label>选择发送者<select id="targetSelect" size="7" aria-label="选择要蒸馏的聊天发送者"></select></label><p id="peopleCount" class="muted"></p></div>
<div id="novelPicker" hidden><div class="grid"><label>角色名<input id="targetName" placeholder="正文实际出现的名字"></label><label>别名 / 称呼<input id="aliases" placeholder="逗号分隔多个称呼"></label></div><details><summary>从对白线索中选择候选</summary><select id="novelCandidates" size="5" aria-label="小说人物候选"></select><p class="muted">候选不一定完整，可手动填写人物名。</p></details></div>
<p id="selectedPerson" class="selected notice" aria-live="polite">请选择人物</p><details><summary>核对人物样本</summary><pre id="personSample"></pre></details>
<div class="grid"><label>新档案称呼<input id="name" maxlength="12" placeholder="默认沿用人物名"></label><label>当前年龄<input id="age" type="number" min="16" max="60" value="22"></label><label>性别设定<select id="gender"><option value="unknown">不指定</option><option value="female">女性</option><option value="male">男性</option></select></label></div>
<div class="grid"><label>分析方式<select id="analysisMode"><option value="sample">跨全文代表性深读</option><option value="full">目标相关全文分析</option></select></label><label>深读预算<select id="analysisChars"><option value="200000">约20万字符</option><option value="600000" selected>约60万字符</option><option value="1200000">约120万字符</option><option value="2000000">约200万字符</option></select></label></div>
<details><summary>每段输入大小</summary><select id="chunkChars"><option value="12000">约1.2万字符</option><option value="18000" selected>约1.8万字符</option><option value="30000">约3万字符 · 长上下文</option><option value="48000">约4.8万字符 · 长上下文</option></select><p class="muted">模型慢或上游频繁断开时，可减小每段输入。</p></details>
<p id="planInfo" class="scope notice" role="status">选好人物后显示实际分析范围。</p><p class="muted">点击开始后，所选范围会发往配置的模型。同名人物请核对账号；其他人的相邻消息仅作上下文。</p><div class="row"><button id="start" class="primary" disabled>开始后台蒸馏</button></div><p id="activeTaskHint" class="muted notice"></p>
</div></div></section></div></div></section>
<section id="view-tasks" data-panel="tasks" hidden><div class="task-layout"><section class="card"><div class="cardhead"><h2>后台任务</h2><button id="refreshTasks">刷新</button></div><p class="muted">可关闭蒸馏页，保持DSH运行即可继续。重启后任务保留为暂停状态，手动继续，不重复已完成阶段。</p><label class="section">筛选<select id="taskFilter"><option value="all">全部任务</option><option value="running">运行中</option><option value="done">已完成</option><option value="attention">暂停 / 失败</option></select></label><div id="taskList" class="task-list"></div><p id="taskWarnings" class="muted notice"></p></section>
<section class="card"><div id="taskEmpty" class="empty">选择一个任务查看进度。新建任务后会在这里持续运行。</div><div id="progressCard" hidden><div class="cardhead"><div><h2 id="taskTitle">任务详情</h2><p id="taskMeta" class="muted notice"></p></div><span id="taskStatus" class="pill"></span></div>
<div class="row" id="stages"><span class="badge" data-phase="extract">证据</span><span class="badge" data-phase="reduce">归纳</span><span class="badge" data-phase="personality">人格</span><span class="badge" data-phase="voice">表达回复</span><span class="badge" data-phase="compile">档案</span></div><div class="section"><progress id="progress" max="1" value="0"></progress><p id="progressNote" class="notice" role="status" aria-live="polite"></p></div><p id="taskError" class="banner error notice" role="alert"></p>
<div class="section"><label>继续任务时的思考强度<select id="taskReasoning"><option value="">跟随模型默认</option></select></label><p class="muted">仅对未完成阶段生效，已完成结果保留；继续时使用当前配置的蒸馏模型。</p></div><div class="row task-actions"><button id="cancel">暂停</button><button id="resume" class="primary" hidden>继续 / 重试</button><button id="taskResults" class="primary" hidden>审核结果</button><button id="taskRemove">删除任务</button></div>
<details class="section"><summary>连接与版本诊断</summary><pre id="diagnostic" class="scroll"></pre><button id="copyDiagnostics">复制诊断</button><p class="muted">仅含构建、模型、进度与错误分类，不含密钥和原始材料。</p></details></div></section></div></section>
<section id="view-review" data-panel="review" hidden><div id="draftCard" hidden><section class="card result-apply"><div class="cardhead"><div><h2 id="identity"></h2><p id="resultSummary" class="muted"></p></div><span class="pill">审核后才应用</span></div><div class="row"><select id="mode" aria-label="应用方式"><option value="adopt">应用经历、性格和表达，保留身份与旧聊天</option><option value="merge">只补充经历</option><option value="rebuild">用新档案重建大脑</option></select><button id="apply" class="primary">确认应用</button></div><p id="modeHint" class="muted">保留现有姓名、年龄、旧经历和聊天，更新表达倾向。</p><p id="warnings" class="muted notice"></p></section>
<div class="review-grid"><section class="card"><h2>人格分析</h2><pre id="personalityReport" class="compact-report"></pre><details><summary>观察事实与谨慎推断</summary><pre id="facts"></pre></details></section><section class="card"><h2>说话与回复分析</h2><pre id="voiceReport" class="compact-report"></pre></section></div>
<section class="card"><details><summary>查看性格、措辞、接话规则及风格示例</summary><div id="profile" class="scroll"></div></details><details class="section"><summary>人生经历与出处</summary><div id="events" class="scroll"></div></details><details class="section"><summary>证据摘录</summary><div id="evidence" class="scroll"></div></details></section></div></section>
<footer class="footer-note">后台任务只在本机保存。模型输出需要审核，示例不是新增事实。<span id="buildDetail"></span></footer>
</main><script>

(() => {
const $ = (id) => document.getElementById(id);
const storageKey = 'bibao-distill-active-v3';
const clientBuild='@@CLIENT_BUILD@@';
const api = async (path, body) => {
  const response = await fetch('/api/bibao'+path, body === undefined ? {} : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  let data; try {data=await response.json()} catch {throw new Error('服务器未返回 JSON，请检查连接')}
  if(!response.ok){const error=new Error(data.error||('HTTP '+response.status));error.status=response.status;throw error} return data;
};
let importId='',uploadId='',jobId='',draft=null,selectedTargetId='',selectedPerson=null,people=[],hasChat=false,busy=false,uploading=false,stopUpload=false,disposed=false,currentPlan=null;
let pollTimer=null,planTimer=null,searchTimer=null,planSerial=0,searchSerial=0;
let hostReady=false,tasks=[],tasksTimer=null,currentJob=null,modelConfig=null,jobsFetchId=0;
const storeJob=()=>{try{if(jobId)sessionStorage.setItem(storageKey,jobId);else sessionStorage.removeItem(storageKey)}catch{}};
const fail=(error)=>{$('error').textContent=error.message||String(error)};
const entry=(parent,title,text)=>{const div=document.createElement('div');div.className='entry';const strong=document.createElement('strong');strong.textContent=title;const p=document.createElement('p');p.textContent=text;div.append(strong,p);parent.append(div)};
function updateStart(){const running=tasks.find(j=>j.status==='running');$('start').disabled=busy||!hostReady||!modelConfig?.enabled||!currentPlan||Boolean(running);$('activeTaskHint').textContent=running?'后台正在运行：'+running.target+'。可继续导入配置，完成或暂停该任务后再启动下一项。':''}
function setBusy(value){busy=value;for(const id of ['preview','clear','files','text','kind','encoding','personSearch','targetSelect','targetName','aliases','novelCandidates','name','age','gender','analysisMode','analysisChars','chunkChars','reasoningEffort','outputTokens','stageTimeout','refreshModel','apply'])$(id).disabled=value;updateStart()}
function invalidateDraft(){}
function params(){return {importId,target:hasChat?selectedTargetId:$('targetName').value.trim(),aliases:$('aliases').value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean),mode:$('analysisMode').value,analysisChars:Number($('analysisChars').value),chunkChars:Number($('chunkChars').value),reasoningEffort:$('reasoningEffort').value,maxTokens:Number($('outputTokens').value),timeoutMs:Number($('stageTimeout').value),seed:{name:$('name').value.trim(),ageNow:Number($('age').value),gender:$('gender').value}}}
function schedulePlan(){invalidateDraft();currentPlan=null;$('start').disabled=true;const serial=++planSerial;clearTimeout(planTimer);if(!importId)return;const body=params();if(!body.target){$('planInfo').textContent='请先选择聊天发送者或填写小说角色名';return}
  $('planInfo').textContent='正在计算所选人物的分析范围…';planTimer=setTimeout(async()=>{try{const plan=await api('/biography/distill/plan',body);if(serial!==planSerial||disposed)return;currentPlan=plan;$('selectedPerson').textContent='已选：'+plan.target+(selectedPerson?.account?'（账号 '+selectedPerson.account+'）':'')+(hasChat?' · '+plan.selectedMessages+' 条目标消息':' · 别名：'+plan.aliases.join('、'));$('personSample').textContent=plan.sample.map(s=>(s.speaker?s.speaker+'：':'')+s.text).join('\n\n');$('planInfo').textContent='总材料 '+plan.totalChars.toLocaleString()+' 字符；目标相关 '+plan.relevantChars.toLocaleString()+' 字符\n本次'+(plan.sampled?'代表性深读':'全文分析')+' '+plan.analyzedChars.toLocaleString()+' 字符，分 '+plan.chunks+' 段，预计约 '+plan.estimatedCalls+' 次模型调用（归纳层数可能随有效证据数量变化）';updateStart()}catch(error){if(serial===planSerial){currentPlan=null;$('planInfo').textContent=error.message;$('start').disabled=true}}},400)
}
function showPeople(data){people=data.people||data.participants||[];const select=$('targetSelect');select.replaceChildren();for(const p of people){const option=document.createElement('option');option.value=p.id;option.textContent=p.name+(p.account?'（'+p.account+'）':'（无账号，'+p.sources.join(' / ')+'）')+' · '+p.count+' 条';select.append(option)}select.selectedIndex=-1;if(people.some(p=>p.id===selectedTargetId))select.value=selectedTargetId;$('peopleCount').textContent='匹配 '+(data.count??people.length)+' 人，显示前 '+people.length+' 人；识别总人数 '+(data.total??data.participantCount??people.length)+'。同名人物请核对账号。'}
$('personSearch').oninput=()=>{const serial=++searchSerial;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{try{const data=await api('/biography/distill/people',{importId,query:$('personSearch').value});if(serial===searchSerial)showPeople(data)}catch(error){fail(error)}},250)};
$('targetSelect').onchange=()=>{selectedTargetId=$('targetSelect').value;selectedPerson=people.find(p=>p.id===selectedTargetId)||null;$('selectedPerson').textContent=selectedPerson?'已选：'+selectedPerson.name+(selectedPerson.account?'（'+selectedPerson.account+'）':''):'请选择人物';$('personSample').textContent=selectedPerson?.samples.join('\n\n')||'';schedulePlan()};
$('novelCandidates').onchange=()=>{$('targetName').value=$('novelCandidates').value;schedulePlan()};
for(const id of ['targetName','aliases','name'])$(id).addEventListener('input',schedulePlan);
for(const id of ['age','gender','analysisMode','analysisChars','chunkChars'])$(id).addEventListener('change',schedulePlan);
function showPreview(data){++searchSerial;clearTimeout(searchTimer);importId=data.importId;$('targetName').value='';$('aliases').value='';selectedTargetId='';selectedPerson=null;currentPlan=null;$('personSearch').value='';hasChat=data.sources.some(s=>s.kind==='chat');$('chatPicker').hidden=!hasChat;$('novelPicker').hidden=hasChat;$('sourceInfo').textContent=data.sources.map(s=>s.name+'：'+s.chars.toLocaleString()+' 字符'+(s.kind==='chat'?'，'+s.messages.toLocaleString()+' 条消息':'，'+s.chapters+' 个章节标记')).join('\n');showPeople(data);$('novelCandidates').replaceChildren();for(const c of data.characters||[]){const o=document.createElement('option');o.value=c.name;o.textContent=c.name+' · '+c.count+' 处对白线索';$('novelCandidates').append(o)}$('novelCandidates').selectedIndex=-1;$('previewCard').hidden=false;$('previewEmpty').hidden=true;$('selectedPerson').textContent='请选择人物';if(hasChat&&data.participantCount===1){selectedTargetId=data.participants[0].id;selectedPerson=data.participants[0];$('targetSelect').value=selectedTargetId}schedulePlan()}
const base64=(blob)=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件分片读取失败'));reader.readAsDataURL(blob)});
$('preview').onclick=async()=>{
  if(busy)return;++planSerial;++searchSerial;clearTimeout(planTimer);clearTimeout(searchTimer);currentPlan=null;invalidateDraft();$('error').textContent='';$('note').textContent='';setBusy(true);uploading=true;stopUpload=false;$('uploadCard').hidden=false;$('stopUpload').hidden=false;
  try{
    const files=[...$('files').files];if($('text').value.trim())files.push(new File([$('text').value],'粘贴素材.txt',{type:'text/plain'}));
    if(!files.length)throw new Error('请选择文件或粘贴内容');const total=files.reduce((n,f)=>n+f.size,0);if(files.length>32||total>200*1024*1024||files.some(f=>f.size>100*1024*1024))throw new Error('单文件最高100MB，每批最多32份、200MB');
    if(importId){await api('/biography/distill/clear',{importId});importId=''}
    $('previewCard').hidden=true;$('draftCard').hidden=true;$('progressCard').hidden=true;
    const init=await api('/biography/distill/upload/init',{files:files.map(f=>({name:f.name,size:f.size,encoding:f.name==='粘贴素材.txt'?'utf-8':$('encoding').value})),encoding:$('encoding').value});uploadId=init.uploadId;
    let transferred=0;$('uploadProgress').max=total;$('uploadProgress').value=0;
    for(let i=0;i<files.length;i++)for(let offset=0;offset<files[i].size;){if(stopUpload)throw new Error('上传已停止');const blob=files[i].slice(offset,Math.min(files[i].size,offset+init.chunkBytes));const data=await base64(blob);let result;for(let retry=0;retry<3;retry++){try{result=await api('/biography/distill/upload/chunk',{uploadId,fileId:i,offset,data});break}catch(error){if(retry===2||stopUpload)throw error}}const received=result.received;if(received<=offset||received>files[i].size)throw new Error('服务器返回了异常上传位置');transferred+=received-offset;offset=received;$('uploadProgress').value=transferred;$('uploadNote').textContent='上传 '+files[i].name+' · '+Math.round(transferred/total*100)+'%（'+(transferred/1048576).toFixed(1)+' / '+(total/1048576).toFixed(1)+' MB）'}
    if(stopUpload)throw new Error('上传已停止');$('uploadNote').textContent='上传完成，正在解析正文、章节与发送者…';
    const data=await api('/biography/distill/upload/complete',{uploadId,kind:$('kind').value});uploadId='';showPreview(data);$('uploadNote').textContent='材料解析完成，请核对人物及分析范围';
  }catch(error){fail(error);if(uploadId){try{await api('/biography/distill/clear',{uploadId})}catch{}}}finally{uploadId='';uploading=false;$('stopUpload').hidden=true;setBusy(false)}
};
$('stopUpload').onclick=()=>{stopUpload=true;$('uploadNote').textContent='将在当前分片完成后停止并清理暂存文件…'};
$('clear').onclick=async()=>{if(busy)return;try{if(importId)await api('/biography/distill/clear',{importId});++planSerial;++searchSerial;clearTimeout(planTimer);clearTimeout(searchTimer);importId='';currentPlan=null;selectedTargetId='';selectedPerson=null;$('files').value='';$('text').value='';$('previewCard').hidden=true;$('previewEmpty').hidden=false;$('uploadCard').hidden=true;$('note').textContent='导入表单已清空，已创建的后台任务不受影响';$('error').textContent='';updateStart()}catch(error){fail(error)}};
function renderDraft(data){
  draft=data.persona;$('reviewTab').disabled=false;$('resultSummary').textContent=draft.events.length+' 条经历 · '+draft.relations.length+' 段关系 · 已保存为本机后台草稿';const p=draft.personality||{},v=draft.voice||{},a=draft.distillation.analysis||{};$('draftCard').hidden=false;$('identity').textContent=draft.name+' · '+draft.ageNow+' 岁｜'+draft.oneLine;$('profile').replaceChildren();
  entry($('profile'),'性格与价值取舍',[...(p.traits||[]),...(p.values||[]),...(p.boundaries||[])].join('；'));entry($('profile'),'说话方式',[v.tone,v.rhythm,...(v.quirks||[])].filter(Boolean).join('；'));
  if(v.speechRules?.length)entry($('profile'),'措辞与句式规则',v.speechRules.join('\n'));if(v.responseRules?.length)entry($('profile'),'接话规则',v.responseRules.join('\n'));
  for(const rule of v.replyPatterns||[])entry($('profile'),rule.situation,rule.approach+(rule.example?'｜示例：'+rule.example:''));for(const example of v.dialogueExamples||[])entry($('profile'),'对话风格示例 · '+example.situation,'对方：'+example.input+'\n回应：'+example.response);
  $('personalityReport').textContent=a.personalityReport||'该草稿未附独立人格报告';$('voiceReport').textContent=a.voiceReport||'该草稿未附独立表达报告';$('facts').textContent=[...(a.facts||[]).map(s=>'观察事实：'+s),...(a.inferences||[]).map(s=>'谨慎推断：'+s)].join('\n');$('warnings').textContent=(data.warnings||[]).map(w=>'· '+w).join('\n');$('events').replaceChildren();
  if(!draft.events.length)entry($('events'),'未提取确定的人生事件','本次只蒸馏性格和表达，不补编经历');for(const e of draft.events){const proofs=(e.evidenceIds||[]).map(id=>draft.distillation.evidence.find(p=>p.id===id)).filter(Boolean);entry($('events'),(e.ageEstimated?'时间不详（暂放当前年龄）':e.age+' 岁')+' · '+e.title,e.narrative+'\n'+proofs.map(p=>p.source+'｜“'+p.quote+'”').join('\n'))}
  $('evidence').replaceChildren();for(const e of draft.distillation.evidence)entry($('evidence'),e.source+' · '+e.dimension,e.observation+'｜“'+e.quote+'”');
}

function switchView(view){for(const panel of document.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==view;for(const button of document.querySelectorAll('[data-view]'))button.classList.toggle('active',button.dataset.view===view);if(view==='tasks')void loadJobs(false)}
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>switchView(button.dataset.view);
const statusName=(value)=>({running:'运行中',done:'已完成',error:'失败，可重试',cancelled:'已暂停'})[value]||value;
const effortName=(value)=>(modelConfig?.reasoning?.efforts??[]).find(row=>row.id===value)?.name||(value||'模型默认');
function fillEfforts(select,value){select.replaceChildren();const choices=modelConfig?.reasoning?.efforts??[{id:'',name:'跟随模型默认'}];for(const row of choices){const o=document.createElement('option');o.value=row.id;o.textContent=row.name;select.append(o)}if(!choices.some(row=>row.id===value)){const o=document.createElement('option');o.value=value;o.textContent=value+'（当前模型未声明支持）';o.disabled=true;select.append(o)}select.value=value||''}
function drawJobs(){
 $('taskCount').textContent=tasks.length;const filter=$('taskFilter').value,visible=tasks.filter(j=>filter==='all'||filter==='attention'&&['error','cancelled'].includes(j.status)||j.status===filter);$('taskList').replaceChildren();
 if(!visible.length){const p=document.createElement('p');p.className='empty';p.textContent=tasks.length?'没有符合筛选条件的任务':'还没有后台任务。先创建一项，随后可关闭页面等待。';$('taskList').append(p)}
 for(const job of visible){const button=document.createElement('button');button.className='task-row'+(job.jobId===jobId?' selected-task':'');const title=document.createElement('strong');title.textContent=job.target+' · '+statusName(job.status);const meta=document.createElement('small');meta.textContent=(job.model?.model||'模型未记录')+' · 思考：'+effortName(job.reasoningEffort);const progress=document.createElement('small');progress.textContent='已完成 '+job.completedStages+' 阶段 · '+new Date(job.createdAt).toLocaleString();button.append(title,meta,progress);button.onclick=()=>selectJob(job.jobId);$('taskList').append(button)}
 updateStart();
}
async function loadJobs(schedule=true){
 if(!hostReady||disposed)return;clearTimeout(tasksTimer);const requestId=++jobsFetchId;
 try{const data=await api('/biography/distill/jobs');if(requestId!==jobsFetchId||disposed)return;tasks=data.jobs||[];$('taskWarnings').textContent=(data.warnings||[]).join('\n');drawJobs();if(jobId&&!tasks.some(j=>j.jobId===jobId)){jobId='';currentJob=null;draft=null;storeJob();$('progressCard').hidden=true;$('taskEmpty').hidden=false;$('reviewTab').disabled=true}if(!jobId&&tasks[0])await selectJob(tasks[0].jobId);}
 catch(error){$('taskWarnings').textContent='后台连接暂时不可用，正在重连：'+error.message}
 if(requestId===jobsFetchId&&!disposed)tasksTimer=setTimeout(()=>loadJobs(true),2500);
}
async function selectJob(id){jobId=id;storeJob();currentJob=null;draft=null;$('draftCard').hidden=true;$('reviewTab').disabled=true;$('taskError').textContent='';drawJobs();await poll()}
async function poll(){
 if(disposed||!jobId)return;clearTimeout(pollTimer);const requested=jobId;
 try{const data=await api('/biography/distill/status?jobId='+encodeURIComponent(requested));if(disposed||requested!==jobId)return;currentJob=data;$('taskEmpty').hidden=true;$('progressCard').hidden=false;
 $('taskTitle').textContent=data.target||data.plan?.target||'蒸馏任务';$('taskStatus').textContent=statusName(data.status);$('taskMeta').textContent=(data.model?.model||'当前蒸馏模型')+' · 思考：'+effortName(data.reasoningEffort)+'\n'+(data.persistent?'阶段与材料已保存本机':'仅当前进程保存');
 const p=data.progress||{done:0,total:1,message:''};$('progress').max=Math.max(1,p.total);$('progress').value=p.done;$('progressNote').textContent=p.message+'\n已完成 '+data.completedStages+' 个模型阶段';for(const badge of document.querySelectorAll('[data-phase]'))badge.classList.toggle('active',badge.dataset.phase===p.phase);
 $('taskError').textContent=data.status==='error'?data.error||'本阶段未完成':'';fillEfforts($('taskReasoning'),data.reasoningEffort||'');$('taskReasoning').disabled=['running','done'].includes(data.status);
 $('cancel').hidden=data.status!=='running';$('resume').hidden=!data.canResume;$('taskResults').hidden=data.status!=='done';
 $('diagnostic').textContent=JSON.stringify({clientBuild,hostBuild:modelConfig?.build,sourceRoot:modelConfig?.sourceRoot,taskBuild:data.build,jobId:data.jobId,reasoningHistory:data.reasoningHistory,model:data.model,reasoningEffort:data.reasoningEffort,status:data.status,completedStages:data.completedStages,diagnostic:data.diagnostic},null,2);
 const local=tasks.find(j=>j.jobId===jobId);if(local)Object.assign(local,data);drawJobs();
 if(data.status==='done')renderDraft(data);
 if(data.status==='running')pollTimer=setTimeout(poll,1200);
 }catch(error){if(disposed||requested!==jobId)return;if(error.status===404){$('taskError').textContent='任务不存在，请从后台列表重新选择';jobId='';storeJob();void loadJobs(false);return}$('taskError').textContent='进度读取失败，正在重连：'+error.message;pollTimer=setTimeout(poll,3000)}
}
$('start').onclick=async()=>{if(!currentPlan||busy||!hostReady)return;if(!$('age').reportValidity())return;$('error').textContent='';setBusy(true);try{const data=await api('/biography/distill',params());jobId=data.jobId;storeJob();switchView('tasks');await loadJobs(false);await selectJob(data.jobId);$('note').textContent='后台任务已创建，可以关闭此页，保持 DSH 运行即可继续。'}catch(error){fail(error)}finally{setBusy(false)}};
$('cancel').onclick=async()=>{if(!jobId)return;try{await api('/biography/distill/cancel',{jobId});await poll();await loadJobs(false)}catch(error){$('taskError').textContent=error.message}};
$('resume').onclick=async()=>{if(!jobId)return;$('resume').disabled=true;try{await api('/biography/distill/resume',{jobId,reasoningEffort:$('taskReasoning').value});await poll();await loadJobs(false)}catch(error){$('taskError').textContent=error.message}finally{$('resume').disabled=false}};
$('taskRemove').onclick=async()=>{if(!jobId||!window.confirm('删除这个后台任务及其不再使用的材料缓存？已经应用的人物档案不会撤销。'))return;try{const removedImport=currentJob?.importId;await api('/biography/distill/remove',{jobId});if(importId===removedImport&&!tasks.some(job=>job.jobId!==jobId&&job.importId===removedImport)){importId='';currentPlan=null;$('previewCard').hidden=true;$('previewEmpty').hidden=false}jobId='';storeJob();currentJob=null;draft=null;$('draftCard').hidden=true;$('progressCard').hidden=true;$('reviewTab').disabled=true;await loadJobs(false)}catch(error){$('taskError').textContent=error.message}};
$('taskResults').onclick=()=>{if(currentJob?.persona){renderDraft(currentJob);switchView('review')}};
$('refreshTasks').onclick=()=>loadJobs(false);$('taskFilter').onchange=drawJobs;
$('copyDiagnostics').onclick=async()=>{try{await navigator.clipboard.writeText($('diagnostic').textContent);$('note').textContent='诊断已复制'}catch{$('note').textContent='无法自动复制，可在诊断区域中手动选择复制'}};
$('mode').onchange=()=>{$('modeHint').textContent=$('mode').value==='rebuild'?'重建会重置当前大脑的记忆与关系，先备份脑状态和人物档案。':$('mode').value==='merge'?'只补充有出处的新经历，当前性格和表达保持原样。':'保留现有姓名、年龄、旧经历和聊天，应用新的性格与表达倾向。'};
$('apply').onclick=async()=>{if(!draft||busy)return;const mode=$('mode').value;if(mode==='rebuild'&&!window.confirm('确定按这份档案重建大脑？当前记忆和关系会重置，重建前先备份。'))return;setBusy(true);try{const data=await api('/biography/apply',{distillJobId:jobId,mode});$('note').textContent='已应用：'+(data.result.mode==='rebuild'?'按新人设重建':data.result.mode==='adopt'?'性格与表达已更新，旧聊天保留':'已补充经历');$('note').textContent+='；后台草稿仍可查看';window.parent.postMessage({type:'bibao-biography-applied'},window.location.origin)}catch(error){fail(error)}finally{setBusy(false)}};
function sourceChanged(){if(busy)return;++planSerial;++searchSerial;clearTimeout(planTimer);clearTimeout(searchTimer);invalidateDraft();currentPlan=null;selectedTargetId='';selectedPerson=null;$('previewCard').hidden=true;$('start').disabled=true;$('note').textContent='素材已变更，请重新上传并解析，人物选择会按新材料重新计算'}
for(const id of ['files','kind','encoding'])$(id).addEventListener('change',sourceChanged);$('text').addEventListener('input',sourceChanged);
window.addEventListener('pagehide',()=>{disposed=true;stopUpload=true;clearTimeout(pollTimer);clearTimeout(tasksTimer);clearTimeout(planTimer);clearTimeout(searchTimer)});

$('files').addEventListener('change',()=>{$('sourceSummary').textContent=[...$('files').files].map(f=>f.name+' · '+(f.size/1048576).toFixed(1)+' MB').join('\n')||'单文件最高100MB，每批最多32份、200MB。'});
$('reasoningEffort').onchange=()=>{try{localStorage.setItem('bibao-distill-effort:'+modelConfig.provider+'/'+modelConfig.model,$('reasoningEffort').value)}catch{}};
async function initializeWorkspace(){
 try{
  const data=await api('/biography/distill/config');modelConfig=data;
  if(data.apiVersion<3||!data.build){$('hostBuild').textContent='后台仍是旧版';$('modelInfo').textContent='请完整退出并重启 DSH 后再打开蒸馏工作台，以加载新的 Host 模块。';$('error').textContent='运行中的后台未提供新版本接口，先重启 DSH，避免继续调用旧模块。';hostReady=false;updateStart();return}
  hostReady=true;$('hostBuild').textContent='后台 '+data.build;$('buildDetail').textContent=' · 页面 '+clientBuild+' / 后台 '+data.build;
  $('modelInfo').textContent=data.enabled?'当前模型：'+data.model+' · '+data.source:'尚未配置蒸馏模型，请在比宝设置中配置专用模型或让它继承语言区';
  let effort='';try{effort=localStorage.getItem('bibao-distill-effort:'+data.provider+'/'+data.model)||''}catch{}
  if(!(data.reasoning?.efforts??[]).some(row=>row.id===effort))effort='';fillEfforts($('reasoningEffort'),effort);$('reasoningEffort').disabled=!data.enabled;$('reasoningNote').textContent=data.reasoning?.note||'跟随模型默认';applyModelSource(data);
  try{jobId=sessionStorage.getItem(storageKey)||''}catch{}
  await loadJobs(true);updateStart();
 }catch(error){hostReady=false;updateStart();$('hostBuild').textContent='连接失败';fail(new Error(error.message+'；若刚更新源码，请完整退出并重新打开 DSH'))}
}
let dshProviders=null
function applyModelSource(config){
 const usingDsh=String(config.source||'').startsWith('dsh:')
 $('modelSource').value=usingDsh?'dsh':'current';$('dshModelPicker').hidden=!usingDsh
 if(usingDsh)void openDshPicker(config.source.slice(4),config.model||'')
 else $('dshModelNote').textContent=''
}
async function openDshPicker(provider='',model=''){
 $('dshModelPicker').hidden=false
 try{
  if(!dshProviders){const data=await api('/biography/distill/models');dshProviders=data.providers||[];$('dshModelNote').textContent=data.note||''}
  if(!dshProviders.length){$('dshModelNote').textContent='DSH 模型目录为空；请先在 DSH 设置里保存模型。';return}
  $('dshProvider').replaceChildren();for(const row of dshProviders){const option=document.createElement('option');option.value=row.provider;option.textContent=(row.displayName||row.provider)+(row.active?'':' · 未配置完成');$('dshProvider').append(option)}
  $('dshProvider').value=provider&&dshProviders.some(row=>row.provider===provider)?provider:dshProviders[0].provider
  await loadDshModels(model)
 }catch(error){$('dshModelNote').textContent='读取 DSH 模型目录失败：'+error.message}
}
async function loadDshModels(model=''){
 const provider=$('dshProvider').value;$('dshModel').replaceChildren();$('dshModelNote').textContent='正在读取模型列表…'
 try{const data=await api('/biography/distill/models?provider='+encodeURIComponent(provider));const models=data.models||[];if(!models.length){$('dshModelNote').textContent=data.note||'该来源没有返回模型列表';return}
  for(const row of models){const option=document.createElement('option');option.value=row.id;option.textContent=row.name&&row.name!==row.id?row.name+'（'+row.id+'）':row.id;$('dshModel').append(option)}
  const ids=models.map(row=>row.id);$('dshModel').value=ids.includes(model)?model:ids[0];$('dshModelNote').textContent=data.note||''}
 catch(error){$('dshModelNote').textContent='读取模型列表失败：'+error.message}
}
$('modelSource').onchange=()=>{const value=$('modelSource').value;if(value==='dsh')void openDshPicker(modelConfig&&String(modelConfig.source||'').startsWith('dsh:')?modelConfig.source.slice(4):'',modelConfig?.model||'');else{$('dshModelPicker').hidden=true;$('dshModelNote').textContent=''}}
$('dshProvider').onchange=()=>void loadDshModels()
$('saveDshModel').onclick=async()=>{
 const provider=$('dshProvider').value,model=$('dshModel').value
 if(!provider||!model){$('dshModelNote').textContent='请先选择模型来源和模型';return}
 $('saveDshModel').disabled=true
 try{
  await api('/settings',{llm:{profiles:{distill:{enabled:true,dsh:true,provider,model}}}});dshProviders=null
  const data=await api('/biography/distill/config');modelConfig=data;hostReady=Boolean(data.enabled)
  $('modelInfo').textContent=data.enabled?'当前模型：'+data.model+' · '+data.source:'尚未配置蒸馏模型，请在比宝设置中配置专用模型或让它继承语言区'
  fillEfforts($('reasoningEffort'),$('reasoningEffort').value);$('reasoningNote').textContent=data.reasoning?.note||'跟随模型默认'
  applyModelSource(data);updateStart();await loadJobs(false);$('dshModelNote').textContent='已保存，蒸馏将使用 DSH 的 '+model
 }catch(error){$('dshModelNote').textContent='保存失败：'+error.message}
 finally{$('saveDshModel').disabled=false}
}
$('refreshModel').onclick=async()=>{$('refreshModel').disabled=true;try{await initializeWorkspace()}finally{$('refreshModel').disabled=busy}};
void initializeWorkspace().finally(()=>{$('refreshModel').disabled=busy});
})();

</script></body></html>
`.replaceAll('@@CLIENT_BUILD@@',DISTILL_BUILD)
}
