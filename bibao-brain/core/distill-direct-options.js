/** 直连端点的思考参数。原生星火 Chat 只暴露其文档声明的模式，不把低中高伪装为原生强度。 */
export function directReasoningProtocol({baseURL='',model=''}={}) {
  try{const host=new URL(baseURL).hostname.toLowerCase();if(host.startsWith('maas-api.')&&host.endsWith('.xf-yun.com')&&/^spark-/i.test(model))return 'spark-thinking'}catch{}
  return 'openai-effort'
}
export function directGenerationOptions({baseURL,model,reasoningEffort='',temperature=0.25,maxTokens=500,nativeOptions=false}) {
  if(directReasoningProtocol({baseURL,model})==='spark-thinking'&&(nativeOptions||reasoningEffort)){
    const type=({none:'disabled',enabled:'enabled',auto:'auto'})[reasoningEffort]
    if(reasoningEffort&&!type){const error=new Error('原生星火Chat接口支持默认、关闭、自动、开启思考；没有声明低/中/高强度，请选择该接口的可用模式');error.code='LLM_REASONING_UNSUPPORTED';throw error}
    return {max_completion_tokens:maxTokens,...(type?{thinking:{type}}:{})}
  }
  return {max_tokens:maxTokens,...(reasoningEffort?{reasoning_effort:reasoningEffort}:{temperature})}
}
