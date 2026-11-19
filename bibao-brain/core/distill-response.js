/** 兼容模型的 JSON 包装和常见字段名；只修复格式，不生成事实、不放宽引文校验。 */
import { normalizeProfile } from './persona-profile.js'
const keyOf = (key) => String(key).normalize('NFKC').toLowerCase().replace(/[\s_-]/g, '')
const compact = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase()
const object = (v) => v && typeof v === 'object' && !Array.isArray(v)
const names = (v) => Array.isArray(v) ? '[数组]' : object(v) ? Object.keys(v).slice(0,16).join('、') || '[空对象]' : typeof v
const get = (v, aliases) => {
  if (!object(v)) return undefined
  let fallback
  for (const alias of aliases) {
    const key = Object.keys(v).find((k) => keyOf(k) === keyOf(alias))
    if (key === undefined) continue
    const value = v[key]
    if (fallback === undefined) fallback = value
    if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length) && (!object(value) || Object.keys(value).length)) return value
  }
  return fallback
}
const str = (v) => typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
const eventNames = ['events','lifeEvents','lifeExperiences','experiences','人生经历','人生事件','经历','事件']
const observationNames = ['observations','profileObservations','personalityObservations','styleObservations','notes','人物观察','性格观察','表达观察','性格证据','观察','观察结果']
const wrappers = new Set(['data','result','results','output','response','payload','content','message','choices','analysis','extraction','final','提取结果','分析结果','返回结果','结果','数据'].map(keyOf))

export function safeDistillError(message) {
  return String(message ?? '').replace(/\b(?:sk|ak)[-_][A-Za-z0-9_-]{8,}/gi,'[密钥已隐藏]').replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]').replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^\s&]+/gi,'$1[已隐藏]').replace(/\s+/g,' ').slice(0,900)
}
export function stageSchema(phase) {
  if (phase === 'extract') return '{"events":[],"observations":[{"unitId":"材料单元的实际ID","quote":"逐字原文","observation":"由引文支持的具体习惯","dimension":"personality","confidence":0.8}],"uncertainties":[]}；无人生事件可省略 events 或设为 []，只提取有出处的内容'
  if (phase === 'reduce') return '{"observations":[{"observation":"归纳","dimension":"personality","evidenceIds":["输入中已有的证据ID"],"confidence":0.8}]}'
  if (phase === 'personality') return '{"oneLine":"概括","personality":{"traits":[],"values":[],"boundaries":[],"style":{}},"report":"分析","uncertainties":[]}'
  return '{"voice":{"tone":"语气","rhythm":"节奏","speechRules":[],"responseRules":[],"replyPatterns":[]},"report":"分析","uncertainties":[]}'
}
function failure(phase, reason, shape = '') {
  const error = new Error(safeDistillError(reason + (shape ? '；收到字段：' + shape : '')))
  error.diagnostic = { phase, reason: safeDistillError(reason), received: safeDistillError(shape) }
  return error
}

