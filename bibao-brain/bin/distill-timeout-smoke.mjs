#!/usr/bin/env node
/** 用缩短的时钟复现“外层时限较长，底层仍在90秒中止”；不调用真实模型。 */
import assert from 'node:assert/strict'
import { chatCompletion, createDirectLlm } from '../core/openai.js'
import { distillPersona, parseSources } from '../core/distill.js'
import { DISTILL_STAGE_TIMEOUT_MS, modelTimeout } from '../core/llm-control.js'
const actualFetch=globalThis.fetch,actualSetTimeout=globalThis.setTimeout,actualSetInterval=globalThis.setInterval
let passed=0
const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)}
const text='我今天终于把稿子交了，回家路上买了一杯热茶，才慢慢松了口气。'
const parsed=parseSources([{name:'chat.json',text:JSON.stringify([{senderId:'10000',senderName:'甲',content:text}])}])
const connection={provider:'direct',model:'slow-model',llm:createDirectLlm({baseURL:'https://model.invalid/v1',apiKey:'test-key',model:'slow-model'})}
const timerBudgets=[],requests=[],waitingCallbacks=[]
let delay=60,mode='reply',fetchCalls=0
const payload=(options)=>{
 if(options.system?.includes('人物素材分析器')){
  const user=options.user??'',marker='素材单元：\n',units=JSON.parse(user.slice(user.indexOf(marker)+marker.length)),u=units.find(u=>u.role==='TARGET')
  return {events:[],observations:[{unitId:u.unitId,quote:u.text.slice(0,18),observation:'平静而直接地表达自己的状态'}]}
 }
 if(options.system?.includes('人格分析师'))return {oneLine:'平静直接',coreWound:'',copingStyle:'先确认再回应',personality:{traits:['直接'],style:{verbosity:0.3}}}
 return {voice:{tone:'平静',speechRules:['先说明状态，再回应对方']}}
}
try{
 globalThis.setTimeout=(fn,ms,...args)=>{timerBudgets.push(ms);return actualSetTimeout(fn,ms===90000?20:ms,...args)}
 globalThis.setInterval=(fn,ms,...args)=>{if(ms===15000)waitingCallbacks.push(fn);return actualSetInterval(fn,ms,...args)}
 globalThis.fetch=async(url,options)=>{
  fetchCalls++;requests.push(options)
  if(mode==='upstream')throw new DOMException('This operation was aborted','AbortError')
  const body=JSON.parse(options.body),result=payload({system:body.messages[0].content,user:body.messages[1].content})
  return new Promise((resolve,reject)=>{
   const abort=()=>{clearTimeout(timer);reject(new DOMException('This operation was aborted','AbortError'))}
   const timer=actualSetTimeout(()=>{options.signal.removeEventListener('abort',abort);resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{headers:{'content-type':'application/json'}}))},delay)
   if(options.signal.aborted){clearTimeout(timer);reject(new DOMException('This operation was aborted','AbortError'));return}
   options.signal.addEventListener('abort',abort,{once:true})
  })
 }
 // 首先确认测试时钟能把历史90秒提前中止复现出来。
 await assert.rejects(()=>chatCompletion({baseURL:'https://model.invalid/v1',apiKey:'test-key',model:'x',system:'普通聊天',user:'u'}),e=>e.code==='LLM_TIMEOUT'&&e.timeoutMs===90000)
 check('历史90秒上限可复现，错误已明确标为本地超时',()=>assert.ok(timerBudgets.includes(90000)))
 timerBudgets.length=0
 const progress=[]
 const result=await distillPersona(parsed,{target:'10000'},connection,{timeoutMs:300,onProgress:p=>progress.push(p)})
 check('慢模型超过缩短的旧90秒限制，仍能跑完整个蒸馏流程',()=>{assert.equal(result.persona.voice.tone,'平静');assert.deepEqual(result.persona.personality.traits,['直接']);assert.ok(!timerBudgets.includes(90000));assert.equal(timerBudgets.filter(ms=>ms===300).length,6)})
 check('阶段时限只传给本地包装器，不作为模型API参数发送',()=>{assert.ok(requests.length>=4);assert.ok(requests.every(r=>!Object.hasOwn(JSON.parse(r.body),'timeoutMs')))})
 // 快速模型校验默认预算与心跳，不等十分钟。
 delay=0;timerBudgets.length=0
 const operation=distillPersona(parsed,{target:'10000'},connection,{onProgress:p=>progress.push(p)})
 waitingCallbacks.at(-1)?.()
 await operation
 check('蒸馏外层与直连内层默认统一10分钟',()=>{assert.equal(DISTILL_STAGE_TIMEOUT_MS,600000);assert.equal(timerBudgets.filter(ms=>ms===600000).length,6);assert.ok(!timerBudgets.includes(90000))})
 check('等待中会报告等待时间和本阶段上限',()=>assert.ok(progress.some(p=>p.message.includes('已等待')&&p.message.includes('600 秒'))))
 // 显式请求预算优先于直连配置预算。
 timerBudgets.length=0
 const explicit=createDirectLlm({baseURL:'https://model.invalid/v1',apiKey:'test-key',model:'x',timeoutMs:5})
 for await(const _ of explicit.stream({system:'普通聊天',messages:[],timeoutMs:120})){}
 check('直连包装器转发请求级时限，优先于配置默认',()=>{assert.ok(timerBudgets.includes(120));assert.ok(!timerBudgets.includes(5))})
 // 已取消的请求不能再发到模型。
 const already=new AbortController();already.abort()
 const before=fetchCalls
 await assert.rejects(()=>chatCompletion({baseURL:'https://model.invalid/v1',apiKey:'test-key',model:'x',signal:already.signal}),e=>e.code==='LLM_CANCELLED')
 check('进入调用前已暂停时不发送网络请求',()=>assert.equal(fetchCalls,before))
 // 取消监听器在调用结束后移除，长材料多阶段不会累积旧监听器。
 const owner=new AbortController();let added=0,removed=0
 const add=owner.signal.addEventListener.bind(owner.signal),remove=owner.signal.removeEventListener.bind(owner.signal)
 owner.signal.addEventListener=(...args)=>{added++;return add(...args)}
 owner.signal.removeEventListener=(...args)=>{removed++;return remove(...args)}
 await chatCompletion({baseURL:'https://model.invalid/v1',apiKey:'test-key',model:'x',timeoutMs:100,signal:owner.signal})
 check('成功后清理父级取消监听器',()=>{assert.equal(added,1);assert.equal(removed,1)})
 delay=100
 const manual=new AbortController(),manualCall=chatCompletion({baseURL:'https://model.invalid/v1',apiKey:'test-key',model:'x',timeoutMs:500,signal:manual.signal})
 actualSetTimeout(()=>manual.abort(),10)
 await assert.rejects(()=>manualCall,e=>e.code==='LLM_CANCELLED')
 check('用户主动取消不会被误报为模型超时',()=>assert.ok(manual.signal.aborted))
 const deadline=new AbortController(),deadlineCall=chatCompletion({baseURL:'https://model.invalid/v1',apiKey:'test-key',model:'x',timeoutMs:500,signal:deadline.signal})
 actualSetTimeout(()=>deadline.abort(modelTimeout(30,'蒸馏模型')),10)
 await assert.rejects(()=>deadlineCall,e=>e.code==='LLM_TIMEOUT'&&e.timeoutMs===30)
 passed++;console.log('PASS 父级阶段超时原因能传递到底层，不丢成通用AbortError')
 mode='upstream'
 await assert.rejects(()=>chatCompletion({baseURL:'https://model.invalid/v1',apiKey:'test-key',model:'x',timeoutMs:500}),e=>e.code==='LLM_UPSTREAM_ABORT'&&e.message.includes('上游'))
 passed++;console.log('PASS 非本地取消的AbortError明确标为上游中止')
 // 外层挂起时也有边界，但不自动重复十分钟等待。
 let calls=0
 const hanging={provider:'stub',model:'stub',llm:{async *stream(o){calls++;await new Promise(resolve=>o.signal.addEventListener('abort',resolve,{once:true}))}}}
 await assert.rejects(()=>distillPersona(parsed,{target:'10000'},hanging,{timeoutMs:15}),e=>e.code==='LLM_TIMEOUT'&&e.message.includes('时限'))
 check('本地阶段到期停止，不盲目自动重跑两次',()=>assert.equal(calls,1))
 calls=0
 const pause=new AbortController(),paused=distillPersona(parsed,{target:'10000'},hanging,{timeoutMs:500,signal:pause.signal})
 actualSetTimeout(()=>pause.abort(),10)
 await assert.rejects(()=>paused,e=>e.code==='LLM_CANCELLED')
 check('暂停会中止正在等待的阶段，且不自动重试',()=>assert.equal(calls,1))
 // DSH Service 不支持本地timeoutMs扩展；仍只发送其正式字段。
 let serviceOptions,attempts=0,secondSystem=''
 const service={provider:'stub',model:'stub',llm:{async *stream(o){serviceOptions=o;attempts++;if(attempts===2)secondSystem=o.system;yield{type:'finish',reason:{kind:'aborted'}}}}}
 await assert.rejects(()=>distillPersona(parsed,{target:'10000'},service,{timeoutMs:100}),e=>e.code==='LLM_UPSTREAM_ABORT')
 check('DSH调用不带本地扩展字段，上游中止不触发JSON修复提示',()=>{assert.equal(serviceOptions.timeoutMs,undefined);assert.equal(attempts,3);assert.ok(!secondSystem.includes('上一轮输出校验失败'))})
}finally{globalThis.fetch=actualFetch;globalThis.setTimeout=actualSetTimeout;globalThis.setInterval=actualSetInterval}
console.log('\n'+passed+'/'+passed+' 通过')
