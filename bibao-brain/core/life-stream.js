/**
 * 生活流：她自己的今天。
 *
 * 一个只会对消息做反应的大脑，再像人也像值班客服。人是有白天的：
 * 早读迟到、食堂排队、放学绕路、作业写到一半去玩游戏、妈妈敲门让睡觉。
 * 这些事不替代聊天，只给她一个"我正在过自己的日子"的背景。
 *
 * 设计约束：
 *  - 确定性：同一天同一个 seed 生成同一批事件，方便回放与测试；
 *  - 不打扰：事件不主动发 QQ，只进入提示词、记忆和睡前日记；
 *  - 不编用户：只写她自己的经历，不虚构"你昨天说过什么"。
 */

import { DAY_MS, HOUR_MS, MIN_MS } from './constants.js'
import { createRng, hashString, uid } from './rng.js'
import { clockLabel, dayKey, localParts, TZ_OFFSET_MS } from './clock.js'

const FAMILY = new Set(['妈妈', '爸爸', '母亲', '父亲', '奶奶', '爷爷', '外婆', '外公', '家人'])

function textOf(value, max = 80) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function chooseCast(biography = {}, relations = []) {
  const names = relations.map((row) => String(row?.name ?? '')).filter(Boolean)
  // "你"是正在聊天的人，不是她生活流里的 NPC：不替用户编共同经历
  const friend =
    names.find(
      (name) =>
        name !== biography.name &&
        !FAMILY.has(name) &&
        !/老师|班主任/.test(name) &&
        !['你', '我', 'owner', '用户'].includes(name),
    ) ??
    (Number(biography.ageNow ?? 22) <= 18 ? '小岚' : '阿柚')
  const teacher = names.find((name) => /老师|班主任/.test(name)) ?? (Number(biography.ageNow ?? 22) <= 18 ? '林老师' : '组长')
  const family = names.find((name) => FAMILY.has(name)) ?? '妈妈'
  return { friend, teacher, family }
}

const STUDENT = [
  {
    key: 'morning',
    minutes: 7 * 60 + 10,
    valence: -0.08,
    arousal: 0.45,
    tags: ['学校', '早上'],
    texts: [
      '早读差点迟到，在校门口被值周生拦了一下，跑上楼的时候心跳得厉害',
      '早饭没吃完就出门，第二节课肚子一直在叫',
      '今天没赶上班车，走了两站路才到学校，鞋里进了点沙子',
    ],
  },
  {
    key: 'class',
    minutes: 9 * 60 + 40,
    valence: -0.18,
    arousal: 0.5,
    tags: ['学校', '上课'],
    texts: [
      '{teacher}点人上黑板写题，我写到一半卡住了，站在上面像被晾着',
      '数学小测最后一道题没做完，收卷的时候手都是凉的',
      '同桌上课传纸条问我周末去不去漫展，我憋着笑没敢回',
    ],
  },
  {
    key: 'noon',
    minutes: 12 * 60 + 20,
    valence: 0.25,
    arousal: 0.45,
    tags: ['学校', '吃饭'],
    texts: [
      '食堂排了十分钟，端回来发现想吃的那个窗口已经卖完了',
      '和小岚在走廊分了一袋薯片，被班主任看见，赶紧塞进校服口袋',
      '中午趴在桌上睡了十分钟，醒来脸上印着袖口的褶子',
    ],
  },
  {
    key: 'afternoon',
    minutes: 15 * 60 + 10,
    valence: 0.1,
    arousal: 0.4,
    tags: ['学校', '下午'],
    texts: [
      '体育课自由活动，我坐在看台上看别人打球，风把头发吹得乱七八糟',
      '下午的自习课特别长，窗外有只猫蹲在围墙上，我看了它很久',
      '美术课画了一半被叫去搬作业，回来发现颜料干在调色盘上了',
    ],
  },
  {
    key: 'leave',
    minutes: 17 * 60 + 40,
    valence: 0.2,
    arousal: 0.5,
    tags: ['放学', '朋友'],
    texts: [
      '放学和小岚绕去文具店，她买了三支一模一样的笔，说怕丢',
      '出校门的时候下雨了，我和{friend}挤一把伞，袖子还是湿了半截',
      '今天放学路上买了杯奶茶，三分糖，喝到最后还是觉得甜',
    ],
  },
  {
    key: 'homework',
    minutes: 19 * 60 + 30,
    valence: -0.12,
    arousal: 0.4,
    tags: ['作业', '晚上'],
    texts: [
      '作业写到一半，笔没水了，翻遍书包只找到一支快断的铅笔',
      '本来想写半小时就休息，结果一道题卡了四十分钟',
      '写着写着走神，在草稿纸边上画了一只很丑的猫',
    ],
  },
  {
    key: 'game',
    minutes: 21 * 60 + 40,
    valence: 0.35,
    arousal: 0.55,
    tags: ['游戏', '放松'],
    texts: [
      '写完一页作业就奖励自己上{interest}转了一圈，差点舍不得下线',
      '本来只打算玩十分钟，回过神来已经过了一个小时',
      '在{interest}里碰到一个说话很好笑的人，笑完又觉得有点空',
    ],
  },
  {
    key: 'night',
    minutes: 23 * 60 + 5,
    valence: -0.05,
    arousal: 0.35,
    tags: ['深夜', '家'],
    texts: [
      '{family}敲门让我早点睡，我应了一声，继续躺着刷手机',
      '关灯之后反而清醒了，脑子里开始自动播放今天说错的每一句话',
      '躺在床上想明天要不要早起，想了半天也没定闹钟',
    ],
  },
]

