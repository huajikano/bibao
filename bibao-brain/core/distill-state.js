/** 本机后台任务存档：材料只写一次，阶段逐条原子落盘；不保存模型密钥或连接对象。 */
import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
const validId = (id) => typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)
const validStage = (key) => /^(?:extract:\d+|reduce:\d+:\d+|personality|voice)$/.test(String(key))

export class DistillStateStore {
  constructor(dir) { this.root=path.resolve(dir);this.pending=new Set();this.tails=new Map() }
  file(kind,id,name) {
    if(!validId(id))throw new Error('蒸馏任务标识不合法')
    return kind==='imports'?path.join(this.root,'imports',id+'.json'):path.join(this.root,'jobs',id,name)
  }
  async init() { await mkdir(path.join(this.root,'imports'),{recursive:true,mode:0o700});await mkdir(path.join(this.root,'jobs'),{recursive:true,mode:0o700}) }
  write(file,value) {
    const data=JSON.stringify(value)
    const task=(this.tails.get(file)??Promise.resolve()).then(async()=>{
      await mkdir(path.dirname(file),{recursive:true,mode:0o700})
      const temp=file+'.'+randomUUID()+'.tmp'
      try {await writeFile(temp,data,{encoding:'utf8',mode:0o600});await rename(temp,file)}
      catch(error){await rm(temp,{force:true}).catch(()=>{});throw error}
    })
    this.tails.set(file,task.catch(()=>{}));this.pending.add(task)
    task.then(()=>this.pending.delete(task),()=>this.pending.delete(task))
    return task
  }
  saveImport(id,record) { return this.write(this.file('imports',id),{schema:1,id,at:record.at,parsed:record.parsed}) }
  saveJob(job) {
    const data={schema:1,id:job.id,importId:job.importId,at:job.at,createdAt:job.createdAt,options:job.options,status:job.status,progress:job.progress,plan:job.plan,model:job.model,error:job.error,diagnostic:job.diagnostic,persona:job.persona,warnings:job.warnings,analysis:job.analysis,build:job.build,reasoningHistory:job.reasoningHistory??[]}
    return this.write(this.file('jobs',job.id,'state.json'),data)
  }
  saveStage(jobId,key,value) {
    if(!validStage(key))throw new Error('蒸馏阶段标识不合法')
    const name=createHash('sha256').update(key).digest('hex')+'.json'
    return this.write(this.file('jobs',jobId,path.join('stages',name)),{schema:1,key,value})
  }
  async read(file,max=4*1024*1024) { const info=await stat(file);if(info.size>max)throw new Error('任务存档超出可读取范围');return JSON.parse(await readFile(file,'utf8')) }
  async load() {
    await this.init()
    const imports=new Map(),jobs=[],warnings=[]
    const importFiles=await readdir(path.join(this.root,'imports'),{withFileTypes:true})
    for(const file of importFiles.filter((f)=>f.isFile()&&/\.json$/.test(f.name)).slice(0,32)) {
      const id=file.name.slice(0,-5);if(!validId(id))continue
      try {const saved=await this.read(this.file('imports',id),600*1024*1024);if(saved.schema===1&&saved.id===id&&Array.isArray(saved.parsed?.units)&&Array.isArray(saved.parsed?.sources))imports.set(id,{at:Number(saved.at)||Date.now(),parsed:saved.parsed,persisted:Promise.resolve()})}
      catch {warnings.push('一份后台素材存档无法读取，相关任务需要重新导入')}
    }
    const folders=await readdir(path.join(this.root,'jobs'),{withFileTypes:true})
    for(const folder of folders.filter((f)=>f.isDirectory()&&validId(f.name)).slice(0,32)) {
      try {
        const job=await this.read(this.file('jobs',folder.name,'state.json'),8*1024*1024)
        if(job.schema!==1||job.id!==folder.name||!validId(job.importId))continue
        const cache=new Map(),dir=this.file('jobs',job.id,'stages')
        let stages=[];try{stages=await readdir(dir,{withFileTypes:true})}catch{}
        const files=stages.filter((f)=>f.isFile()&&/^[0-9a-f]{64}\.json$/.test(f.name)).slice(0,20000)
        for(let i=0;i<files.length;i+=16)await Promise.all(files.slice(i,i+16).map(async(file)=>{
          try{const record=await this.read(path.join(dir,file.name));if(record.schema===1&&validStage(record.key)&&record.value&&typeof record.value==='object')cache.set(record.key,record.value)}catch{warnings.push('一个已完成阶段的存档损坏，继续时会重新计算')}
        }))
        jobs.push({...job,cache})
      }catch{warnings.push('一份后台任务存档无法读取，其他任务不受影响')}
    }
    return {imports,jobs,warnings:[...new Set(warnings)]}
  }
  async removeJob(id) { await this.flush();await rm(this.file('jobs',id,''),{recursive:true,force:true}) }
  async removeImport(id) { await this.flush();await rm(this.file('imports',id),{force:true}) }
  async flush() { await Promise.all([...this.pending]) }
}
