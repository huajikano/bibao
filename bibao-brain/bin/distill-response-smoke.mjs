#!/usr/bin/env node
/** 复现真实模型常见返回差异；兼容格式不能绕过目标人物和原文出处校验。 */
import assert from 'node:assert/strict'
import { parseDistillResponse, safeDistillError } from '../core/distill-response.js'
import { parseSources, distillPersona, DistillationJobs } from '../core/distill.js'
let passed=0
const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)}
const text='我今天终于把稿子交了，回家路上买了一杯热茶，才慢慢松了口气。'
const units=[{id:'s1m1_1',text,isTarget:true},{id:'s1m2_1',text:'我就喜欢大大的抱抱呀，这样说话最开心了',isTarget:false}]
const row={unitId:'s1m1_1',quote:text.slice(0,18),observation:'直接表达感受，先说明自己的状态',dimension:'personality',confidence:0.8}
const event={unitId:row.unitId,quote:row.quote,title:'交稿后松口气',narrative:text,age:null,valence:0.2,arousal:0.4}
const parse=(value,extra={})=>parseDistillResponse(typeof value==='string'?value:JSON.stringify(value),{phase:'extract',units,...extra})
for(const [name,value]of [
 ['标准双数组',{events:[],observations:[row]}],
 ['仅有观察，省略 events',{observations:[row]}],
 ['空事件字段不阻断有效观察',{events:null,observations:[row]}],
 ['外层 data 包装',{data:{observations:[row]}}],
 ['result 内嵌 JSON 字符串',{result:JSON.stringify({observations:[row]})}],
 ['多层 payload 包装',{output:{payload:{data:{observations:[row]}}}}],
 ['snake_case 字段',{style_observations:[{unit_id:row.unitId,original_text:row.quote,description:row.observation}]}],
 ['中文字段',{性格观察:[{来源ID:row.unitId,原文:row.quote,观察:row.observation,维度:'性格'}]}],
 ['单条观察对象',{observations:row}],
 ['根节点为记录数组',[row]],
 ['根节点为结果数组',[{observations:[row]}]],
 ['直接返回一条有证据记录',row],
 ['空标准数组与有效 notes 同时出现',{events:[],observations:[],notes:[row]}],
 ['嵌套 evidence 对象',{notes:[{evidence:{unitId:row.unitId,quote:row.quote},description:row.observation}]}],
 ])check(name+' 可归一化',()=>{const result=parse(value);assert.equal(result.value.observations.length,1);assert.equal(result.value.events.length,0);assert.equal(result.value.observations[0].unitId,row.unitId)})
check('只有事件数组也可成功，无须伪造 observations',()=>{const r=parse({events:[event]});assert.equal(r.value.events.length,1);assert.deepEqual(r.value.observations,[])})
check('明确没有事件和观察时保留空结果，不补编事实',()=>{const r=parse({events:[],observations:[]});assert.deepEqual(r.value,{events:[],observations:[],uncertainties:[]})})
check('忽略思考区 JSON，选择实际输出',()=>{const r=parse('<think>示例 {"wrong":"example"}</think>\n```json\n'+JSON.stringify({observations:[row]})+'\n```');assert.equal(r.value.observations[0].observation,row.observation)})
check('正文前的无关 JSON 不再抢占真实结果',()=>{const r=parse('{"status":"thinking"}\n'+JSON.stringify({observations:[row]}));assert.equal(r.value.observations.length,1)})
check('不选择缺少出处的格式示例',()=>{const r=parse('{"events":[{"unitId":"","quote":"原文","narrative":"示例"}],"observations":[]}\n'+JSON.stringify({observations:[row]}));assert.equal(r.value.events.length,0);assert.equal(r.value.observations[0].quote,row.quote)})
check('允许 JSON 尾逗号，不改变字符串里的标点',()=>{const raw=JSON.stringify({observations:[row]}).replace(']}','],}');assert.equal(parse(raw).value.observations.length,1)})
check('缺失单元 ID 只能凭唯一逐字引文恢复',()=>{const r=parse({observations:[{quote:row.quote,observation:row.observation}]});assert.equal(r.value.observations[0].unitId,row.unitId);assert.equal(r.diagnostic.recoveredUnitIds,1)})
check('错误的未知 ID 可以从唯一原文恢复',()=>assert.equal(parse({notes:[{...row,unitId:'model-invented-id'}]}).value.observations[0].unitId,row.unitId))
check('明确属于别人的单元不能被挪作目标证据',()=>assert.throws(()=>parse({observations:[{...row,unitId:'s1m2_1'}]}),/没有引文能匹配/))
check('引文歧义时不猜测缺失的 ID',()=>assert.throws(()=>parse({observations:[{quote:row.quote,observation:row.observation}]},{units:[units[0],{...units[0],id:'another'}]}),/没有引文能匹配/))
check('改写或编造的引文不因格式兼容而被接受',()=>assert.throws(()=>parse({observations:[{...row,quote:'原文根本没有说过这件事'}]}),/逐字 quote/))
check('无结构的 Markdown 不被伪装成成功结果',()=>assert.throws(()=>parse('她性格温柔，平时说话比较轻。'),/合法 JSON/))
check('失败列出实际返回字段，不泄露原始材料内容',()=>{try{parse({summary:'SECRET SOURCE MATERIAL'})}catch(error){assert.match(error.message,/summary/);assert.match(error.message,/events/);assert.ok(error.diagnostic);assert.doesNotMatch(error.message,/SECRET SOURCE MATERIAL/);return}assert.fail('should reject')})
check('错误信息中的密钥和令牌会被隐藏',()=>{const message=safeDistillError('sk-abcdefghijk Bearer user-secret ?token=private-token');assert.doesNotMatch(message,/abcdefghijk|user-secret|private-token/)})
check('人格外层包装和 persona 别名可以解析',()=>{const r=parseDistillResponse(JSON.stringify({data:{persona:{traits:['直接'],style:{verbosity:0.2}}}}),{phase:'personality'});assert.deepEqual(r.value.personality.traits,['直接'])})
check('表达阶段允许直接的 voice 属性集合',()=>{const r=parseDistillResponse(JSON.stringify({tone:'平静',speechRules:['先确认再回应']}),{phase:'voice'});assert.equal(r.value.voice.tone,'平静')})
check('归纳阶段允许 notes / source_ids 别名',()=>{const r=parseDistillResponse(JSON.stringify({data:{notes:[{description:'合并后的观察',source_ids:['e1']}]}}),{phase:'reduce'});assert.deepEqual(r.value.observations[0].evidenceIds,['e1'])})

