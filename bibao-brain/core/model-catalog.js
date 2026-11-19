/** Read saved DSH models without requiring provider settings discovery. */
const asArray = (value) => Array.isArray(value) ? value : []

function modelRows(rows) {
  const seen = new Set()
  return asArray(rows).flatMap((row) => {
    const id = typeof row?.id === 'string' ? row.id.trim() : ''
    if (!id || seen.has(id)) return []
    seen.add(id)
    return [{ id, name: typeof row?.name === 'string' && row.name ? row.name : id }]
  }).slice(0, 200)
}

/**
 * Registered adapters own their saved model catalogs. Settings discovery is
 * only a compatibility path for configurable sources without listModels.
 * In particular, ZCode does not need a settings namespace to list its models.
 */
export async function readDshModelCatalog(dsh, { provider = '', signal } = {}) {
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
  try {
    // An empty registered catalog can reflect login or model-switch state;
    // do not replace it with an unfiltered discovery response.
    if (found.active && typeof dsh.listModels === 'function') {
      const models = modelRows(await dsh.listModels(provider))
      return { providers, models, note: models.length ? '' : '该来源当前没有可用模型，请检查登录状态和模型开关' }
    }
    if (found.settingsNs && typeof dsh.discoverModels === 'function') {
      const models = modelRows(await dsh.discoverModels(found.settingsNs, { provider }, signal))
      return { providers, models, note: models.length ? '' : '该来源没有返回模型列表，请检查模型配置' }
    }
    return { providers, models: [], note: found.active
      ? '当前 DSH 未提供读取该来源已注册模型列表的接口'
      : '该来源未配置完成，暂无可用模型' }
  } catch (error) {
    return { providers, models: [], note: '读取该来源的模型列表失败：' + String(error?.message ?? error).slice(0, 120) }
  }
}
