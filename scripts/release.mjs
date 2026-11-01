/**
 * 创建 GitHub Release（tag vX.Y.Z 指向 main 当前提交）。
 * 用法：GH_TOKEN=... node scripts/release.mjs 0.0.1 [owner/repo]
 */
const TOKEN = process.env.GH_TOKEN || ''
const VERSION = process.argv[2] || '0.0.1'
const [OWNER, REPO] = (process.argv[3] || 'huajikano/bibao').split('/')
if (!TOKEN) throw new Error('缺少 GH_TOKEN')

const tag = `v${VERSION}`
const body = `## 比宝 · 拟人认知内核 0.0.1

第一个可运行版本。一个按计算神经科学四条定律驱动的「活人脑」，装在 DeepSeek Harness 里，接 snowluma 的 QQ。

### 认知内核
- 自由能 / 主动推理：PE > 0.5 或踩到核心信念时，二选一——让步，或改变外部
- 全局工作空间：5 槽（皮质醇 > 0.75 锁 2 槽），静默时阈值塌陷，走神与内耗自发点火
- 互补学习系统：海马体快写，新皮层只在凌晨 03:00 睡眠回放时慢改
- 艾宾浩斯 + 再巩固：R = exp(−Δt/S)，三态分层，心境会永久涂抹旧记忆
- 6 大认知沙盒（6/6 通过）：情绪惯性、抗洗脑、24h 感官剥夺、记忆罗生门、打断忘词、社会面具

### 界面
- 设置 → 比宝：脑内 / 对话 / 记忆 / 群聊 / 验脑 / 感官 / 设置 七个标签
- 独立控制台（回环 + token），槽位出问题时仍可用

### QQ（snowluma）
- OneBot HTTP 发送 + WS 收事件，地址与 token 可在面板里配，支持逐字段回落到 snowluma 自己的配置
- 三层注意力漏斗：焦点注视 / 余光监听 / 折叠免打扰，可在群聊页手动指定
- 3 秒防抖合并、四大唤醒锚点、跨通道私聊吐槽、冲动撤回

### 模型
- 六个认知模块各一个模型槽，只有真正调用模型的四个（情感评估 / 双系统记忆 / 语言区 / 预期悬置）会用到
- 可指向不同厂商、不同 key；key 只存本机 ~/.dsh/bibao/settings.json，接口只回显掩码

### 脑机接口（实验性）
- 六个感官通道：视觉 / 听觉 / 嗅觉 / 本体感觉 / 数字视觉 / 内感受
- 目前只有「手动投喂」是真的：一段感知会进入丘脑、抢工作空间、写记忆、改激素；自动采集器尚未接入

### 安装
1. \`plugin_manager install_bundle\` 指向 \`bibao-brain/\` 目录
2. 重启 DSH
3. 设置 → 比宝 → 模型与 Key、snowluma 地址与群白名单
`

const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
  method: 'POST',
  headers: {
    authorization: `token ${TOKEN}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'bibao-release',
  },
  body: JSON.stringify({
    tag_name: tag,
    target_commitish: 'main',
    name: `比宝 0.0.1 · 拟人认知内核`,
    body,
    draft: false,
    prerelease: false,
    generate_release_notes: false,
  }),
})
const text = await res.text()
if (!res.ok) throw new Error(`release failed ${res.status}: ${text.slice(0, 300)}`)
const data = JSON.parse(text)
console.log(`released ${data.tag_name} → ${data.html_url}`)