const YOUNG = [
  {
    key: 'commute',
    minutes: 8 * 60 + 10,
    valence: -0.1,
    arousal: 0.45,
    tags: ['通勤', '早上'],
    texts: [
      '地铁上被人踩了一脚，对方没回头，我也没出声',
      '早上差点没赶上公交，跑到站台的时候车刚关门',
      '买早饭排了很长的队，最后只拿了一个包子',
    ],
  },
  {
    key: 'work',
    minutes: 11 * 60 + 40,
    valence: -0.15,
    arousal: 0.45,
    tags: ['工作', '白天'],
    texts: [
      '上午的会开了很久，最后也没定下来到底听谁的',
      '改了三版的东西又被退回来说"再看看"，我把那句话读了两遍',
      '午休刷到一条很好笑的视频，笑完发现同事在看我',
    ],
  },
  {
    key: 'afternoon',
    minutes: 15 * 60 + 30,
    valence: 0.05,
    arousal: 0.4,
    tags: ['工作', '下午'],
    texts: [
      '下午困得不行，去茶水间站了一会儿才缓过来',
      '楼下的猫又蹲在电动车座上，我蹲下来看了它很久',
      '同事分了半块蛋糕，我嘴上说不要，最后还是吃了',
    ],
  },
  {
    key: 'leave',
    minutes: 18 * 60 + 20,
    valence: 0.2,
    arousal: 0.45,
    tags: ['下班', '傍晚'],
    texts: [
      '下班路上天已经暗了，路边的店在放一首很旧的歌',
      '今天没加班，回家路上慢慢走了一段，风有点凉',
      '在便利店买了一杯热的东西，捧在手里走回家',
    ],
  },
  {
    key: 'night',
    minutes: 22 * 60 + 30,
    valence: 0.1,
    arousal: 0.4,
    tags: ['晚上', '独处'],
    texts: [
      '洗完澡躺在床上刷手机，说明天一定早睡，然后刷到了现在',
      '本来想收拾房间，最后只把桌上的杯子挪了个位置',
      '在{interest}里逛了一圈，什么也没干，但心情好了一点',
    ],
  },
]