function withoutTrailingCommas(text) {
  let out='', quoted=false, escaped=false
  for(let i=0;i<text.length;i++) {
    const c=text[i]
    if(quoted){out+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}
    if(c==='"')quoted=true
    if(c===','){let j=i+1;while(/\s/.test(text[j]??'')&&j<text.length)j++;if(text[j]===']'||text[j]==='}')continue}
    out+=c
  }
  return out
}
function jsonCandidates(raw) {
  const candidates=[],seen=new Set()
  const add=(text)=>{const trimmed=text.trim().replace(/^\uFEFF/,'');if(!trimmed||seen.has(trimmed))return;seen.add(trimmed);try{const v=JSON.parse(trimmed);if(v&&typeof v==='object')candidates.push(v)}catch{try{const v=JSON.parse(withoutTrailingCommas(trimmed));if(v&&typeof v==='object')candidates.push(v)}catch{}}}
  const original=String(raw??'').trim();add(original)
  // 完整 JSON 优先原样解析，避免引文中的标签被改变。只有外围文本才去除完整的思考区块。
  const text=candidates.length?original:original.replace(/<(?:think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/(?:think|analysis|reasoning)\s*>/gi,'')
  for(const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))add(match[1])
  let start=-1,stack=[],quoted=false,escaped=false
  for(let i=0;i<text.length;i++){
    const c=text[i]
    if(start<0){if(c==='{'||c==='['){start=i;stack=[c];quoted=false}continue}
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}
    if(c==='"'){quoted=true;continue}
    if(c==='{'||c==='[')stack.push(c)
    else if(c==='}'||c===']'){const expected=c==='}'?'{':'[';if(stack.pop()!==expected){start=-1;stack=[];continue}if(!stack.length){add(text.slice(start,i+1));start=-1}}
  }
  return candidates
}
function unpack(candidates) {
  const nodes=[],queue=candidates.map((value)=>({value,depth:0})),seen=new Set()
  while(queue.length&&nodes.length<96){const node=queue.shift();if(!node.value||typeof node.value!=='object'||seen.has(node.value))continue;seen.add(node.value);nodes.push(node);if(node.depth>=5)continue
    if(Array.isArray(node.value)){for(const row of node.value.slice(0,12))if(object(row))queue.push({value:row,depth:node.depth+1});continue}
    for(const [key,value]of Object.entries(node.value))if(wrappers.has(keyOf(key))){
      if(typeof value==='string')for(const parsed of jsonCandidates(value))queue.push({value:parsed,depth:node.depth+1})
      else if(Array.isArray(value)&&['choices','results'].includes(keyOf(key)))for(const row of value.slice(0,12))queue.push({value:row,depth:node.depth+1})
      else if(value&&typeof value==='object')queue.push({value,depth:node.depth+1})
    }
  }
  return nodes
}
const asRows=(v)=>Array.isArray(v)?v:object(v)?[v]:[]
function normalizeRecord(row,kind,units=[]) {
  if(!object(row))return null
  const evidence=get(row,['evidence','source','citation','出处','证据','来源'])
  const proof=object(evidence)?evidence:Array.isArray(evidence)?evidence.find(object)??{}:{}
  let unitId=str(get(row,['unitId','unit_id','sourceId','source_id','materialId','单元ID','材料ID','来源ID'])??get(proof,['unitId','sourceId','id','单元ID']))
  let quote=str(get(row,['quote','originalQuote','originalText','excerpt','原文','引文','原文引用','原文摘录','引用'])??get(proof,['quote','text','excerpt','原文','引文'])??(typeof evidence==='string'?evidence:undefined))
  const observation=str(get(row,['observation','description','insight','trait','habit','text','观察','观察结果','描述','性格','习惯','结论']))
  const narrative=str(get(row,['narrative','description','summary','text','叙事','经历描述','事件描述','描述']))
  const declared=units.find((u)=>u.id===unitId)
  const variants=[quote,quote.replace(/^[「『“"']|[」』”"']$/g,'')].filter(Boolean)
  let verified=false,recovered=false
  if(declared?.isTarget){const actual=variants.find((q)=>compact(declared.text).includes(compact(q)));if(actual){quote=actual;verified=true}}
  // 明确指向其他人的单元不能被“修复”成目标人物。缺失/错误ID只在引文唯一匹配时恢复。
  else if(!declared){for(const q of variants){const matches=units.filter((u)=>u.isTarget&&compact(u.text).includes(compact(q)));if(matches.length===1){unitId=matches[0].id;quote=q;verified=true;recovered=true;break}}}
  const dimension=str(get(row,['dimension','category','维度','类型'])).toLowerCase()
  const mappedDimension=({性格:'personality',人格:'personality',表达:'voice',说话:'voice',回复:'reply',边界:'boundary'})[dimension]??dimension
  const confidence=get(row,['confidence','置信度','可信度'])
  return {value:{...row,unitId,quote,...(kind==='event'?{title:str(get(row,['title','name','标题','事件'])),narrative,age:get(row,['age','年龄'])??null}:{observation}),dimension:mappedDimension,confidence:typeof confidence==='number'?confidence:0.65},verified,recovered}
}
function extractShape(value,units) {
  let eventValue=get(value,eventNames),observationValue=get(value,observationNames)
  if(Array.isArray(value)){
    eventValue=value.filter((r)=>object(r)&&(get(r,['narrative','叙事','经历描述'])!==undefined))
    observationValue=value.filter((r)=>object(r)&&!eventValue.includes(r))
    if(!value.length)return null
  }else if(object(value)&&eventValue===undefined&&observationValue===undefined&&(get(value,['quote','原文','引文'])!==undefined)){
    if(get(value,['narrative','叙事','经历描述'])!==undefined)eventValue=[value];else observationValue=[value]
  }
  if(eventValue===undefined&&observationValue===undefined)return null
  const events=asRows(eventValue).map((r)=>normalizeRecord(r,'event',units)).filter(Boolean)
  const observations=asRows(observationValue).map((r)=>normalizeRecord(r,'profile',units)).filter(Boolean)
  if(!Array.isArray(eventValue)&&!object(eventValue)&&!Array.isArray(observationValue)&&!object(observationValue))return null
  const verified=[...events,...observations].filter((r)=>r.verified).length
  return {value:{events:events.map((r)=>r.value),observations:observations.map((r)=>r.value),uncertainties:asRows(get(value,['uncertainties','不确定项','不确定性'])).filter((v)=>typeof v==='string')},verified,recovered:[...events,...observations].filter((r)=>r.recovered).length,score:20+verified*30-(events.length+observations.length-verified)*2}
}

export function parseDistillResponse(raw,{phase,units=[]}={}) {
  const roots=jsonCandidates(raw)
  if(!roots.length)throw failure(phase,'模型未返回合法 JSON，或正文被截断；需要本阶段的 JSON 数据')
  let best=null
  for(const {value,depth}of unpack(roots)){
    let normalized
    if(phase==='extract')normalized=extractShape(value,units)
    else if(phase==='reduce'){
      const rows=get(value,observationNames)??(Array.isArray(value)?value:undefined)
      if(rows!==undefined){const observations=asRows(rows).filter(object).map((r)=>({...r,observation:str(get(r,['observation','description','text','观察','归纳','描述'])),evidenceIds:get(r,['evidenceIds','sourceIds','证据ID','出处ID'])??[]}));normalized={value:{observations},score:20+observations.filter((r)=>r.observation&&Array.isArray(r.evidenceIds)&&r.evidenceIds.length).length*10}}
    }else if(object(value)){
      const profileKey=phase==='personality'?'personality':'voice'
      const aliases=phase==='personality'?['personality','persona','人格','性格档案']:['voice','speech','表达','表达档案','说话方式']
      const nested=get(value,aliases)
      const canonical={...value,...(nested!==undefined?{[profileKey]:nested}:{[profileKey]:value})}
      const profile=normalizeProfile(canonical)
      if(profile[profileKey])normalized={value:{...canonical,...profile},score:20+JSON.stringify(profile[profileKey]).length/100}
    }
    if(normalized){const score=normalized.score-depth/100;if(!best||score>=best.score)best={...normalized,score,received:names(value)}}
  }
  if(!best)throw failure(phase,phase==='extract'?'未识别到 events / observations（可只返回其中一个数组）':phase==='reduce'?'未识别到带 evidenceIds 的观察归纳数组':'未识别到本阶段的'+(phase==='personality'?'人格':'表达')+'档案',names(roots.at(-1)))
  if(phase==='extract'&&best.value.events.length+best.value.observations.length>0&&!best.verified)throw failure(phase,'提取到了候选记录，但没有引文能匹配所选人物的材料单元；请返回实际 unitId 和逐字 quote',best.received)
  return {value:best.value,diagnostic:{phase,received:safeDistillError(best.received),verified:best.verified??null,recoveredUnitIds:best.recovered??0}}
}
