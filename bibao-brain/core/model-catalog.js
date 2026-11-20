/** Read saved DSH models without requiring provider settings discovery. */
const asArray = (value) => Array.isArray(value) ? value : []

function modelRows(rows) {
  const seen = new Set()
  return asArray(rows).flatMap((row) => {
    const value = typeof row === 'string' ? row : row?.id
    const id = typeof value === 'string' ? value.trim() : ''
    if (!id || seen.has(id)) return []
    seen.add(id)
    return [{ id, name: typeof row?.name === 'string' && row.name ? row.name : id }]
  }).slice(0, 200)
}

/** Read the configured model IDs at the exact provider path reported by DSH. */
function savedModels(settings, entry) {
  if (!entry.settingsNs || typeof settings?.describe !== 'function') return []
  const sections = asArray(settings.describe({ redactSecrets: true }))
  let profile = sections.find((section) => section?.ns === entry.settingsNs)?.value
  for (const key of entry.settingsPath) profile = profile?.[key]
  return modelRows(profile?.models)
}

/** Registered adapters own the available models, including ZCode's model switches. */
export async function readDshModelCatalog(dsh, { provider = '', settings } = {}) {
  if (!dsh || typeof dsh.listProviders !== 'function') {
    return { providers: [], models: [], note: '当前 DSH 未提供模型目录' }
  }
  const registered = asArray(await dsh.listProviders())
  const directory = typeof dsh.listConfigurableProviders === 'function'
    ? asArray(await dsh.listConfigurableProviders()) : []
  const active = new Set(registered.map((row) => row?.id).filter(Boolean))
  const declared = new Set()
  const providers = []
  for (const entry of directory) {
    if (typeof entry?.provider !== 'string' || !entry.provider || declared.has(entry.provider)) continue
    declared.add(entry.provider)
    providers.push({
      provider: entry.provider,
      displayName: entry.displayName || entry.provider,
      settingsNs: typeof entry.settingsNs === 'string' ? entry.settingsNs : '',
      settingsPath: Array.isArray(entry.settingsPath) ? entry.settingsPath.map(String) : [],
      active: active.has(entry.provider),
    })
  }
  for (const row of registered) {
    if (typeof row?.id !== 'string' || !row.id || declared.has(row.id)) continue
    declared.add(row.id)
    providers.push({ provider: row.id, displayName: row.name || row.id, settingsNs: '', settingsPath: [], active: true })
  }
  const priority = (id) => id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2
  providers.sort((a, b) => priority(a.provider) - priority(b.provider))
  if (!provider) return { providers }
  const found = providers.find((row) => row.provider === provider)
  if (!found) return { providers, models: [], note: '目录中没有这个模型来源' }
  if (!found.active) return { providers, models: [], note: '该来源未配置完成，请先在 DSH 中启用。' }

  if (typeof dsh.listModels === 'function') {
    try {
      // 成功返回的空目录仍有含义，可能反映登录状态或模型开关。
      const models = modelRows(await dsh.listModels(provider))
      return { providers, models, note: models.length ? '' : '该来源当前没有可用模型，请检查登录状态和模型开关' }
    } catch {
      // 兼容无法读取目录的适配器，继续读取已保存的配置。
    }
  }

  try {
    const models = savedModels(settings, found)
    if (models.length) return { providers, models, note: '适配器目录暂不可用，此处显示 DSH 中已保存的模型。' }
  } catch {
    // 设置服务可能尚未就绪。只展示诊断提示，避免把配置异常回传给浏览器。
  }
  return { providers, models: [], manual: true, note: '无法读取该来源的模型目录，可填写已在 DSH 中配置的模型 ID。' }
}
