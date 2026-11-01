/**
 * 一站式：给仓库打 dsh-plugin topic + 向 awesome-dsh-plugin 提一条收录 PR。
 * 用法：GH_TOKEN=... node scripts/submit-awesome.mjs
 */
const TOKEN = process.env.GH_TOKEN
if (!TOKEN) throw new Error('缺少 GH_TOKEN')
const OWNER = 'huajikano'
const REPO = 'bibao'
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const BRANCH = 'add-bibao'

const api = async (pathname, options = {}) => {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      authorization: `token ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'bibao-submit',
      ...(options.headers ?? {}),
    },
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { res, data }
}

// 1) topic
{
  const current = await api(`/repos/${OWNER}/${REPO}/topics`)
  const names = new Set(current.data?.names ?? [])
  names.add('dsh-plugin')
  const { res } = await api(`/repos/${OWNER}/${REPO}/topics`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ names: [...names] }),
  })
  console.log(`topics ${res.status}:`, [...names].join(', '))
}

// 2) fork
let fork = await api(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}`)
if (fork.res.status === 404) {
  const created = await api(`/repos/${UPSTREAM}/forks`, { method: 'POST', body: '{}' })
  console.log('fork requested:', created.res.status)
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    fork = await api(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}`)
    if (fork.res.ok) break
  }
}
if (!fork.res.ok) throw new Error(`fork unavailable: ${fork.res.status}`)
console.log('fork:', fork.data.full_name)

// 3) 从上游 main 建分支
const upstreamMain = await api(`/repos/${UPSTREAM}/git/ref/heads/main`)
const sha = upstreamMain.data?.object?.sha
if (!sha) throw new Error('cannot read upstream main')
await api(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}/git/refs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha }),
})

// 4) 写条目文件
const entry = `url: https://github.com/huajikano/bibao
name: huajikano/bibao
category: identity
description:
  en: 'A simulated human-brain core for chat: global workspace, emotional appraisal, dual-system memory with nightly consolidation, and an experimental sensory interface.'
  zh: 一个按计算神经科学定律运行的拟人认知内核：全局工作空间、情感评估、双系统记忆与夜间归纳，可接管 QQ 群聊。
tarball: https://github.com/huajikano/bibao/releases/latest/download/bibao.tgz
`
const filePath = `data/plugins/${OWNER}__${REPO}.yml`
const put = await api(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}/contents/${filePath}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    message: `Add ${OWNER}/${REPO}`,
    content: Buffer.from(entry, 'utf8').toString('base64'),
    branch: BRANCH,
  }),
})
console.log(`entry ${put.res.status}:`, filePath)

// 5) 开 PR
const prBody = `Adds **huajikano/bibao** — a simulated human-brain cognitive core for chat.

- \`dsh.bundle\` + \`cordis.patch.yml\` in \`bibao-brain/package.json\`
- Settings panel with seven tabs (brain / talk / memory / groups / gate / senses / settings)
- Memory: SQLite episodes + nightly fact consolidation + soft-delete archive
- QQ via snowluma OneBot (HTTP send + WS events)
- Prebuilt tarball attached to the release: \`bibao.tgz\` (version-free asset name, so \`latest/download\` will not rot)

Category: \`identity\` — the plugin's surface is a persona that talks to people over QQ, with its own memory and emotional state. Happy to move it to \`memory\` or \`fun\` if you think that fits better.

Repo is brand new; if the 1-day age gate blocks it, it should clear on its own.`

const pr = await api(`/repos/${UPSTREAM}/pulls`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    title: `Add ${OWNER}/${REPO}`,
    head: `${OWNER}:${BRANCH}`,
    base: 'main',
    body: prBody,
  }),
})
if (pr.res.ok) console.log(`PR #${pr.data.number} → ${pr.data.html_url}`)
else console.log(`PR failed ${pr.res.status}:`, JSON.stringify(pr.data).slice(0, 300))
