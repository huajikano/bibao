#!/usr/bin/env node
/** 固定白名单：允许群不能被自动退化，也不能被另一个焦点顶掉。 */
import { GroupAttentionFunnel } from '../core/group.js'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const social = {
  isCloseFriend: () => false,
  get: () => null,
}
const funnel = new GroupAttentionFunnel({ social, interests: [], userName: '比宝' })
funnel.addGroup({ id: 'g1', name: '固定一', layer: 'muted' })
funnel.addGroup({ id: 'g2', name: '固定二', layer: 'muted' })
funnel.addGroup({ id: 'g3', name: '普通群', layer: 'muted' })

funnel.setPinned(['g1', 'g2'])
check('白名单群被固定为焦点', funnel.get('g1').pinned === true && funnel.get('g1').layer === 'foveal', funnel.get('g1').layer)
check('多个白名单可以同时固定', funnel.get('g2').pinned === true && funnel.get('g2').layer === 'foveal', funnel.get('g2').layer)

funnel.focus('g3', Date.now())
check('另一个焦点不会顶掉固定群', funnel.get('g1').layer === 'foveal', funnel.get('g1').layer)

funnel.tick(Date.now() + 10 * 60_000)
check('固定群不会被 5 分钟自动退化', funnel.get('g1').layer === 'foveal', funnel.get('g1').layer)

const blocked = funnel.setLayer('g1', 'peripheral')
check('固定群不能手动降级', blocked?.pinned === true && funnel.get('g1').layer === 'foveal', JSON.stringify(blocked))

funnel.setPinned(['g2'])
check('移出白名单后才允许降级', funnel.get('g1').pinned === false && funnel.get('g1').layer === 'peripheral', funnel.get('g1').layer)

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
const failed = results.filter((item) => !item.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
