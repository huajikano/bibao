#!/usr/bin/env node
/** 大容量、身份歧义、分层分析和恢复回归。不使用真实素材或真实模型。 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import vm from 'node:vm'
import { MaterialUploads, decodeMaterial, DISTILL_LIMITS } from '../core/distill-files.js'
import { parseSources, prepareDistillation, publicPlan, findNovelCharacters } from '../core/distill-sources.js'
import { distillPersona, DistillationJobs } from '../core/distill.js'
import { buildSystemPrompt } from '../core/voice.js'
import { renderDistillHtml } from '../core/distill-ui.js'
let checks=0
const check=(name,run)=>{run();checks++;console.log('PASS '+name)}
const rows=[{senderId:'100000001',senderName:'小雨',content:'我今天终于交稿了，回家路上买了一杯热茶，才慢慢松了口气。'},{senderId:'100000002',senderName:'小雨',content:'我爱说叠词，给我大大的抱抱，这真是个可爱的世界呀。'},{senderId:'100000001',senderName:'雨姐',content:'别急着给答案，我想先把这件事听明白。'}]
const sources=[{name:'聊天.json',text:JSON.stringify({messages:rows})}]
const parsed=parseSources(sources)
check('改昵称仍为同一账号，同名不同账号保持分开',()=>{assert.equal(parsed.participants.length,2);const p=parsed.participants.find(p=>p.account==='100000001');assert.deepEqual(p.aliases,['小雨','雨姐']);assert.equal(p.count,2)})
check('同名手填不会误选；稳定 ID 可准确选人',()=>{assert.throws(()=>prepareDistillation(parsed,{target:'小雨'}),/多个发送者/);const p=prepareDistillation(parsed,{target:'account:100000001'});assert.equal(p.target,'雨姐');assert.equal(p.selectedMessages,2);assert.equal(p.chunks.flat().find(u=>u.speakerId==='100000002').isTarget,false)})
const missingId=parseSources([{name:'甲.txt',text:'小雨：今天有点累了\n朋友：要不早点歇会儿'},{name:'乙.txt',text:'小雨：今天想去公园走走\n阿兰：那我陪你走一段'}],{kind:'chat'})
check('无账号的跨文件同名不会强行合并',()=>{assert.equal(missingId.participants.filter(p=>p.name==='小雨').length,2);assert.throws(()=>prepareDistillation(missingId,{target:'小雨'}),/多个发送者/)})
const wx=parseSources([{name:'微信.json',text:JSON.stringify({messages:[{talker:'group@chatroom',senderName:'甲',content:'今天开会的纪要我发过来了'},{talker:'group@chatroom',senderName:'乙',content:'收到，我会再看一遍的'},{senderId:'33333',senderName:'',nickname:'阿晴',content:'',text:'我把文件补齐了，晚点一起检查'}]})}])
check('微信群会话 ID 不会被误当发送者，空字段会回退',()=>{assert.equal(wx.participants.length,3);assert.ok(wx.participants.some(p=>p.name==='阿晴'));assert.ok(!wx.participants.some(p=>p.account==='group@chatroom'))})
const header=parseSources([{name:'qq.txt',text:'小雨（123456） 2026-11-19 12:00:00\n注意：这行是消息正文，不是发送者\n小雨的新名（123456） 2026-11-19 12:01:00\n第二句话还在同一个人名下'}])
check('昵称在日期前、全角账号及正文冒号都能正确解析',()=>{assert.equal(header.participants.length,1);assert.equal(header.participants[0].account,'123456');assert.equal(header.participants[0].count,2)})
const bookText=Array.from({length:320},(_,i)=>'第'+(i+1)+'章\n阿雨说：“第'+i+'次，我还是想先听你把话说完。”\n'+'门外下着细雨，她把茶杯往窗边移了移。'.repeat(160)+'\n').join('')
const book=parseSources([{name:'长小说.txt',text:bookText}],{kind:'novel'})
const full=prepareDistillation(book,{target:'阿雨',mode:'full',chunkChars:12000})
const sample=prepareDistillation(book,{target:'阿雨',mode:'sample',analysisChars:50000,chunkChars:12000})
check('百万字材料解除旧 50 万字与 80 段上限',()=>{assert.ok(book.chars>500000);assert.ok(full.chunks.length>80);assert.equal(full.analyzedChars,bookText.trim().length)})
check('深读预算真实受控，首尾均覆盖；全文模式可完整分析',()=>{const joined=sample.chunks.flat().map(u=>u.text).join('');assert.ok(sample.analyzedChars<=50000);assert.ok(sample.sampled);assert.match(joined,/第1章/);assert.equal(sample.chunks.at(-1).at(-1).id,full.chunks.at(-1).at(-1).id);assert.ok(joined.endsWith(bookText.trim().slice(-200)));assert.equal(full.sampled,false)})
const aliases=parseSources([{name:'人物.txt',text:'小雨说：“我想一个人静静，明天再继续。”\n'+'她把茶杯放回桌上。'.repeat(1000)}],{kind:'novel'})
check('角色名加别名能定位原文，不要求只用全名',()=>{assert.throws(()=>prepareDistillation(aliases,{target:'沈雨'}),/没有找到/);assert.ok(prepareDistillation(aliases,{target:'沈雨',aliases:['小雨']}).analyzedChars>0)})
check('本地小说候选可用，但不会替代手动角色名',()=>assert.ok(findNovelCharacters(book).some(p=>p.name==='阿雨')))
check('HTML 不执行脚本，只保留正文和实体解码',()=>{const text=decodeMaterial(Buffer.from('<style>x{}</style><h1>阿雨</h1><script>evil()</script><p>今天先休息一下 &amp; 再聊</p>'),'x.html');assert.match(text,/阿雨/);assert.match(text,/&/);assert.doesNotMatch(text,/evil|x\{/)} )

// 构造合法 EPUB（两个章节按 spine 排序），验证纯内存 ZIP 读取与 deflate。
function crc32(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function zip(entries){const local=[],central=[];let offset=0;for(const [name,text]of entries){const n=Buffer.from(name),raw=Buffer.from(text),data=deflateRawSync(raw),crc=crc32(raw);const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(n.length,26);local.push(h,n,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=h.length+n.length+data.length}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end])}
const epub=zip([['META-INF/container.xml','<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>'],['OEBPS/book.opf','<package><manifest><item href="second.xhtml" id="b"/><item id="a" href="first.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'],['OEBPS/second.xhtml','<h1>下卷</h1><p>再见仍能坐下慢慢聊。</p>'],['OEBPS/first.xhtml','<h1>上卷</h1><p>阿雨先听他说完。</p>']])
check('EPUB 按阅读顺序提取正文，支持 deflate',()=>{const text=decodeMaterial(epub,'novel.epub');assert.ok(text.indexOf('上卷')<text.indexOf('下卷'));assert.match(text,/阿雨/)} )

const uploads=new MaterialUploads()
try{
 await assert.rejects(()=>uploads.init([{name:'x.txt',size:DISTILL_LIMITS.fileBytes+1}]),/100MB/);checks++;console.log('PASS 单文件超限由元数据提前拒绝，不分配巨型请求')
 const small=Buffer.from('阿雨：今天终于忙完啦，先安静地歇一会儿\n朋友：好呀，等你想聊了再说')
 const init=await uploads.init([{name:'聊天.txt',size:small.length}])
 await assert.rejects(()=>uploads.complete(init.uploadId,()=>{}),/尚未/);checks++;console.log('PASS 未上传完整的文件不能开始解析')
 const args={uploadId:init.uploadId,fileId:0,offset:0,data:small.toString('base64')};await uploads.chunk(args);await uploads.chunk(args)
 const decoded=await uploads.complete(init.uploadId,(files)=>parseSources(files))
 check('重复分片幂等、不拼重；解析后立即删除临时原文件',()=>{assert.equal(decoded.participants.length,2);assert.equal(uploads.sessions.size,0)})
 const remaining=await readdir(await uploads.root)
 check('临时目录没有遗留已完成文件',()=>assert.deepEqual(remaining,[]))
 // 实际走完 100MB 分片、磁盘暂存、解码和解析，不仅检查常量。
 const size=100*1024*1024,large=await uploads.init([{name:'100mb-novel.txt',size}])
 const block=Buffer.alloc(DISTILL_LIMITS.uploadChunk).fill('Ayu said, "Let us listen first." The rain tapped the window.\n')
 for(let offset=0;offset<size;offset+=block.length){const bytes=block.subarray(0,Math.min(block.length,size-offset));await uploads.chunk({uploadId:large.uploadId,fileId:0,offset,data:bytes.toString('base64')})}
 const big=await uploads.complete(large.uploadId,(files)=>parseSources(files))
 check('实际 100MB 文件可上传解析，远超旧 2MB 上限',()=>{assert.ok(big.chars>100000000);assert.equal(big.sources[0].kind,'novel')})
 const plan=publicPlan(big,{target:'Ayu',mode:'sample',analysisChars:600000})
 check('100MB 材料可预览受控深读范围和调用量',()=>{assert.ok(plan.analyzedChars<=600000);assert.ok(plan.totalChars>100000000);assert.ok(plan.sampled);assert.ok(plan.chunks>1)})
 assert.deepEqual(await readdir(await uploads.root),[])
}finally{await uploads.dispose()}

let failVoice=false,extractCalls=0,personalityCalls=0,voiceCalls=0,reduceCalls=0,badReduction=true
const personality={oneLine:'平静而直接，愿意先听对方把话说完',coreWound:'',copingStyle:'先确认，再回应',personality:{traits:['直接','耐心'],values:['尊重说话空间'],boundaries:['不催逼回复'],style:{warmth:0.6,playfulness:0.2,directness:0.8,verbosity:0.35,vulnerability:0.3,initiative:0.3}},facts:['在材料中先听再答'],inferences:['可能偏好平静沟通'],uncertainties:['童年不明'],report:'观察：多次先听对方说完。推断：倾向于降低冲突。'}
const voice={voice:{tone:'平静直接',rhythm:'短句，先确认再回应',speechRules:['先说具体感受，再补一个短问题'],responseRules:['安慰时先承接情绪，确认需要后再建议'],replyPatterns:[{situation:'朋友倾诉',approach:'先承接情绪，再问要不要一起想办法',example:'我听着，你慢慢说'}],dialogueExamples:[{situation:'对方疲惫',input:'今天累坏了',response:'先歇会儿，要我听你说说吗'}]},report:'表达：先承接，再澄清；不会立刻讲道理。',uncertainties:[]}
const llm={async *stream(o){
 if(o.system.includes('人物素材分析器')){extractCalls++;const marker='素材单元：\n',text=o.messages[0].content[0].text;const units=JSON.parse(text.slice(text.indexOf(marker)+marker.length));const unit=units.find(u=>u.role==='TARGET'||u.role==='NOVEL');yield{type:'text-delta',text:JSON.stringify({events:[],observations:Array.from({length:12},(_,i)=>({unitId:unit.unitId,quote:unit.text.slice(0,90),observation:'第'+extractCalls+'段的第'+i+'种具体接话方式：先确认感受，留出一点说话空间',dimension:['personality','voice','reply','boundary'][i%4],confidence:0.8})),uncertainties:[]})}}
 else if(o.system.includes('人物证据归纳器')){reduceCalls++;if(badReduction){badReduction=false;yield{type:'text-delta',text:JSON.stringify({observations:[{observation:'没有出处的归纳不可被缓存'}]})};return}const data=JSON.parse(o.messages[0].content[0].text);yield{type:'text-delta',text:JSON.stringify({observations:data.observations.filter((_,i)=>i%4===0).map(r=>({...r,evidenceIds:r.evidenceIds}))})}}
 else if(o.system.includes('人格分析师')){personalityCalls++;yield{type:'text-delta',text:JSON.stringify(personality)}}
 else{voiceCalls++;if(failVoice)throw new Error('临时模型故障');yield{type:'text-delta',text:JSON.stringify(voice)}}
}}
const conn={llm,provider:'stub',model:'distill-long-context'}
const progress=[]
const medium=parseSources([{name:'中篇.txt',text:bookText.slice(0,250000)}],{kind:'novel'})
const distilled=await distillPersona(medium,{target:'阿雨',mode:'full',chunkChars:12000},conn,{onProgress:p=>progress.push(p.phase)})
check('长文本证据全部进入分层归纳，人格与表达独立调用',()=>{assert.ok(reduceCalls>0);assert.equal(personalityCalls,1);assert.equal(voiceCalls,1);assert.ok(progress.includes('reduce'));assert.ok(progress.includes('personality'));assert.ok(progress.includes('voice'))})
check('归纳缺少出处时自动重试，不缓存无效阶段',()=>{assert.equal(badReduction,false);assert.equal(reduceCalls,Math.ceil(extractCalls*12/80)+1)})
check('深度报告、事实与推断、对话规则保留并进入实际提示词',()=>{assert.match(distilled.persona.distillation.analysis.personalityReport,/观察/);assert.match(distilled.persona.distillation.analysis.voiceReport,/表达/);assert.match(buildSystemPrompt({biography:distilled.persona}),/先说具体感受/);assert.match(buildSystemPrompt({biography:distilled.persona}),/要我听你说说吗/)})
const jobs=new DistillationJobs()
try{
 const imported=jobs.preview(sources)
 check('人物搜索可查历史昵称和账号，返回可核对的样本',()=>{const found=jobs.people(imported.importId,'小雨');assert.equal(found.count,2);assert.ok(found.people.every(p=>p.samples.length));assert.equal(jobs.people(imported.importId,'100000001').count,1)})
 const plan=jobs.plan(imported.importId,{target:'account:100000001'})
 check('开始前可预览准确目标、消息数量与调用范围',()=>{assert.equal(plan.targetId,'account:100000001');assert.equal(plan.selectedMessages,2);assert.ok(plan.estimatedCalls>=3)})
 failVoice=true;const task=jobs.start(imported.importId,{target:'account:100000001'},conn);await jobs.jobs.get(task.jobId).task
 const first=jobs.get(task.jobId),e=extractCalls,p=personalityCalls
 check('失败只影响未完成阶段，已完成结果保留可继续',()=>{assert.equal(first.status,'error');assert.equal(first.completedStages,2);assert.equal(first.canResume,true)})
 failVoice=false;await jobs.resume(task.jobId,conn);await jobs.jobs.get(task.jobId).task
 check('继续任务不重复提取和人格调用，只重做失败的表达阶段',()=>{assert.equal(jobs.get(task.jobId).status,'done');assert.equal(extractCalls,e);assert.equal(personalityCalls,p)})
}finally{await jobs.dispose()}
const html=renderDistillHtml(),script=html.match(/<script>([\s\S]*?)<\/script>/)[1]
check('界面使用明确人物列表，移除 datalist；脚本可解析',()=>{assert.doesNotMatch(html,/<datalist\b/i);assert.match(html,/<select id="targetSelect" size="7"/);assert.match(script,/target:hasChat\?selectedTargetId/);assert.match(html,/同名人物请核对账号/);new vm.Script(script)})
check('页面恢复不自动取消长任务，上传使用分片接口',()=>{assert.match(script,/upload\/chunk/);assert.match(script,/distill\/resume/);assert.match(script,/sessionStorage/);assert.doesNotMatch(script,/keepalive:true/);assert.match(html,/100MB/);assert.match(html,/200MB/)})
console.log('\n'+checks+'/'+checks+' 通过')
