#!/usr/bin/env node
/** 后台任务、进程恢复、真实思考参数与流式网关兼容回归；所有材料和模型均为测试夹具。 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DistillationJobs, parseSources } from '../core/distill.js'
import { DistillStateStore } from '../core/distill-state.js'
import { createDirectLlm } from '../core/openai.js'
import { normalizeModelAbort } from '../core/llm-control.js'
import { reasoningCapabilities, validateReasoningEffort } from '../core/distill-reasoning.js'
import { parseDirectReply } from '../core/distill-direct-response.js'
import { DISTILL_BUILD, DISTILL_API_VERSION } from '../core/distill-version.js'
import { renderDistillHtml } from '../core/distill-ui.js'
import { directGenerationOptions } from '../core/distill-direct-options.js'
let passed=0
const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)}
const text='我今天终于把稿子交了，回家路上买了一杯热茶，才慢慢松了口气。'
const sources=[{name:'chat.json',text:JSON.stringify([{senderId:'10000',senderName:'阿雨',content:text}])}]
const persona={oneLine:'平静直接',coreWound:'',copingStyle:'先确认再回应',personality:{traits:['直接'],values:['尊重空间'],style:{verbosity:0.3}},report:'有证据支持的谨慎分析。'}
const voice={voice:{tone:'平静',speechRules:['先确认再回应'],responseRules:['先承接情绪再给建议']},report:'按眼前情境接话。'}
const counts={extract:0,personality:0,voice:0},efforts=[]
let blockVoice=true
const conn={provider:'stub',model:'fixture-model',source:'dsh',apiKey:'never-save-connection-secret',llm:{async *stream(o){
 const phase=o.system.includes('人物素材分析器')?'extract':o.system.includes('人格分析师')?'personality':'voice'
 counts[phase]++;efforts.push({phase,effort:o.reasoningEffort})
 if(phase==='voice'&&blockVoice){await new Promise(resolve=>o.signal.addEventListener('abort',resolve,{once:true}));return}
 let value=phase==='personality'?persona:voice
 if(phase==='extract'){const user=o.messages[0].content[0].text,mark='素材单元：\n',units=JSON.parse(user.slice(user.indexOf(mark)+mark.length)),u=units.find(u=>u.role==='TARGET');value={events:[],observations:[{unitId:u.unitId,quote:u.text.slice(0,18),observation:'先直接说明自己的感受，再回应对方'}]}}
 yield{type:'text-delta',text:JSON.stringify(value)}
}}}
const waitFor=async(predicate)=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error('等待测试阶段超时')}
const dir=await mkdtemp(path.join(os.tmpdir(),'bibao-background-'))
let first,second,third,crashRestored,storageRetry
try{
 first=new DistillationJobs({dir});await first.ready()
 const imported=first.preview(sources),started=first.start(imported.importId,{target:'10000',reasoningEffort:'high'},conn)
 await first.waitAccepted(started.jobId)
 await waitFor(()=>counts.voice===1)
 check('202可接受前已保存后台材料，模型独立于页面调用继续推进',()=>{assert.equal(first.get(started.jobId).completedStages,2);assert.equal(first.list().jobs[0].status,'running');assert.ok(efforts.every(row=>row.effort==='high'))})
 const jobFolder=path.join(dir,'jobs',started.jobId)
 check('任务与两个已完成阶段真实落盘',()=>assert.ok(first.jobs.get(started.jobId).savedStages.size===2))
 assert.equal((await readdir(path.join(jobFolder,'stages'))).length,2)
 const savedText=await readFile(path.join(jobFolder,'state.json'),'utf8')
 check('本地任务存档保留思考强度，不保存连接或密钥',()=>{assert.equal(JSON.parse(savedText).options.reasoningEffort,'high');assert.ok(!savedText.includes('never-save-connection-secret'));assert.ok(!savedText.includes('"llm"'))})
 await first.dispose();first=null
 second=new DistillationJobs({dir});await second.ready()
 const restored=second.get(started.jobId)
 check('关闭旧Host后，新Host能列出并恢复暂停任务',()=>{assert.equal(restored.status,'cancelled');assert.equal(restored.completedStages,2);assert.equal(restored.canResume,true);assert.equal(second.list().jobs.length,1)})
 const before={...counts};blockVoice=false
 await second.resume(started.jobId,conn,{reasoningEffort:'low'});await second.jobs.get(started.jobId).task
 const finished=second.get(started.jobId)
 check('恢复只调用未完成的表达阶段，不重复提取和人格',()=>{assert.equal(finished.status,'done');assert.equal(counts.extract,before.extract);assert.equal(counts.personality,before.personality);assert.equal(counts.voice,before.voice+1)})
 check('恢复时的新思考强度只作用于未完成阶段，并保留变更记录',()=>{assert.equal(efforts.at(-1).effort,'low');assert.equal(finished.reasoningEffort,'low');assert.equal(finished.persona.distillation.analysis.reasoningEffort,'low');assert.deepEqual(finished.reasoningHistory.map(row=>row.effort),['high','low'])})
 await second.dispose();second=null
 third=new DistillationJobs({dir});await third.ready()
 check('完成结果跨进程重建后仍能审核，无须再次调用模型',()=>{const result=third.get(started.jobId);assert.equal(result.status,'done');assert.equal(result.persona.voice.tone,'平静');assert.equal(result.completedStages,3);assert.equal(result.build,DISTILL_BUILD)})
 await third.remove(started.jobId)
 check('删除任务同步清理独占材料和阶段索引',()=>{assert.equal(third.list().jobs.length,0);assert.equal(third.imports.size,0)})
 assert.deepEqual(await readdir(path.join(dir,'jobs')),[]);assert.deepEqual(await readdir(path.join(dir,'imports')),[])
 await third.dispose();third=null
 // 模拟硬退出时遗留running状态，不启动真实模型请求。
 const store=new DistillStateStore(dir);await store.init();const importId=randomUUID(),jobId=randomUUID(),parsed=parseSources(sources)
 await store.saveImport(importId,{at:Date.now(),parsed})
 await store.saveStage(jobId,'extract:0',{events:[],observations:[]})
 await store.saveJob({id:jobId,importId,at:Date.now(),createdAt:Date.now(),status:'running',options:{target:'10000',reasoningEffort:''},progress:{phase:'extract',done:1,total:3,message:'旧进程处理中'},model:{model:'fixture-model'},build:DISTILL_BUILD})
 const callCount=counts.extract+counts.personality+counts.voice
 crashRestored=new DistillationJobs({dir});await crashRestored.ready()
 check('硬退出遗留任务恢复为暂停，绝不自动消耗模型额度',()=>{const job=crashRestored.get(jobId);assert.equal(job.status,'cancelled');assert.equal(job.completedStages,1);assert.match(job.error,/上次 DSH 进程/);assert.equal(counts.extract+counts.personality+counts.voice,callCount)})
 crashRestored.imports.get(importId).at=0;crashRestored.sweep()
 check('后台引用的材料不随普通预览TTL丢失',()=>assert.ok(crashRestored.imports.has(importId)))
 await crashRestored.clear();await crashRestored.dispose();crashRestored=null
 // 磁盘写入失败时不能重复付费调用已成功的模型阶段。
 storageRetry=new DistillationJobs({dir});await storageRetry.ready();const sample=storageRetry.preview(sources)
 const originalSave=storageRetry.store.saveStage.bind(storageRetry.store);let shouldFail=true
 storageRetry.store.saveStage=async(...args)=>{if(shouldFail){shouldFail=false;throw new Error('fixture ENOSPC')}return originalSave(...args)}
 const countBefore=counts.extract,job=storageRetry.start(sample.importId,{target:'10000'},conn)
 await storageRetry.jobs.get(job.jobId).task
 check('阶段落盘失败会停止并保留内存结果，不反复请求模型',()=>{assert.equal(storageRetry.get(job.jobId).status,'error');assert.equal(counts.extract,countBefore+1)})
 await storageRetry.resume(job.jobId,conn);await storageRetry.jobs.get(job.jobId).task
 check('恢复存档失败的任务时，先补存结果而不重复提取',()=>{assert.equal(storageRetry.get(job.jobId).status,'done');assert.equal(counts.extract,countBefore+1)})
}finally{for(const jobs of [first,second,third,crashRestored,storageRetry])if(jobs)await jobs.dispose();await rm(dir,{recursive:true,force:true})}

const requestContext=new AsyncLocalStorage(),isolated=new DistillationJobs(),observed=[]
try{
 const item=isolated.preview(sources),parent=new AbortController()
 const detachedConnection={...conn,llm:{async *stream(options){observed.push(requestContext.getStore());assert.equal(requestContext.getStore(),undefined);yield* conn.llm.stream(options)}}}
 const task=requestContext.run({requestSignal:parent.signal},()=>isolated.start(item.importId,{target:'10000'},detachedConnection))
 parent.abort()
 await isolated.jobs.get(task.jobId).task
 check('HTTP请求上下文结束与取消不会传入后台模型执行',()=>{assert.equal(isolated.get(task.jobId).status,'done');assert.equal(observed.length,3);assert.ok(observed.every(value=>value===undefined))})
}finally{await isolated.dispose()}
const direct={provider:'direct',model:'fixture',llm:{direct:true}}
const caps=await reasoningCapabilities(direct)
check('直连UI列出可明确传递的思考选项',()=>assert.deepEqual(caps.efforts.map(row=>row.id),['','none','low','medium','high']))
const spark=createDirectLlm({baseURL:'https://maas-api.cn-huabei-1.xf-yun.com/v2',model:'spark-x2.6',apiKey:'fixture-key'})
const sparkCaps=await reasoningCapabilities({llm:spark})
check('星火原生Chat显示实际支持的思考模式，不伪造低中高',()=>assert.deepEqual(sparkCaps.efforts.map(row=>row.id),['','none','auto','enabled']))
check('关闭星火思考使用thinking.type和正确输出预算字段',()=>{const value=directGenerationOptions({baseURL:'https://maas-api.cn-huabei-1.xf-yun.com/v2',model:'spark-x2.6',reasoningEffort:'none',maxTokens:256});assert.equal(value.thinking.type,'disabled');assert.equal(value.max_completion_tokens,256);assert.equal(value.max_tokens,undefined);assert.equal(value.temperature,undefined)})
await assert.rejects(()=>validateReasoningEffort('high',{llm:spark}),/未声明支持/);passed++;console.log('PASS 不向星火原生Chat静默发送无效高强度参数')
check('普通聊天未选新思考设置时保留原有参数',()=>{const value=directGenerationOptions({baseURL:'https://maas-api.cn-huabei-1.xf-yun.com/v2',model:'spark-x2.6',maxTokens:500,temperature:0.9});assert.equal(value.max_tokens,500);assert.equal(value.temperature,0.9);assert.equal(value.thinking,undefined)})
const service={resolveModelInfo:async()=>({reasoning:{efforts:[{id:'low',name:'low'},{id:'high',name:'high'}],defaultEffort:'low'}})}
const serviceConnection={provider:'p',model:'m',llm:{stream(){}}}
const supported=await reasoningCapabilities(serviceConnection,service)
check('DSH强度列表来自当前模型能力，不凭空承诺支持',()=>assert.deepEqual(supported.efforts.map(row=>row.id),['','low','high']))
await assert.rejects(()=>validateReasoningEffort('medium',serviceConnection,service),/未声明支持/);passed++;console.log('PASS 不支持的思考强度在调用模型前明确拒绝')
check('带前后缀或cause的英文Abort也会被分类',()=>{assert.equal(normalizeModelAbort(new Error('provider failed: This operation was aborted.')).code,'LLM_UPSTREAM_ABORT');const e=new Error('fetch failed');e.cause={code:'UND_ERR_ABORTED'};assert.equal(normalizeModelAbort(e).code,'LLM_UPSTREAM_ABORT')})
const answer='{"observations":[]}',sse=': heartbeat\n\ndata: '+JSON.stringify({choices:[{delta:{reasoning_content:'private thinking example'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:answer.slice(0,8)}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:answer.slice(8)},finish_reason:'stop'}],usage:{completion_tokens:9}})+'\n\ndata: [DONE]\n\n'
check('流式正文可重组，思考内容不混入最终JSON',()=>{const reply=parseDirectReply(sse,{strictFinal:true});assert.equal(reply.reply,answer);assert.equal(reply.data.usage.completion_tokens,9);assert.ok(!reply.reply.includes('private thinking'))})
check('忽略stream的JSON网关仍然兼容',()=>assert.equal(parseDirectReply(JSON.stringify({choices:[{message:{content:answer}}]}),{strictFinal:true}).reply,answer))
check('流式响应提前关闭和仅思考输出不会被当作成功',()=>{assert.throws(()=>parseDirectReply('data: '+JSON.stringify({choices:[{delta:{content:'{partial'}}]})+'\n\n',{strictFinal:true}),/提前结束/);assert.throws(()=>parseDirectReply('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'example'}}]})+'\n\ndata: [DONE]\n\n',{strictFinal:true}),/没有最终/)} )
const originalFetch=globalThis.fetch,seen=[]
try{
 globalThis.fetch=async(url,options)=>{seen.push(JSON.parse(options.body));return new Response(sse,{headers:{'content-type':'text/event-stream'}})}
 const llm=createDirectLlm({baseURL:'https://fixture.invalid/v1',apiKey:'fixture-secret',model:'fixture'})
 let combined='';for await(const chunk of llm.stream({system:'s',messages:[],reasoningEffort:'high',streaming:true,timeoutMs:500}))if(chunk.type==='text-delta')combined+=chunk.text
 check('选择的高思考强度真实进入HTTP请求，并启用流式传输',()=>{assert.equal(seen[0].reasoning_effort,'high');assert.equal(seen[0].stream,true);assert.equal(seen[0].temperature,undefined);assert.equal(combined,answer)})
 globalThis.fetch=async(url,options)=>{seen.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:answer}}]}),{headers:{'content-type':'application/json'}})}
 for await(const _ of llm.stream({system:'s',messages:[],streaming:true})){}
 check('模型默认不擅自发送reasoning_effort',()=>assert.equal(seen.at(-1).reasoning_effort,undefined))
 const nativeClient=createDirectLlm({baseURL:'https://maas-api.cn-huabei-1.xf-yun.com/v2',model:'spark-x2.6',apiKey:'fixture-key'})
 for await(const _ of nativeClient.stream({system:'s',messages:[],reasoningEffort:'none',streaming:true,maxTokens:256})){}
 check('星火原生关闭思考参数确实进入HTTP请求',()=>{assert.equal(seen.at(-1).thinking.type,'disabled');assert.equal(seen.at(-1).max_completion_tokens,256);assert.equal(seen.at(-1).reasoning_effort,undefined)})
 globalThis.fetch=async()=>new Response('{"error":"unsupported parameter reasoning_effort"}',{status:400})
 await assert.rejects(async()=>{for await(const _ of llm.stream({system:'s',messages:[],reasoningEffort:'high'})){}},e=>e.code==='LLM_REASONING_UNSUPPORTED')
 passed++;console.log('PASS 端点不接受思考强度时明确报错，不静默忽略设置')
}finally{globalThis.fetch=originalFetch}
const html=renderDistillHtml(),inline=html.match(/<script>([\s\S]*?)<\/script>/)[1]
check('三分区工作台脚本可解析，所有静态控件引用都存在',()=>{new vm.Script(inline);const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));for(const match of inline.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(match[1]),'missing id '+match[1]);assert.match(html,/新建蒸馏/);assert.match(html,/后台任务/);assert.match(html,/审核结果/);assert.match(html,/id="reasoningEffort"/)})
check('任务可从服务端列表找回，不仅依赖浏览器临时ID',()=>{assert.match(inline,/distill\/jobs/);assert.match(inline,/data\.jobs/);assert.match(inline,/apiVersion/);assert.ok(DISTILL_API_VERSION>=3);assert.match(html,new RegExp(DISTILL_BUILD.replace(/\./g,'\\.')));assert.doesNotMatch(inline,/keepalive:true/)})
console.log('\n'+passed+'/'+passed+' 通过')
