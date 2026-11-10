/**
 * 发布：建 tag + Release，并把预构建 tarball 挂上去（资产名不带版本号，
 * 这样 latest/download/bibao.tgz 不会在下次发版后 404）。
 *
 * 发布说明从 docs/CHANGELOG.md 取当前版本的小节，取不到再用兜底文案。
 * 用法：GH_TOKEN=... node scripts/release-asset.mjs [version] [owner/repo]
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

/** 从 CHANGELOG 里切出 `## x.y.z` 到下一个 `## ` 之间的内容。 */
async function sectionFromChangelog(version) {
  try {
    const text = await readFile(new URL('../docs/CHANGELOG.md', import.meta.url), 'utf8')
    const lines = text.split(/\r?\n/)
    const start = lines.findIndex((line) => line.trim() === `## ${version}`)
    if (start < 0) return ''
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((line) => /^##\s/.test(line))
    const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
    // 小节标题降一级，避免和 Release 里的标题打架
    return body.replace(/^### /gm, '#### ')
  } catch {
    return ''
  }
}

const body =
  (await sectionFromChangelog(VERSION)) ||
  `## ${VERSION}

安装：\`dsh plugin add huajikano/bibao\`，或下载本页附件 \`bibao.tgz\`（预构建，免构建授权）。
完整说明见仓库 README；更新记录见 \`docs/CHANGELOG.md\`。`

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

// 同名资产重复上传会 422：先删掉旧的 bibao.tgz 再传
for (const asset of release.assets ?? []) {
  if (asset.name !== 'bibao.tgz') continue
  const del = await api(`/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`, { method: 'DELETE' })
  console.log(`removed old asset ${asset.name}: ${del.status}`)
}

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
