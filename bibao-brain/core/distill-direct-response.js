/** OpenAI 兼容直连响应：蒸馏可请求 SSE 保持传输活跃，同时兼容忽略 stream 的 JSON 网关。 */
const contentOf=(value)=>typeof value==='string'?value:Array.isArray(value)?value.map(part=>typeof part==='string'?part:part?.text??'').join(''):''
function responseError(message,code){const error=new Error(message);error.code=code;return error}
export function parseDirectReply(text,{strictFinal=false}={}) {
  let data
  try{data=JSON.parse(text)}catch{}
  if(data){
    const message=data?.choices?.[0]?.message??{}
    let reply=contentOf(message.content)
    if(!reply.trim()&&!strictFinal)reply=String(message.reasoning_content??message.reasoning??'')
    if(data?.choices?.[0]?.finish_reason==='length'&&strictFinal)throw responseError('模型输出达到生成上限，最终 JSON 可能被截断；可提高生成预算或降低思考强度','LLM_OUTPUT_LIMIT')
    if(!reply.trim())throw responseError(strictFinal?'模型没有返回最终正文；思考内容不能代替蒸馏 JSON':'LLM 返回里既没有 content 也没有 reasoning','LLM_NO_FINAL')
    return {reply,data}
  }
  let reply='',reasoning='',usage=null,finished=false,frames=0
  for(const event of String(text).split(/\r?\n\r?\n/)){
    const payload=event.split(/\r?\n/).filter(line=>/^data:/.test(line)).map(line=>line.slice(5).trimStart()).join('\n').trim()
    if(!payload)continue
    if(payload==='[DONE]'){finished=true;continue}
    let item;try{item=JSON.parse(payload)}catch{throw responseError('模型流中出现无法解析的数据片段','LLM_STREAM_INTERRUPTED')}
    frames++
    if(item.error)throw responseError('上游模型流错误：'+String(item.error.message??item.error),'LLM_UPSTREAM_ERROR')
    const choice=item.choices?.[0],delta=choice?.delta??choice?.message??{}
    reply+=contentOf(delta.content);reasoning+=contentOf(delta.reasoning_content??delta.reasoning)
    if(item.usage)usage=item.usage
    if(choice?.finish_reason==='length')throw responseError('模型输出达到生成上限，最终 JSON 被截断；可提高生成预算或降低思考强度','LLM_OUTPUT_LIMIT')
    if(choice?.finish_reason==='stop')finished=true
  }
  if(!frames)throw responseError('LLM 返回非 JSON / SSE 响应','LLM_RESPONSE_FORMAT')
  if(!finished)throw responseError('模型流提前结束，未收到完成标记','LLM_STREAM_INTERRUPTED')
  if(!reply.trim()&&!strictFinal)reply=reasoning
  if(!reply.trim())throw responseError('模型只返回了思考内容，没有最终蒸馏 JSON','LLM_NO_FINAL')
  return {reply,data:{usage}}
}
