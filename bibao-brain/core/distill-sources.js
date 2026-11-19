/** 素材解析、稳定人物标识及可预览的长文本分析计划。 */
import { normalizeSeed } from './persona.js'
import { DISTILL_LIMITS, stripMaterialHtml } from './distill-files.js'
export { DISTILL_LIMITS } from './distill-files.js'
const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const plain = (v) => typeof v === 'string' ? v : ''
function messageText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : item?.type === 'text' ? plain(item.text ?? item.data?.text) : '').join('')
  return ''
}

function csvRows(text) {
  const rows = []; let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++ } else quoted = !quoted }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(field); field = ''; if (c === '\n') { rows.push(row); row = [] } }
    else if (c !== '\r' || quoted) field += c
  }
  if (quoted) throw new Error('CSV 引号未闭合，请重新导出')
  row.push(field); if (row.some(Boolean)) rows.push(row)
  const headers = rows.shift()?.map((s) => s.replace(/^\uFEFF/, '').trim()) ?? []
  return rows.map((values) => Object.fromEntries(headers.map((key, i) => [key, values[i] ?? ''])))
}

function structuredMessages(data) {
  const rows=Array.isArray(data)?data:data?.messages??data?.records??data?.list??data?.data?.messages??data?.data
  if(!Array.isArray(rows))throw new Error('未找到消息数组；支持 messages / records / list 或直接 JSON 数组')
  const first=(...values)=>values.find((v)=>(typeof v==='string'||typeof v==='number')&&String(v).trim())??''
  const members=new Map((Array.isArray(data?.members)?data.members:[]).map((m)=>[String(first(m.id,m.userId)),first(m.displayName,m.nickname,m.name)]))
  return rows.map((row)=>{
    const sender=row?.sender
    // talker 通常是会话/群号，并非发送者。不能用它把整个微信群合成一个人。
    const id=clean(first(row?.senderId,row?.sender_id,row?.SenderId,row?.senderWxid,row?.user_id,row?.fromUserName,row?.FromUserName,typeof sender==='object'?first(sender?.user_id,sender?.id,sender?.wxid):''),128)
    const name=clean(first(row?.senderName,row?.sender_name,row?.SenderName,row?.displayName,row?.nickname,row?.['发送者'],row?.['昵称'],typeof sender==='object'?first(sender?.card,sender?.nickname,sender?.name):sender,row?.name,row?.from,members.get(id),id),128)
    let content=''
    for(const value of [row?.content,row?.text,row?.message,row?.StrContent,row?.strContent,row?.['内容'],row?.['消息内容'],row?.Content,row?.Message]){content=messageText(value);if(content.trim())break}
    return {speaker:name||id,speakerId:id,text:content.trim()}
  }).filter((row)=>row.speaker&&row.text&&!/^\[(?:图片|语音|视频|文件|表情|撤回消息)\]$/.test(row.text))
}

function textMessages(text) {
  const messages = []; let active = null
  const push = (speaker, body = '') => {
    const name=clean(speaker,128),match=name.match(/^(.*?)[(（<]([\d]{5,20}|wxid_[\w-]+|[^\s<>]+@[^\s<>]+)[)）>]$/)
    active={speaker:match?match[1].trim()||match[2]:name,speakerId:match?match[2]:'',text:body.trim()};messages.push(active)
  }
  const hasHeaders = /(?:^|\n)\s*\[?\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}/.test(text) || /(?:^|\n).{1,60}\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/.test(text)
  for (const line of text.split('\n')) {
    // QQ：2026-11-01 12:00:01 昵称(123456)；微信：[2026/11/01 12:00] 昵称: 内容
    const dated = line.match(/^\s*\[?(?:\d{4}[-/]\d{1,2}[-/]\d{1,2})[ T]\d{1,2}:\d{2}(?::\d{2})?\]?\s+(.+)$/)
    if (dated) {
      const entry = dated[1].match(/^(.{1,80}?)[：:]\s*(.*)$/)
      push(entry ? entry[1] : dated[1], entry ? entry[2] : '')
      const qq = active.speaker.match(/^(.*?)\((\d{5,15})\)$/)
      if (qq) { active.speaker = qq[1].trim() || qq[2]; active.speakerId = qq[2] }
      continue
    }
    const namedDate = line.match(/^(.{1,60}?)\s+(?:\d{4}[-/]\d{1,2}[-/]\d{1,2})\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/)
    if (namedDate) { push(namedDate[1]); continue }
    const simple = line.match(/^([^：:\n]{1,40})[：:]\s*(.+)$/)
    if (!hasHeaders && simple && !/^\d|^https?$/i.test(simple[1])) { push(simple[1], simple[2]); continue }
    if (active && line.trim()) active.text += (active.text ? '\n' : '') + line.trim()
  }
  return messages.filter((row) => row.text)
}