const ADULT = [
  {
    key: 'morning',
    minutes: 7 * 60 + 30,
    valence: 0,
    arousal: 0.4,
    tags: ['早上', '家'],
    texts: ['早上煮了面，吃完才发现盐放多了', '出门前又折回去拿伞，结果一天都没下雨'],
  },
  {
    key: 'noon',
    minutes: 12 * 60 + 15,
    valence: 0.1,
    arousal: 0.4,
    tags: ['中午', '吃饭'],
    texts: ['中午随便吃了点，吃完在楼下走了两圈', '今天食堂的菜比平时咸，我喝了两杯水'],
  },
  {
    key: 'evening',
    minutes: 18 * 60 + 40,
    valence: 0.12,
    arousal: 0.4,
    tags: ['傍晚', '下班'],
    texts: ['回家路上看到晚霞，想拍下来，掏手机的时候已经暗了', '今天下班比平时早，反而不知道要干什么'],
  },
  {
    key: 'night',
    minutes: 22 * 60,
    valence: -0.05,
    arousal: 0.35,
    tags: ['晚上', '独处'],
    texts: ['晚上把昨天剩的菜热了，边吃边看了一集旧剧', '本来想早点睡，躺下之后又开始想白天的事'],
  },
]

function templatesFor(biography = {}) {
  const age = Number(biography.ageNow ?? 22)
  if (age <= 18) return STUDENT
  if (age <= 30) return YOUNG
  return ADULT
}

function fill(text, cast, interest) {
  return String(text)
    .replaceAll('{friend}', cast.friend)
    .replaceAll('{teacher}', cast.teacher)
    .replaceAll('{family}', cast.family)
    .replaceAll('{interest}', interest)
}

/** 从传记里找她真正会玩的那个东西，别把"喜欢猫"写成"在猫里逛了一圈"。 */
function gameInterest(biography = {}, interests = []) {
  const text = [
    biography.oneLine,
    biography.copingStyle,
    ...(Array.isArray(biography.voice?.likes) ? biography.voice.likes : []),
    ...(Array.isArray(biography.likes) ? biography.likes : []),
    ...(Array.isArray(interests) ? interests : []),
  ]
    .filter(Boolean)
    .join(' ')
  const known = ['光遇', '恋与深空', '原神', '蛋仔派对', '王者荣耀', '和平精英', '明日方舟', '第五人格', '番剧']
  return known.find((name) => text.includes(name)) ?? '游戏'
}

export function lifeTemplatesFor(biography = {}) {
  return templatesFor(biography)
}

export class LifeStream {
  constructor({ seed = 20261101, state = {} } = {}) {
    this.seed = Number(seed) || 20261101
    this.dayKey = String(state.dayKey ?? '')
    this.events = Array.isArray(state.events) ? state.events.slice(-24) : []
    this.generated = Array.isArray(state.generated) ? state.generated.slice(-24) : []
    this.diary = Array.isArray(state.diary) ? state.diary.slice(-14) : []
  }

