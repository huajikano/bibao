/** 人格与表达档案白名单；长材料报告只供审核，不能写入路由、激素或核心信念。 */
export const PROFILE_STYLE_KEYS = ['warmth','playfulness','directness','verbosity','vulnerability','initiative']
const text = (v,max=80) => typeof v==='string' ? v.replace(/\s+/g,' ').trim().slice(0,max) : ''
const list = (v,count=12,max=100) => Array.isArray(v) ? [...new Set(v.map((x)=>text(x,max)).filter(Boolean))].slice(0,count) : []
export function normalizeProfile(input={}) {
  const raw=input.voice??{},voice={}
  for(const key of ['tone','rhythm','extra']){const v=text(raw[key],key==='extra'?1000:240);if(v)voice[key]=v}
  for(const key of ['quirks','likes','dislikes','catchphrases','avoid','speechRules','responseRules']){
    const v=list(raw[key],key==='responseRules'?16:12,key==='catchphrases'?32:['speechRules','responseRules'].includes(key)?180:100)
    if(v.length)voice[key]=v
  }
  const patterns=(Array.isArray(raw.replyPatterns)?raw.replyPatterns:[]).slice(0,16).map((r)=>({situation:text(r?.situation,64),approach:text(r?.approach,240),example:text(r?.example,160)})).filter((r)=>r.situation&&r.approach)
  if(patterns.length)voice.replyPatterns=patterns
  const examples=(Array.isArray(raw.dialogueExamples)?raw.dialogueExamples:[]).slice(0,12).map((r)=>({situation:text(r?.situation,64),input:text(r?.input,140),response:text(r?.response,160)})).filter((r)=>r.input&&r.response)
  if(examples.length)voice.dialogueExamples=examples
  const personality={}
  for(const key of ['traits','values','boundaries']){const v=list(input.personality?.[key]);if(v.length)personality[key]=v}
  const style={}
  for(const key of PROFILE_STYLE_KEYS){const v=input.personality?.style?.[key];if(typeof v==='number'&&Number.isFinite(v))style[key]=Math.max(0,Math.min(1,v))}
  if(Object.keys(style).length)personality.style=style
  return {...(Object.keys(voice).length?{voice}:{}),...(Object.keys(personality).length?{personality}:{})}
}
export function normalizeDistillation(value) {
  if(value?.version!==1||!text(value.target,80))return null
  const raw=value.analysis
  const analysis={}
  if(raw&&typeof raw==='object'){
    analysis.mode=raw.mode==='full'?'full':'sample'
    for(const key of ['totalChars','relevantChars','analyzedChars','segments'])analysis[key]=Math.max(0,Math.min(100000000,Number(raw[key])||0))
    analysis.model=text(raw.model,120)
    analysis.reasoningEffort=text(raw.reasoningEffort,40)
    analysis.build=text(raw.build,80)
    analysis.personalityReport=text(raw.personalityReport,12000)
    analysis.voiceReport=text(raw.voiceReport,12000)
    analysis.facts=list(raw.facts,24,240)
    analysis.inferences=list(raw.inferences,24,240)
  }
  return {version:1,target:text(value.target,80),kind:['novel','chat','mixed'].includes(value.kind)?value.kind:'mixed',sources:list(value.sources,32,160),createdAt:text(value.createdAt,40),
    evidence:(Array.isArray(value.evidence)?value.evidence:[]).slice(0,600).map((r)=>({id:text(r?.id,32),source:text(r?.source,160),unitId:text(r?.unitId,64),quote:text(r?.quote,180),observation:text(r?.observation,180),kind:r?.kind==='event'?'event':'profile',dimension:text(r?.dimension,20),confidence:typeof r?.confidence==='number'?Math.max(0,Math.min(1,r.confidence)):0.65})).filter((r)=>r.id&&r.quote&&r.observation),
    uncertainties:list(value.uncertainties,24,180),...(raw?{analysis}:{})}
}
