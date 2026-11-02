/**
 * 一键备份到 GitHub（不需要本地 git，走 Git Data API）。
 *
 *   set GH_TOKEN=ghp_xxx
 *   node scripts/push-github.mjs [owner/repo]
 *
 * 默认推到 huajikano/bibao；每次运行把当前目录打成**一个** commit。
 * token 只从环境变量读，不落盘、不写进 remote。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = process.argv[2] || 'huajikano/bibao'
const [OWNER, REPO] = TARGET.split('/')
const TOKEN = process.env.GH_TOKEN || ''
if (!TOKEN) throw new Error('缺少 GH_TOKEN 环境变量')
if (!OWNER || !REPO) throw new Error('目标应形如 owner/repo')

const API = 'https://api.github.com'
const headers = {
  authorization: `token ${TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'bibao-backup',
  'content-type': 'application/json',
}

async function call(method, url, body) {
  const res = await fetch(`${API}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const error = new Error(`${method} ${url} → ${res.status} ${data?.message ?? ''}`)
    error.status = res.status
    throw error
  }
  return data
}

const SKIP = new Set(['.git', 'node_modules', '.dsh', 'state'])
async function walk(dir, prefix = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    if (/\.(log|tmp|bak)$/.test(entry.name) || entry.name === '.DS_Store') continue
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await walk(full, rel)))
    else if ((await stat(full)).isFile()) out.push({ full, rel })
  }
  return out
}

const user = await call('GET', '/user')
await call('PATCH', `/repos/${OWNER}/${REPO}`, { default_branch: 'main' }).catch(() => {})

let parentSha = null
try {
  const ref = await call('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/main`)
  parentSha = ref.object.sha
} catch (error) {
  if (error.status !== 404 && error.status !== 409) throw error
  const seeded = await call('PUT', `/repos/${OWNER}/${REPO}/contents/README.md`, {
    message: 'init',
    content: Buffer.from('# bibao').toString('base64'),
    branch: 'main',
  })
  parentSha = seeded.commit.sha
}

const files = await walk(ROOT)
const tree = []
for (const file of files) {
  const blob = await call('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: (await readFile(file.full)).toString('base64'),
    encoding: 'base64',
  })
  tree.push({ path: file.rel, mode: '100644', type: 'blob', sha: blob.sha })
}
const created = await call('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree })
const message = process.env.GH_MESSAGE || `backup ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
const commit = await call('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message,
  tree: created.sha,
  parents: parentSha ? [parentSha] : [],
  author: { name: user.login, email: `${user.login}@users.noreply.github.com` },
})
await call('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/main`, { sha: commit.sha, force: true })
console.log(`pushed ${files.length} files → https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`)
