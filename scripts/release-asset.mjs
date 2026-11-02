/**
 * 发布：建 tag + Release，并把预构建 tarball 挂上去（资产名不带版本号，
 * 这样 latest/download/bibao.tgz 不会在下次发版后 404）。
 * 用法：GH_TOKEN=... node scripts/release-asset.mjs [version]
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const TOKEN = process.env.GH_TOKEN
if (!TOKEN) throw new Error('缺少 GH_TOKEN')
const [OWNER, REPO] = (process.argv[3] || 'huajikano/bibao').split('/')
const pkg = JSON.parse(await readFile(new URL('../bibao-brain/package.json', import.meta.url), 'utf8'))
const VERSION = process.argv[2] || pkg.version
const tag = `v${VERSION}`
const tarball = path.resolve('bibao.tgz')

const api = (pathname, options = {}) =>
  fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      authorization: `token ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'bibao-release',
      ...(options.headers ?? {}),
    },
  })

const body = `## ${VERSION}

### 0.8 这一版的重点
- **对话线程**：没答的问题、答应过的事、还热的话题会留一条线；2 天后自动放下，不变成查岗
- **主动分享**：默认关闭。只在"真实好友 + 沉默 6 小时 + 今天有生活事件 + 心情允许"时最多一天一条私聊
- **QQ 修复**：表情包导入补上 \`shrinkImage\`，收藏夹可改描述；被戳后真正回一句（20 秒冷却，任意群生效）；WS 配置重启不丢
- **反向 WS**：插件监听 \`ws://127.0.0.1:8080/ws\`，snowluma 的 \`wsClients\` 主动连进来；事件和动作走同一条连接，不再依赖 3000/3001 是否开着
- **戳一戳**：被戳后二选一——回戳一下，或发一张表情包；不再发文字。表情包按当下情绪/上下文匹配，不匹配就戳回去，20 秒/对象冷却
- **好友面板**：不需要手动加好友，互动 ≥ 10 条自动进入；由她自己记（\`friendSource='self'\`），昵称旁显示小号 QQ
- **隐私**：补丁/测试不再包含本机 snowluma 路径、QQ 号或群号；\`snowluma.configDir\` 留空自动探测，真实配置只留在本机
- **任意安装位置**：snowluma 目录支持环境变量、面板字段、常见相邻目录与盘符浅扫；不再要求 \`D:\\XiangMu\\snowluma\\config\`
- **盲评**：20 个 QQ 场景 + 五维评分表，见 \`docs/EVAL.md\`

### 成长层（0.7）
- **人格一致**：系统提示词从当前 \`biography.json\` 生成；换成 16 岁高中生后，不再说"我毕业了"，也不再带旧版 22 岁毒舌人设
- **自我复盘**：每轮记录"对方接住了/变冷了/没回"，睡眠或每 6 小时压成 1-2 条经验，微调暖意、玩心、直率、话量、示弱、主动六个维度；单次 ±0.06、经验上限 10 条
- **她的一天**：按年龄/关系/爱好生成早读、食堂、放学、作业、游戏、被催睡等生活事件；进提示词、睡前压成日记与情景记忆
- **模糊记忆**：新增清晰度 \`fidelity/blur\`；旧事只交梗概并明确"记不清"，不编细节
- **多脑机接口**：\`core/bci-hub.js\` 统一适配器、能力声明、只读/动作策略、确认、限频、审计；已接 TFT/视觉/生理只读通道

### 认知内核
- 四定律：自由能/主动推理、全局工作空间、互补学习系统、艾宾浩斯 + 再巩固
- 6 大沙盒验收：情绪惯性、抗洗脑、24h 感官剥夺、记忆罗生门、打断忘词、社会面具

### 记忆
- SQLite 持久层（node:sqlite）：情景热层 + 软删除归档 + 语义事实层
- 夜间把当天情景压成带出处的事实；低置信 7 天过期；同一件事新说法推翻旧说法
- 词法向量（256 维哈希）混合检索：R × 显著性 × 余弦 × 情绪一致
- 倒摄干扰、舌尖现象、复述续期、模糊召回

### 交互
- snowluma OneBot：HTTP 发送 + WS 收事件，三层注意力漏斗（焦点/余光/免打扰）
- 私聊与 @ 直接绕过显著性阈值；修复 \`maybeSticker is not defined\` 导致的发送链路中断
- 表情包导入、戳一戳回复、WS 配置持久化与 token 查询串、连接状态日志
- 六个认知模块各一个模型槽；行为滑杆：记忆力、说话频率
- 时间校准：脑内时间与系统时间平移对齐，记忆年龄不变

### 安装
\`\`\`sh
dsh plugin add huajikano/bibao
\`\`\`
或使用本页附件 \`bibao.tgz\`（预构建，免构建授权）。

完整说明见仓库 README；路线图见 \`docs/ROADMAP.md\`，多接口说明见 \`docs/BCI.md\`。`

let res = await api(`/repos/${OWNER}/${REPO}/releases`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    tag_name: tag,
    target_commitish: 'main',
    name: `比宝 ${VERSION}`,
    body,
    draft: false,
    prerelease: false,
  }),
})
if (res.status === 422) {
  console.log('release already exists:', tag)
  res = await api(`/repos/${OWNER}/${REPO}/releases/tags/${tag}`)
}
if (!res.ok) throw new Error(`release failed ${res.status}: ${(await res.text()).slice(0, 300)}`)
const release = await res.json()
console.log(`release ${release.tag_name} → ${release.html_url}`)

try {
  await stat(tarball)
  const upload = await fetch(
    `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=bibao.tgz`,
    {
      method: 'POST',
      headers: {
        authorization: `token ${TOKEN}`,
        'content-type': 'application/gzip',
        'user-agent': 'bibao-release',
      },
      body: await readFile(tarball),
    },
  )
  if (upload.ok) {
    const asset = await upload.json()
    console.log(`asset → ${asset.browser_download_url}`)
  } else {
    console.log(`asset upload failed ${upload.status}: ${(await upload.text()).slice(0, 200)}`)
  }
} catch {
  console.log('no bibao.tgz, skipped asset upload')
}
