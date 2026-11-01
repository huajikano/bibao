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

### 认知内核
- 四定律：自由能/主动推理、全局工作空间、互补学习系统、艾宾浩斯 + 再巩固
- 三个沙盒验收：情绪惯性、抗洗脑、记忆罗生门、打断忘词等 6 项

### 记忆
- SQLite 持久层（node:sqlite）：情景热层 + 软删除归档 + 语义事实层
- 夜间把当天情景压成带出处的事实；低置信 7 天过期；同一件事新说法推翻旧说法
- 词法向量（256 维哈希）混合检索：R × 显著性 × 余弦 × 情绪一致
- 倒摄干扰、舌尖现象、复述续期

### 交互
- snowluma OneBot：HTTP 发送 + WS 收事件，三层注意力漏斗（焦点/余光/免打扰）
- 六个认知模块各一个模型槽；行为滑杆：记忆力、说话频率
- 脑机接口（实验性）：视觉/听觉/嗅觉/本体感觉/数字视觉/内感受
- 时间校准：脑内时间与系统时间平移对齐，记忆年龄不变

### 安装
\`\`\`sh
dsh plugin add huajikano/bibao
\`\`\`
或使用本页附件 \`bibao.tgz\`（预构建，免构建授权）。

完整说明见仓库 README。`

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