export function parseSources(sources, { kind = 'auto' } = {}) {
  if (!Array.isArray(sources) || !sources.length || sources.length > DISTILL_LIMITS.files) throw new Error('一次支持 1–32 份素材')
  let bytes = 0, chars = 0
  const units = [], participants = new Map(), sourceInfo = []
  sources.forEach((file, fileIndex) => {
    let text = plain(file?.text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
    const name = clean(file?.name || ('素材' + (fileIndex + 1)), 160)
    if (/\.html?$/i.test(name) && !file.decoded) text = stripMaterialHtml(text)
    const size = Buffer.byteLength(text); bytes += size; chars += text.length
    if (bytes > DISTILL_LIMITS.bytes || chars > DISTILL_LIMITS.chars) throw new Error('素材总量超过 200MB，请分批导入')
    if (!text || /\x00/.test(text) || (text.match(/\uFFFD/g) ?? []).length > Math.max(3, text.length * 0.01)) throw new Error('素材为空或编码不正确，请选择 UTF-8 / GB18030 / UTF-16')
    if (/\.(?:db|dat|bak|zip|docx?|pdf)$/i.test(name) || (/\.epub$/i.test(name) && !file.decoded)) throw new Error('数据库、备份或 PDF 需先导出文本；EPUB 请通过文件上传导入')
    let messages = [], structured = false
    if (kind !== 'novel' && (/\.jsonl?$/i.test(name) || /^[\[{]/.test(text))) {
      let data
      try { data = /\.jsonl$/i.test(name) ? text.split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s)) : JSON.parse(text) }
      catch { if (/\.jsonl?$/i.test(name)) throw new Error(name + ' 不是合法 JSON / JSONL') }
      if (data) { messages = structuredMessages(data); structured = true } else messages = textMessages(text)
    } else if (kind !== 'novel' && /\.csv$/i.test(name)) { messages = structuredMessages(csvRows(text)); structured = true }
    else if (kind !== 'novel') {
      const probe = text.length > 256000 && kind === 'auto' ? text.slice(0,128000) : text
      const candidate = textMessages(probe)
      const likely = kind === 'chat' || /(?:^|\n)\s*\[?\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}/.test(probe) || /(?:^|\n).{1,60}\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/.test(probe) || (candidate.length>=2&&candidate.length>=probe.split('\n').filter((s)=>s.trim()).length*0.6&&candidate.every((m)=>m.speaker.length<=24&&!/[，。！？“”「」]|(?:说道?|问道?|答道?|喊道?|said|asked|replied)$/i.test(m.speaker)))
      messages = likely ? (probe === text ? candidate : textMessages(text)) : []
    }
    // 普通小说中的“他说：”不能仅因为冒号超过两处，就自动变成聊天记录。
    const dated = /(?:^|\n)\s*\[?\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}/.test(text) || /(?:^|\n).{1,60}\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/.test(text)
    const simpleChat = messages.length >= 2 && messages.length >= text.split('\n').filter((s) => s.trim()).length * 0.6 && messages.every((m) => m.speaker.length <= 24 && !/[，。！？“”「」]|(?:说道?|问道?|答道?|喊道?|said|asked|replied)$/i.test(m.speaker))
    const chat = kind === 'chat' || (kind !== 'novel' && (structured || dated || simpleChat))
    if (chat && !messages.length) throw new Error(name + ' 未识别到消息发送者，请选择正确类型或使用“昵称：内容”格式')
    const sourceKey = 's' + (fileIndex + 1)
    sourceInfo.push({ name, kind: chat ? 'chat' : 'novel', chars: text.length, bytes: size, messages: chat ? messages.length : 0, chapters: chat ? 0 : (text.match(/(?:^|\n)\s*(?:第[\d零一二三四五六七八九十百千万]+[章节卷部]|Chapter\s+\d+)/gi) ?? []).length })
    if (chat) messages.forEach((row, i) => {
      const id = row.speakerId ? 'account:' + row.speakerId : 'speaker:' + sourceKey + ':' + row.speaker
      const person = participants.get(id) ?? { id, account: row.speakerId || '', name: row.speaker, aliases: [], count: 0, samples: [], sources: [] }
      person.count++
      if (!person.aliases.includes(row.speaker)) person.aliases.push(row.speaker)
      if (!person.sources.includes(name)) person.sources.push(name)
      if (person.samples.length < 3) person.samples.push(clean(row.text, 160))
      person.name = row.speaker
      participants.set(id, person)
      units.push({ id: sourceKey + 'm' + (i + 1), source: name, sourceKey, kind: 'chat', ...row, participantId: id })
    })
    else {
      // 尽量在段落/句末拆分，保留整部作品，并给每段固定编号以便重试及证据核对。
      let start = 0, i = 1
      while (start < text.length) {
        let end = Math.min(text.length, start + 5000)
        if (end < text.length) {
          const window = text.slice(start, end)
          const boundary = start + Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？'))
          if (boundary > start + 3000) end = boundary + 1
        }
        units.push({ id: sourceKey + 'p' + i++, source: name, sourceKey, kind: 'novel', text: text.slice(start, end), speaker: '', speakerId: '' })
        start = end
      }
    }
  })
  if (units.length > 1000000) throw new Error('消息条数超过 100 万，请分批导入')
  const people = [...participants.values()].sort((a, b) => b.count - a.count)
  return { units, participants: people, sources: sourceInfo, chars, bytes }
}

export function findNovelCharacters(parsed) {
  const counts = new Map()
  for (const unit of parsed.units) {
    if (unit.kind !== 'novel') continue
    const patterns = [/(?:^|[。！？\n“”「」\s])([\p{Script=Han}]{2,4})(?:轻声|笑着|低声|忽然|缓缓)?(?:说[道着]?|问道?|答道?|喊道?|笑道|叹道|摇头|点头)[：:，。“「]/gu, /\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(?:said|asked|replied|whispered)\b/g]
    for (const pattern of patterns) for (const match of unit.text.matchAll(pattern)) {
      const name = match[1]
      if (/^(?:一个|那个|这个|他们|我们|有人|少年|少女|男人|女人)/.test(name)) continue
      const row = counts.get(name) ?? { name, count: 0, sample: clean(unit.text.slice(Math.max(0, match.index), match.index + 140), 140) }
      row.count++; counts.set(name, row)
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 100)
}

function resolveTarget(parsed, target) {
  const who = clean(target, 256)
  if (!who) throw new Error('请选择聊天发送者，或填写小说角色名')
  const exact = parsed.participants.find((p) => p.id === who || (p.account && p.account === who))
  if (exact) return { who: exact.name, person: exact }
  const matches = parsed.participants.filter((p) => p.name === who || p.aliases.includes(who))
  if (matches.length > 1) throw new Error('这个昵称对应多个发送者，请从列表选择带账号的具体人物')
  return { who, person: matches[0] ?? null }
}

export function prepareDistillation(parsed, options = {}) {
  const { who, person } = resolveTarget(parsed, options.target)
  const aliases = [...new Set([who, ...(Array.isArray(options.aliases) ? options.aliases : String(options.aliases ?? '').split(/[,，\n]/))].map((s) => clean(s, 80)).filter(Boolean))].slice(0, 16)
  const isChatTarget = (u) => u?.kind === 'chat' && person && u.participantId === person.id
  const novelHits = new Set()
  parsed.units.forEach((u, i) => { if (u.kind === 'novel' && aliases.some((name) => u.text.includes(name))) { novelHits.add(i); if (parsed.units[i - 1]?.sourceKey === u.sourceKey) novelHits.add(i - 1); if (parsed.units[i + 1]?.sourceKey === u.sourceKey) novelHits.add(i + 1) } })
  const selected = parsed.units.map((u, i, all) => {
    if (u.kind === 'novel') return novelHits.has(i) ? { ...u, isTarget: true } : null
    const target = isChatTarget(u)
    const near = [all[i - 1], all[i + 1]].some((v) => v?.sourceKey === u.sourceKey && isChatTarget(v))
    return target || near ? { ...u, isTarget: Boolean(target) } : null
  }).filter(Boolean)
  const selectedMessages = selected.filter((u) => u.kind === 'chat' && u.isTarget).length
  if (parsed.sources.some((s) => s.kind === 'chat') && !person) throw new Error('聊天记录中没有唯一匹配的发送者，请从人物列表选择')
  if (!selected.length) throw new Error('素材中没有找到这个人物，请检查角色名或添加文中使用的别名')
  const fragments = []
  for (const u of selected) for (let start = 0, part = 1; start < u.text.length; start += 5000, part++) fragments.push({ ...u, id: u.id + '_' + part, text: u.text.slice(start, start + 5000) })
  const relevantChars = fragments.reduce((n, u) => n + u.text.length, 0)
  const mode = options.mode === 'full' ? 'full' : 'sample'
  const sampleChars = Math.max(50000, Math.min(2000000, Number(options.analysisChars) || 600000))
  let chosen = fragments
  if (mode === 'sample' && relevantChars > sampleChars) {
    // 每份材料都参与；每份的首、中、尾均有覆盖，不把预算全用在第一本书。
    const groups = new Map()
    fragments.forEach((u) => { if (!groups.has(u.sourceKey)) groups.set(u.sourceKey, []); groups.get(u.sourceKey).push(u) })
    chosen = []
    for (const rows of groups.values()) {
      const total = rows.reduce((n, u) => n + u.text.length, 0)
      const budget = Math.max(1, Math.floor(sampleChars * total / relevantChars))
      const count = Math.min(rows.length, Math.max(1, Math.floor(rows.length * budget / total)))
      const allowance = Math.max(1, Math.floor(budget / count))
      for (let i = 0; i < count; i++) {
        const index = count === 1 ? Math.floor(rows.length / 2) : Math.round(i * (rows.length - 1) / (count - 1))
        const row = rows[index]
        // 为每个采样点预留预算，避免长片段提前吃光预算而丢失最后的采样点。
        const text = i === count - 1 && count > 1 ? row.text.slice(-allowance) : row.text.slice(0, allowance)
        chosen.push({ ...row, text })
      }
    }
  }
  const chunkChars = Math.max(6000, Math.min(48000, Number(options.chunkChars) || DISTILL_LIMITS.chunk))
  const chunks = []; let current = [], length = 0
  for (const u of chosen) {
    const size = u.text.length + 180
    if (current.length && length + size > chunkChars) { chunks.push(current); current = []; length = 0 }
    current.push(u); length += size
  }
  if (current.length) chunks.push(current)
  const analyzedChars = chosen.reduce((n, u) => n + u.text.length, 0)
  const seed = normalizeSeed({ ...(options.seed ?? {}), name: clean(options.seed?.name, 12) || who.slice(0, 12), gender: options.seed?.gender || 'unknown' })
  return { target: who, targetId: person?.id ?? null, aliases, seed, chunks, selectedMessages, relevantChars, analyzedChars, totalChars: parsed.chars, mode, chunkChars, sampled: analyzedChars < relevantChars, sample: chosen.filter((u) => u.isTarget).slice(0, 3).map((u) => ({ source: u.source, speaker: u.speaker, text: u.text.slice(0, 240) })) }
}

export function publicPlan(parsed, options) {
  const { chunks, ...plan } = prepareDistillation(parsed, options)
  return { ...plan, chunks: chunks.length, estimatedCalls: chunks.length + Math.ceil(chunks.length / 12) + 2 }
}
