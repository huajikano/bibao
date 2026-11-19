#!/usr/bin/env node
/** 离线回归：真实解析/蒸馏管线、可控假模型、Host 路由与持久化；不使用真实聊天或 API Key。 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { parseSources, prepareDistillation, distillPersona, DistillationJobs, DISTILL_LIMITS } from '../core/distill.js'
import { validatePersona } from '../core/persona.js'
import { buildSystemPrompt } from '../core/voice.js'
import { renderDistillHtml } from '../core/distill-ui.js'
import { BibaoBrain } from '../core/brain.js'
import { apply } from '../index.js'
let passed = 0
const check = (label, run) => { run(); passed++; console.log('PASS '+label) }
const said = '我昨天把拖了两天的稿子交了，回来的路上买了一杯热茶，才算松一口气。'
const txt = '2026-11-18 12:00:01 阿雨(100000001)\n'+said+'\n2026-11-18 12:00:03 阿林(100000002)\n我喜欢夸张地用叠词说话，那是我的习惯呀\n2026-11-18 12:00:05 阿雨(100000001)\n嗯，先歇一会儿再说吧。'
const sources = [{name:'qq.txt', text:txt}]
const parsed = parseSources(sources)
check('QQ 文本识别发送者及消息',()=>{assert.equal(parsed.sources[0].kind,'chat');assert.equal(parsed.participants.length,2);assert.equal(parsed.units[0].speakerId,'100000001');assert.equal(parsed.units.length,3)})
const plan=prepareDistillation(parsed,{target:'100000001'})
check('只把目标发送者标成 TARGET',()=>{assert.equal(plan.selectedMessages,2);assert.equal(plan.chunks[0].filter(u=>u.isTarget).length,2);assert.equal(plan.chunks[0].find(u=>u.speaker==='阿林').isTarget,false)})
const wx=parseSources([{name:'微信.txt',text:'[2026/11/18 12:00] 阿雨: 今天不太想讲话，让我静静就好\n[2026/11/18 12:01] 阿林: 好的，需要我的时候叫我'}])
check('微信日期+昵称格式',()=>assert.equal(wx.units[0].speaker,'阿雨'))
const csv=parseSources([{name:'聊天.csv',text:'发送者,内容\n阿雨,"今天有点累，\n先歇一会儿"\n阿林,"好呀,没关系"'}])
check('CSV 带引号、逗号、多行',()=>{assert.equal(csv.units.length,2);assert.match(csv.units[0].text,/\n/)})
const chatlab=parseSources([{name:'chat.json',text:JSON.stringify({members:[{id:'a',displayName:'阿雨'}],messages:[{senderId:'a',content:'今天总算忙完啦，歇口气'},{senderId:'a',content:'明天再继续努力吧'}]})}])
check('JSON members + senderId',()=>{assert.equal(chatlab.participants[0].name,'阿雨');assert.equal(prepareDistillation(chatlab,{target:'a'}).selectedMessages,2)})
const bot=parseSources([{name:'onebot.jsonl',text:[{sender:{nickname:'甲',user_id:11111},message:[{type:'text',data:{text:'我今天很高兴，写完一本书了'}}]},{sender:{nickname:'乙',user_id:22222},message:'太好啦'}].map(JSON.stringify).join('\n')}])
check('JSONL + OneBot 文本段',()=>assert.equal(bot.units[0].text,'我今天很高兴，写完一本书了'))
check('无目标、未知发送者、坏 JSON、数据库及超限明确报错',()=>{
 assert.throws(()=>prepareDistillation(parsed,{}),/人物|角色名/);assert.throws(()=>prepareDistillation(parsed,{target:'陌生人'}),/发送者/)
 assert.throws(()=>parseSources([{name:'x.json',text:'{oops'}]),/JSON/)
 assert.throws(()=>parseSources([{name:'chat.db',text:'binary'}]),/数据库/)
 assert.ok(DISTILL_LIMITS.bytes>=200*1024*1024);assert.ok(DISTILL_LIMITS.chars>=100000000)
})
const novelText='阿雨推开书店的门。她说：“今天先让我安静一会儿。”\n'.repeat(1300)
const novel=parseSources([{name:'小说.txt',text:novelText}],{kind:'novel'})
const novelPlan=prepareDistillation(novel,{target:'阿雨'})
check('长小说分段完整覆盖，不只读开头',()=>{assert.ok(novelPlan.chunks.length>1);assert.equal(novelPlan.chunks.flat().map(u=>u.text).join(''),novelText.trim());assert.ok(novelPlan.chunks.every(c=>c.reduce((n,u)=>n+u.text.length+180,0)<=DISTILL_LIMITS.chunk))})
const summary={oneLine:'安静坦率，关心人时给对方空间',coreWound:'',copingStyle:'先说明自己的需要，再约定稍后继续',personality:{traits:['坦率','克制'],values:['尊重空间'],boundaries:['不逼人立刻回复'],style:{warmth:0.6,playfulness:0.15,directness:0.8,verbosity:0.2,vulnerability:0.3,initiative:0.25,route:1}},voice:{tone:'平静直接',rhythm:'短句，少连发',quirks:['先说自己的状态'],replyPatterns:[{situation:'朋友很累',approach:'先接住，再给空间',example:'先歇会儿，晚点再聊'}],route:'SILENT_READ'}}
let mode='normal', seenSystems=[],seenEfforts=[]
const connection={provider:'stub',model:'stub',llm:{resolveModelInfo:async()=>({reasoning:{efforts:[{id:'high',name:'high'}]}}),async *stream(options){
 seenSystems.push(options.system);seenEfforts.push(options.reasoningEffort)
 if(mode==='hang'){await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));return}
 if(mode==='bad'){yield {type:'text-delta',text:'not json'};return}
 if(options.system.includes('人物素材分析器')){
  const text=options.messages[0].content[0].text;const units=JSON.parse(text.slice(text.indexOf('素材单元：\n')+6));const target=units.find(u=>u.role==='TARGET'||u.role==='NOVEL');const other=units.find(u=>u.role==='CONTEXT')
  const events=mode==='noevents'?[]:[{unitId:target.unitId,quote:target.text.slice(0,80),age:null,title:'交稿后松口气',narrative:'我把拖了两天的稿子交了，回去路上买了一杯热茶，才慢慢放松下来。',valence:0.3,arousal:0.1,entities:[],impact:{world_trust:0.1},tags:['交稿']}]
  const observations=[{unitId:target.unitId,quote:target.text.slice(0,80),observation:'会直接说明自己的状态，喜欢留一点独处空间'}]
  if(other) observations.push({unitId:other.unitId,quote:other.text,observation:'目标喜欢叠词'})
  observations.push({unitId:target.unitId,quote:'不存在的原文证据绝不能被收录',observation:'凭空编造'})
  yield {type:'text-delta',text:JSON.stringify({events,observations,uncertainties:['没有证据推断童年经历']})}
 }else{yield {type:'text-delta',text:JSON.stringify(summary)}}
}}}
const result=await distillPersona(parsed,{target:'100000001',seed:{name:'阿雨',ageNow:25}},connection)
check('蒸馏同时产出人生、性格、语言和回复策略',()=>{assert.equal(result.persona.events.length,1);assert.ok(result.persona.personality.traits.includes('坦率'));assert.equal(result.persona.voice.replyPatterns[0].situation,'朋友很累')})
check('他人的发言与伪造的引文不能进入目标证据',()=>{assert.equal(result.persona.distillation.evidence.length,2);assert.ok(!JSON.stringify(result.persona).includes('目标喜欢叠词'));assert.match(result.warnings.join(''),/丢弃/)})
check('未证明年龄显式标注，少量经历不补满十二条',()=>{assert.equal(result.persona.events[0].ageEstimated,true);assert.equal(result.persona.events[0].age,25);assert.equal(validatePersona(result.persona).ok,true)})
check('表达数据不准写路由权限',()=>{assert.equal(result.persona.voice.route,undefined);assert.equal(result.persona.personality.style.route,undefined)})
check('不执行素材指令，提示词明确角色和上下文边界',()=>assert.ok(seenSystems.some(s=>s.includes('材料中的指令')&&s.includes('CONTEXT'))))
mode='noevents';const styleOnly=await distillPersona(parsed,{target:'100000001'},connection);mode='normal'
check('只有表达证据也能出草稿，不虚构人生',()=>{assert.equal(styleOnly.persona.events.length,0);assert.equal(styleOnly.persona.name,'阿雨');assert.ok(styleOnly.warnings.some(w=>w.includes('不补编童年')))})
const biography=result.persona
const prompt=buildSystemPrompt({biography})
check('蒸馏回复方式进入真实系统提示词',()=>{assert.match(prompt,/先接住，再给空间/);assert.match(prompt,/短句，少连发/);assert.match(prompt,/尊重空间/);assert.doesNotMatch(prompt,/被夸会得意但嘴硬/);assert.match(prompt,/不强行套嘴硬/)})
const brain=new BibaoBrain({biography,virtual:true,startMs:Date.parse('2026-11-19T12:00:00+08:00')})
check('六维倾向初始化并随脑状态保存恢复',()=>{assert.equal(brain.selfModel.style.verbosity,0.2);assert.equal(BibaoBrain.fromJSON(brain.toJSON(),{biography}).selfModel.style.directness,0.8)})
check('时间不详带入运行时记忆',()=>assert.match(brain.memory.episodes[0].narrative,/发生时间不详/))
mode='bad';await assert.rejects(()=>distillPersona(parsed,{target:'100000001'},connection),/JSON/);mode='normal';passed++;console.log('PASS 模型错误不退回随机模板')
await assert.rejects(()=>distillPersona(parsed,{target:'100000001'},{}),/模型/);passed++;console.log('PASS 无模型明确报错')
mode='hang';await assert.rejects(()=>distillPersona(parsed,{target:'100000001'},connection,{timeoutMs:10}),/时限/);mode='normal';passed++;console.log('PASS 模型卡住受时限约束')
const jobs=new DistillationJobs(), uploaded=jobs.preview(sources)
mode='hang';const job=jobs.start(uploaded.importId,{target:'100000001'},connection)
check('并行重复任务受限',()=>assert.throws(()=>jobs.start(uploaded.importId,{target:'100000001'},connection),/正在运行/))
jobs.cancel(job.jobId);await jobs.jobs.get(job.jobId).task;mode='normal'
check('停止后不会生成可应用草稿',()=>{assert.equal(jobs.get(job.jobId).status,'cancelled');assert.equal(jobs.get(job.jobId).persona,undefined)})
jobs.imports.get(uploaded.importId).at=0
check('暂停的后台任务仍能引用材料，不受预览TTL影响',()=>assert.equal(jobs.plan(uploaded.importId,{target:'100000001'}).selectedMessages,2))
await jobs.remove(job.jobId)
check('清理后台任务后，其独占材料不再被误用',()=>assert.throws(()=>jobs.start(uploaded.importId,{target:'100000001'},connection),/过期/));await jobs.dispose()
const ui=renderDistillHtml()
check('真实页面内联脚本语法有效，含确认、取消和三种应用方式',()=>{new vm.Script(ui.match(/<script>([\s\S]*?)<\/script>/)[1]);assert.match(ui,/GB18030/);assert.match(ui,/confirm\(/);assert.match(ui,/只补充经历/);assert.match(ui,/textContent=title/)})

// Host 使用临时状态目录与假模型，走真实启动及清理；不安装插件。
const dir=await mkdtemp(path.join(os.tmpdir(),'bibao-distill-test-')),routes=[],cleanups=[]
const originalFetch=globalThis.fetch
try{
 globalThis.fetch=async()=>new Response('{"data":[]}',{headers:{'content-type':'application/json'}})
 const ctx={get(name){
   if(name==='llm')return {...connection.llm,listProviders:()=>[{id:'deepseek-official',name:'DeepSeek 官方'},{id:'spark-maas',name:'星火 MaaS'},{id:'zcode',name:'ZCode（智谱）'}],listModels:async(provider)=>provider==='zcode'?[{id:'GLM-5.3',name:'GLM-5.3'},{id:'GLM-5.3-Flash',name:'GLM-5.3-Flash'}]:[{id:'spark-x2.6',name:'星火 X2.6'},{id:'spark-x2.6-4b',name:'星火 X2.6 4B'}],listConfigurableProviders:()=>[{provider:'deepseek-official',displayName:'DeepSeek 官方',settingsNs:'llm.deepseek-official',settingsPath:[]},{provider:'spark-maas',displayName:'星火 MaaS',settingsNs:'llm.spark-maas',settingsPath:[]},{provider:'gateway-x',displayName:'自定义网关',settingsNs:'',settingsPath:[]}],discoverModels:async(settingsNs,request)=>[{id:'spark-x2.6',name:'星火 X2.6'},{id:'spark-x2.6-4b',name:'星火 X2.6 4B'}]}
   else if(name==='agentDefaultModel')return {currentSelection:()=>({provider:'stub',model:'stub'})}
   else if(name==='webServer')return {getOrigin:()=>''}
   return undefined},
  effect(factory,label){if(label?.endsWith('bio clock'))return()=>{};const dispose=factory();if(typeof dispose==='function')cleanups.push(dispose);return()=>{}},connection:{fetch:{register(route){routes.push(route);return()=>{}}}}}
 apply(ctx,{useLlm:true,stateFile:path.join(dir,'brain-state.json')})
 const call=async(method,url,body)=>{const route=routes.find(r=>r.path==='/api/bibao'+url.split('?')[0]&&r.methods.includes(method));assert.ok(route,'route exists '+url);const response=await route.fetch(new Request('http://localhost/api/bibao'+url,{method,...(method==='POST'?{body:JSON.stringify(body??{}),headers:{'content-type':'application/json'}}:{})}));return {status:response.status,data:response.headers.get('content-type')?.includes('json')?await response.json():await response.text()}}
 const before=await call('GET','/state')
 // 等待启动完成再运行/销毁，避免启动和关闭交错持有 SQLite 或端口。
 let booted=false
 for(let i=0;i<100;i++){try{await readFile(path.join(dir,'boot-report.json'),'utf8');booted=true;break}catch{await new Promise(resolve=>setTimeout(resolve,10))}}
 assert.ok(booted,'Host startup completed')
 const testBoot=JSON.parse(await readFile(path.join(dir,'boot-report.json'),'utf8'))
 const login=await originalFetch(testBoot.consoleUrl)
 const cookie=login.headers.get('set-cookie')?.split(';')[0]
 assert.ok(cookie,'owned test console session')
 const origin=new URL(testBoot.consoleUrl).origin
 const http=async(suffix,body)=>{const response=await originalFetch(origin+'/api/bibao'+suffix,{headers:{cookie,'content-type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return response}
 const realPage=await http('/biography/distill/ui')
 check('独立控制台通过真实 HTTP 返回 HTML 类型，而不是 JSON',()=>{assert.equal(realPage.status,200);assert.match(realPage.headers.get('content-type'),/text\/html/)})
 const standalone=await originalFetch(origin+'/?view=distill',{headers:{cookie}})
 const standaloneHtml=await standalone.text()
 check('独立工作台入口通过真实HTTP展示三分区布局',()=>{assert.equal(standalone.status,200);assert.match(standaloneHtml,/新建蒸馏/);assert.match(standaloneHtml,/后台任务/);assert.match(standaloneHtml,/审核结果/)})
 const material=Buffer.from('阿雨说：“先听你把话说完，我再回答。”\n'.repeat(50000))
 assert.ok(material.length>2*1024*1024)
 const initResponse=await http('/biography/distill/upload/init',{files:[{name:'跨请求大材料.txt',size:material.length}],encoding:'utf-8'})
 assert.equal(initResponse.status,201)
 const init=await initResponse.json()
 for(let offset=0;offset<material.length;offset+=init.chunkBytes){const part=material.subarray(offset,offset+init.chunkBytes);const response=await http('/biography/distill/upload/chunk',{uploadId:init.uploadId,fileId:0,offset,data:part.toString('base64')});assert.equal(response.status,200);const ack=await response.json();assert.equal(ack.received,offset+part.length)}
 const completed=await http('/biography/distill/upload/complete',{uploadId:init.uploadId,kind:'novel'})
 assert.equal(completed.status,200)
 const importedHttp=await completed.json()
 check('真实 HTTP 分片上传突破原 2MB 请求和文本限制',()=>{assert.equal(importedHttp.sources[0].kind,'novel');assert.ok(importedHttp.chars>500000)})
 const scope=await (await http('/biography/distill/plan',{importId:importedHttp.importId,target:'阿雨',mode:'sample',analysisChars:200000})).json()
 check('真实接口提供所选人物的受控分析范围',()=>{assert.ok(scope.analyzedChars<=200000);assert.equal(scope.sampled,true)})
 await http('/biography/distill/clear',{importId:importedHttp.importId})

 const upload=await call('POST','/biography/distill/preview',{sources})
 check('Host 本地预览不改变当前脑状态',()=>{assert.equal(upload.status,200);assert.equal(before.data.identity.name,'比宝')})
 const effortOffset=seenEfforts.length
 const start=await call('POST','/biography/distill',{importId:upload.data.importId,target:'100000001',reasoningEffort:'high',seed:{name:'阿雨',ageNow:25}})
 assert.equal(start.status,202)
 let state
 for(let i=0;i<100;i++){state=await call('GET','/biography/distill/status?jobId='+start.data.jobId);if(state.data.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,5))}
 check('Host 任务有进度并生成可审核草稿',()=>{assert.equal(state.data.status,'done',JSON.stringify(state.data));assert.equal(state.data.progress.done,state.data.progress.total)})
 const catalog=await call('GET','/biography/distill/jobs')
 check('Host后台目录可发现已完成任务及其真实思考设置',()=>{assert.ok(catalog.data.apiVersion>=3);assert.equal(catalog.data.jobs[0].jobId,start.data.jobId);assert.equal(catalog.data.jobs[0].persistent,true);assert.equal(catalog.data.jobs[0].reasoningEffort,'high');assert.ok(seenEfforts.slice(effortOffset).every(value=>value==='high'))})
 const merged=await call('POST','/biography/apply',{distillJobId:start.data.jobId,mode:'merge'})
 check('仅补经历能写入低唤醒事件，不改性格',()=>{assert.equal(merged.status,200);assert.equal(merged.data.result.added,1);assert.equal(merged.data.snapshot.self.style.verbosity,before.data.self.style.verbosity)})
 const adopted=await call('POST','/biography/apply',{distillJobId:start.data.jobId,mode:'adopt'})
 check('保留身份与旧记忆，实际应用六维表达',()=>{assert.equal(adopted.status,200);assert.equal(adopted.data.snapshot.identity.name,before.data.identity.name);assert.equal(adopted.data.snapshot.self.style.verbosity,0.2);assert.ok(adopted.data.snapshot.memory.stats.total>=before.data.memory.stats.total)})
 const saved=JSON.parse(await readFile(path.join(dir,'biography.json'),'utf8'))
 check('性格、回复策略、证据与旧人生同时落盘',()=>{assert.equal(saved.voice.replyPatterns[0].situation,'朋友很累');assert.ok(saved.distillation.evidence.length);assert.ok(saved.events.length>1)})
 const brainSave=JSON.parse(await readFile(path.join(dir,'brain-state.json'),'utf8'))
 const reloaded=BibaoBrain.fromJSON(brainSave,{biography:saved})
 check('保留旧聊天应用后，磁盘读档仍使用蒸馏表达',()=>{assert.equal(reloaded.selfModel.style.verbosity,0.2);assert.match(buildSystemPrompt({biography:reloaded.biography}),/先接住，再给空间/);assert.ok(reloaded.memory.episodes.length>=before.data.memory.stats.total)})
 const rebuilt=await call('POST','/biography/apply',{distillJobId:start.data.jobId,mode:'rebuild'})
 check('重建应用姓名年龄和表达档案',()=>{assert.equal(rebuilt.status,200);assert.equal(rebuilt.data.snapshot.identity.name,'阿雨');assert.equal(rebuilt.data.snapshot.identity.age,25);assert.equal(rebuilt.data.snapshot.self.style.verbosity,0.2)})
 const paths=await readdir(dir)
 check('重建前同时备份脑状态与档案',()=>{assert.ok(paths.some(n=>n.startsWith('brain-state.rev-')));assert.ok(paths.some(n=>n.startsWith('biography.rev-')))})
 const stale=await call('POST','/biography/apply',{distillJobId:'missing',mode:'rebuild'})
 check('不存在的蒸馏任务不能覆盖大脑',()=>assert.equal(stale.status,400))
 const models=await call('GET','/biography/distill/models')
 check('DSH模型目录合并已注册与可配置来源，未配置来源有标注',()=>{assert.equal(models.status,200);const ids=models.data.providers.map(row=>row.provider);assert.ok(ids.includes('deepseek-official'));assert.ok(ids.includes('spark-maas'));assert.ok(ids.includes('gateway-x'));const gate=models.data.providers.find(row=>row.provider==='gateway-x');assert.equal(gate.displayName,'自定义网关');assert.equal(gate.active,false);assert.equal(gate.settingsNs,'')})
 const catalog2=await call('GET','/biography/distill/models?provider=spark-maas')
 check('已注册模型列表来自适配器且带展示名',()=>{assert.equal(catalog2.status,200);assert.deepEqual(catalog2.data.models.map(row=>row.id),['spark-x2.6','spark-x2.6-4b']);assert.equal(catalog2.data.models[0].name,'星火 X2.6');assert.equal(catalog2.data.note,'')})
 const zcodeResponse=await http('/biography/distill/models?provider=zcode')
 const zcodeCatalog=await zcodeResponse.json()
 check('真实工作台HTTP路由可显示无设置命名空间的ZCode模型',()=>{assert.equal(zcodeResponse.status,200);assert.deepEqual(zcodeCatalog.models.map(row=>row.id),['GLM-5.3','GLM-5.3-Flash']);assert.equal(zcodeCatalog.note,'');assert.equal(zcodeCatalog.providers.find(row=>row.provider==='zcode').settingsNs,'')})
 const missing2=await call('GET','/biography/distill/models?provider=nope')
 check('未知来源明确提示',()=>{assert.equal(missing2.data.models.length,0);assert.match(missing2.data.note,/没有这个模型来源/)})
 const html=await call('GET','/biography/distill/ui')
 check('两个入口共用真实 HTML 路由',()=>{assert.equal(html.status,200);assert.match(html.data,/蒸馏人生/);assert.match(html.data,/\/biography\/distill\/upload\/complete/)})
 const bio=await call('GET','/biography')
 check('人物编辑接口能读回完整蒸馏档案',()=>{assert.ok(bio.data.voice);assert.ok(bio.data.distillation)})
 const onlyProfile=await call('POST','/biography/apply',{persona:styleOnly.persona,mode:'rebuild'})
 const resaved=await call('POST','/biography',{events:[],oneLine:'安静但愿意听人说话'})
 check('没有人生事件的纯表达档案也能重建和再次编辑',()=>{assert.equal(onlyProfile.status,200);assert.equal(resaved.status,200);assert.equal(resaved.data.biography.events.length,0);assert.ok(resaved.data.biography.voice)})
 await call('POST','/settings',{llm:{profiles:{broca:{enabled:true,baseURL:'https://model.invalid/v1',apiKey:'test-key',model:'broca-long'},distill:{enabled:true,baseURL:'',model:''}}}})
 const inherited=await call('GET','/biography/distill/config')
 check('蒸馏空配置继承语言区独立模型，接口不回显密钥',()=>{assert.equal(inherited.data.model,'broca-long');assert.equal(inherited.data.apiKey,undefined)})
 await call('POST','/settings',{llm:{profiles:{distill:{enabled:true,baseURL:'https://distill.invalid/v1',apiKey:'test-key-distill',model:'distill-own'}}}})
 const dedicated=await call('GET','/biography/distill/config')
 check('蒸馏专用模型可独立于聊天模型配置',()=>assert.equal(dedicated.data.model,'distill-own'))
 await call('POST','/settings',{useLlm:false,llm:{profiles:{distill:{enabled:false},broca:{enabled:false}}}})
 const noModel=await call('GET','/biography/distill/config'),retained=await call('GET','/biography/distill/jobs')
 check('没有可用模型时，已完成的后台任务仍可查找和审核',()=>{assert.equal(noModel.data.enabled,false);assert.equal(retained.status,200);assert.ok(retained.data.jobs.some(job=>job.jobId===start.data.jobId&&job.status==='done'))})

}finally{
 globalThis.fetch=originalFetch
 for(const dispose of cleanups.reverse())await dispose()
 // 取消属于临时测试插件的异步任务及定时保存；不访问当前 profile。
 await new Promise(resolve=>setTimeout(resolve,1400))
 await rm(dir,{recursive:true,force:true})
}
console.log(`\n${passed}/${passed} 通过`)
