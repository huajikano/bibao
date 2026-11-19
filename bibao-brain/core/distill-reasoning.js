/** 思考强度是每个任务的实际模型参数；默认不额外发送，DSH 按模型能力校验。 */
const labels={none:'关闭额外思考',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',auto:'自动判断',enabled:'开启深度思考'}
export function normalizeReasoningEffort(value) {
  if(value===undefined||value===null||value===''||value==='default')return ''
  if(typeof value!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/i.test(value))throw new Error('思考强度参数不合法')
  return value
}
export async function reasoningCapabilities(connection,llmService=null) {
  const base={id:'',name:'跟随模型默认'}
  if(!connection?.llm)return {efforts:[base],source:'unavailable',note:'请先配置蒸馏模型'}
  if(connection.llm.reasoningProtocol==='spark-thinking')return {efforts:[base,...['none','auto','enabled'].map(id=>({id,name:labels[id]}))],source:'spark-thinking',note:'星火原生Chat接口声明支持关闭、自动、开启思考；不把未声明的低/中/高强度假映射成模式'}
  if(connection.llm.direct===true)return {efforts:[base,...['none','low','medium','high'].map(id=>({id,name:labels[id]}))],source:'openai-compatible',note:'所选强度会按 reasoning_effort 原样请求；若端点拒绝会显示错误，是否执行该参数由兼容端点实现决定'}
  if(typeof llmService?.resolveModelInfo!=='function')return {efforts:[base],source:'unknown',note:'当前模型未提供思考强度能力信息，仅可使用模型默认'}
  try {
    const info=await llmService.resolveModelInfo(connection.provider,connection.model)
    const efforts=(info.reasoning?.efforts??[]).filter(row=>row?.id&&typeof row.id==='string').map(row=>({id:row.id,name:labels[row.id]??row.name??row.id}))
    return {efforts:[base,...efforts.filter((row,i,all)=>all.findIndex(other=>other.id===row.id)===i)],source:'model-capability',defaultEffort:info.reasoning?.defaultEffort??'',note:efforts.length?'仅列出当前模型声明支持的思考强度':'当前模型没有可调思考强度，使用模型默认'}
  }catch{return {efforts:[base],source:'unknown',note:'无法读取当前模型的思考能力，可先使用模型默认'}}
}
export async function validateReasoningEffort(value,connection,llmService=null) {
  const effort=normalizeReasoningEffort(value)
  if(!effort)return effort
  const capabilities=await reasoningCapabilities(connection,llmService)
  if(!capabilities.efforts.some(row=>row.id===effort))throw new Error('当前模型未声明支持所选思考强度，请选择模型默认或列表中的可用强度')
  return effort
}