  /** 每天首次调用时重置；按当前时间补齐已经过去的时间槽。 */
  ensureDay({ now = Date.now(), biography = {}, relations = [], interests = [] } = {}) {
    const key = dayKey(now)
    if (key !== this.dayKey) {
      // 不立刻清空事件：凌晨 3 点还要归纳"昨天"。
      // 只重置生成槽，旧事件按 2 天窗口自然过期。
      this.dayKey = key
      this.generated = []
    }
    const parts = localParts(now)
    const minutesNow = parts.hour * 60 + parts.minute
    const templates = templatesFor(biography)
    const cast = chooseCast(biography, relations)
    const interest = gameInterest(biography, interests)
    const rng = createRng(hashString(`${this.seed}:${key}`))
    const dayStart = Math.floor((now + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS

    for (const template of templates) {
      if (template.minutes > minutesNow) continue
      if (this.generated.includes(template.key)) continue
      const text = fill(rng.pick(template.texts), cast, interest)
      const jitter = Math.floor(rng.next() * 7 * MIN_MS)
      const at = Math.min(now, dayStart + template.minutes * MIN_MS + jitter)
      this.events.push({
        id: uid('life', rng),
        at,
        slot: template.key,
        text: textOf(text, 90),
        valence: Number(template.valence ?? 0),
        arousal: Number(template.arousal ?? 0.4),
        tags: template.tags ?? [],
        written: false,
      })
      this.generated.push(template.key)
    }
    this.events = this.events.filter((item) => now - item.at < 2 * DAY_MS).sort((a, b) => a.at - b.at)
    this.generated = this.generated.slice(-24)
    return this.events
  }

  today(now = Date.now()) {
    const key = dayKey(now)
    return this.events.filter((item) => dayKey(item.at) === key && item.at <= now)
  }

  /** 最近四小时内发生的事，作为"刚才你在干嘛"。 */
  current(now = Date.now()) {
    const rows = this.today(now).filter((item) => now - item.at <= 4 * HOUR_MS)
    return rows.length ? rows[rows.length - 1] : null
  }

  /** 给提示词的 2-3 行，只给事实，不加评价。 */
  promptLines(now = Date.now(), limit = 3) {
    return this.today(now)
      .slice(-limit)
      .map((item) => ({ label: clockLabel(item.at), text: item.text, valence: item.valence }))
  }

  moodHint(now = Date.now()) {
    const rows = this.today(now)
    if (!rows.length) return ''
    const mean = rows.reduce((sum, item) => sum + Number(item.valence ?? 0), 0) / rows.length
    if (mean > 0.18) return '今天整体还算顺，没那么容易被点着'
    if (mean < -0.12) return '今天有点累，耐性比平时薄'
    return ''
  }

  /** 睡前把今天的事件压进记忆，并写一行日记。凌晨 3 点睡的是"昨天"。 */
  consolidate({ now = Date.now(), memory = null, age = 22 } = {}) {
    const todayRows = this.today(now)
    // 凌晨三点触发睡眠时，今天还没发生任何事：要归纳的是最近一个有事件的那天
    const targetKey = todayRows.length ? dayKey(now) : dayKey(this.events.at(-1)?.at ?? now)
    const rows = this.events.filter((item) => dayKey(item.at) === targetKey)
    if (!rows.length) return null
    const fresh = rows.filter((item) => !item.written)
    // 只记有分量的 1-2 件，别把一天的流水账全塞进海马体
    const picks = fresh
      .slice()
      .sort((a, b) => Math.abs(b.valence) * b.arousal - Math.abs(a.valence) * a.arousal)
      .slice(0, 2)
    for (const item of picks) {
      memory?.write?.({
        now,
        age,
        arousal: item.arousal,
        pe: 0.12,
        valence: item.valence,
        salience: 0.28,
        title: `今天：${item.text.slice(0, 12)}`,
        narrative: `今天${clockLabel(item.at)}，${item.text}`,
        tags: ['生活', ...(item.tags ?? [])].slice(0, 5),
        entityId: null,
        entityName: null,
        source: 'life-day',
        force: true,
      })
      item.written = true
    }
    const line = `今天：${rows.map((item) => item.text).join('；')}`
    const entry = { at: now, dayKey: targetKey, text: textOf(line, 240) }
    const existing = this.diary.findIndex((item) => item.dayKey === targetKey)
    if (existing >= 0) this.diary[existing] = entry
    else this.diary.push(entry)
    this.diary = this.diary.slice(-14)
    return { picks: picks.map((item) => ({ id: item.id, text: item.text })), diary: line, dayKey: targetKey }
  }

  snapshot(now = Date.now()) {
    return {
      dayKey: this.dayKey,
      today: this.today(now).map((item) => ({
        at: item.at,
        label: clockLabel(item.at),
        text: item.text,
        valence: item.valence,
        written: Boolean(item.written),
      })),
      current: this.current(now)
        ? {
            label: clockLabel(this.current(now).at),
            text: this.current(now).text,
          }
        : null,
      diary: this.diary.slice(-7),
      moodHint: this.moodHint(now),
    }
  }

  toJSON() {
    return {
      dayKey: this.dayKey,
      events: this.events.slice(-20),
      generated: this.generated.slice(-20),
      diary: this.diary.slice(-14),
    }
  }

  static fromJSON(json = {}, seed = 20261101) {
    return new LifeStream({ seed, state: json ?? {} })
  }
}
