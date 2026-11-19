#!/usr/bin/env node
/** 真正的两个独立Node进程：写入阶段后强制结束，再由新进程只恢复剩余阶段。 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { DistillationJobs } from '../core/distill.js'
const phase=process.argv[2],dir=process.argv[3]
if(!phase){
 const root=await mkdtemp(path.join(os.tmpdir(),'bibao-process-restart-'))
 try{
  const script=fileURLToPath(import.meta.url)
  const writer=spawnSync(process.execPath,[script,'write',root],{stdio:'inherit',timeout:10000})
  assert.equal(writer.status,0,'writer process')
  const reader=spawnSync(process.execPath,[script,'read',root],{stdio:'inherit',timeout:10000})
  assert.equal(reader.status,0,'reader process')
  console.log('PASS 两个独立进程完成后台阶段恢复，未重复已完成模型调用')
 }finally{await rm(root,{recursive:true,force:true})}
}else{
 const counts={extract:0,personality:0,voice:0},text='我今天把拖了两天的稿子交了，回家路上买了一杯热茶，终于松了口气。'
 const conn={provider:'fixture',model:'fixture-model',llm:{async *stream(options){
  if(options.system.includes('人物素材分析器')){
   counts.extract++;assert.equal(phase,'write','new process must not call completed extraction')
   const user=options.messages[0].content[0].text,marker='素材单元：\n',units=JSON.parse(user.slice(user.indexOf(marker)+marker.length)),u=units.find(u=>u.role==='TARGET')
   yield{type:'text-delta',text:JSON.stringify({events:[],observations:[{unitId:u.unitId,quote:u.text.slice(0,18),observation:'直接表达自己的状态，但不会催促对方'}]})}
  }else if(options.system.includes('人格分析师')){
   counts.personality++
   if(phase==='write'){await new Promise(()=>{});return}
   yield{type:'text-delta',text:JSON.stringify({oneLine:'平静直接',coreWound:'',copingStyle:'先确认再回应',personality:{traits:['直接'],style:{verbosity:0.3}}})}
  }else{
   counts.voice++;yield{type:'text-delta',text:JSON.stringify({voice:{tone:'平静',speechRules:['先说明自己的状态']}})}
  }
 }}}
 const jobs=new DistillationJobs({dir:path.join(dir,'state')});await jobs.ready()
 if(phase==='write'){
  const imported=jobs.preview([{name:'source.json',text:JSON.stringify([{senderId:'10000',senderName:'阿雨',content:text}])}])
  const started=jobs.start(imported.importId,{target:'10000',reasoningEffort:'high'},conn);await jobs.waitAccepted(started.jobId)
  for(let i=0;i<200&&counts.personality!==1;i++)await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(counts.extract,1);assert.equal(counts.personality,1)
  await jobs.store.flush()
  await writeFile(path.join(dir,'fixture.json'),JSON.stringify({jobId:started.jobId}),'utf8')
  console.log('PASS 写进程完成提取存档后直接结束，未执行优雅暂停')
  process.exit(0)
 }else{
  try{
   const {jobId}=JSON.parse(await readFile(path.join(dir,'fixture.json'),'utf8'))
   const restored=jobs.get(jobId)
   assert.equal(restored.status,'cancelled');assert.equal(restored.completedStages,1);assert.equal(restored.canResume,true)
   assert.equal(counts.extract,0);assert.equal(counts.personality,0);assert.equal(counts.voice,0)
   await jobs.resume(jobId,conn,{reasoningEffort:'low'});await jobs.jobs.get(jobId).task
   const result=jobs.get(jobId)
   assert.equal(result.status,'done');assert.equal(result.completedStages,3)
   assert.equal(counts.extract,0);assert.equal(counts.personality,1);assert.equal(counts.voice,1)
   assert.equal(result.persona.voice.tone,'平静');assert.equal(result.reasoningEffort,'low')
   console.log('PASS 读进程识别中断任务，只调用人格和表达阶段')
  }finally{await jobs.dispose()}
 }
}