const parsed=parseSources([{name:'chat.json',text:JSON.stringify([{senderId:'10000',senderName:'甲',content:text},{senderId:'20000',senderName:'乙',content:'听你这么说，我也放松了一点，先喝点茶吧'}])}])
let extractCalls=0,alwaysWrong=false
const systems=[],budgets=[]
const connection={provider:'stub',model:'format-varying-model',llm:{async *stream(options){
 if(options.system.includes('人物素材分析器')){
  extractCalls++;systems.push(options.system);budgets.push(options.maxTokens)
  if(alwaysWrong||extractCalls===1){yield{type:'text-delta',text:JSON.stringify({summary:'只返回了一个总结'})};return}
  const marker='素材单元：\n',user=options.messages[0].content[0].text,records=JSON.parse(user.slice(user.indexOf(marker)+marker.length)),target=records.find(r=>r.role==='TARGET')
  yield{type:'text-delta',text:'<think>{"example":true}</think>\n'+JSON.stringify({data:{性格观察:[{来源ID:target.unitId,原文:target.text.slice(0,18),观察:'先说自己的状态，再给对方一点回应空间'}]}})}
 }else if(options.system.includes('人格分析师'))yield{type:'text-delta',text:JSON.stringify({persona:{traits:['直接'],values:['平等交流'],style:{verbosity:0.25}},oneLine:'平静直接',coreWound:'',copingStyle:'先确认再回应',report:'根据可核对的说话证据归纳。'})}
 else yield{type:'text-delta',text:JSON.stringify({data:{voice:{tone:'平静',rhythm:'短句',speechRules:['先确认再回应'],replyPatterns:[{situation:'对方关心',approach:'先说明自己的感受',example:'好多了，你呢'}]}}})}
}}}
const progress=[]
const result=await distillPersona(parsed,{target:'10000'},connection,{onProgress:p=>progress.push(p)})
check('复现首阶段 0 成功：格式修复后可以完成完整蒸馏',()=>{assert.equal(extractCalls,2);assert.equal(result.persona.events.length,0);assert.equal(result.persona.voice.tone,'平静');assert.deepEqual(result.persona.personality.traits,['直接'])})
check('重试包含实际字段反馈和修正规格，不是原样重复',()=>{assert.match(systems[1],/上一轮输出校验失败/);assert.match(systems[1],/summary/);assert.match(systems[1],/只输出本阶段的实际 JSON/);assert.equal(budgets[1],budgets[0]);assert.ok(progress.some(p=>p.message.includes('summary')))})
alwaysWrong=true
const jobs=new DistillationJobs()
try{
 const imported=jobs.preview([{name:'chat.json',text:JSON.stringify([{senderId:'10000',senderName:'甲',content:text}])}])
 const task=jobs.start(imported.importId,{target:'10000'},connection)
 await jobs.jobs.get(task.jobId).task
 const status=jobs.get(task.jobId)
 check('仍失败时显示具体阶段和收到字段，不停留在重试提示',()=>{assert.equal(status.status,'error');assert.equal(status.completedStages,0);assert.match(status.error,/证据提取阶段失败/);assert.match(status.error,/summary/);assert.equal(status.progress.message,status.error);assert.equal(status.diagnostic.stageKey,'extract:0');assert.equal(status.canResume,true)})
}finally{await jobs.dispose()}
console.log('\n'+passed+'/'+passed+' 通过')
