import { traitBonus, bestTraitToComplete, traitsOf } from '../core/traits.js'
const out = []
const check = (n, ok, d = '') => out.push([n, ok, d])
check('认识英雄的羁绊', traitsOf('艾希').includes('射手'), traitsOf('艾希').join('/'))
check('差一个就升级时加分高', traitBonus('艾希', [{ name: '射手', count: 2 }]) > traitBonus('艾希', [{ name: '射手', count: 0 }]))
check('不相干羁绊不加分', traitBonus('艾希', [{ name: '坦克', count: 3 }]) < 1)
check('最该补的羁绊', bestTraitToComplete([{ name: '射手', count: 2 }, { name: '坦克', count: 1 }]) === '射手')
for (const [n, ok, d] of out) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  —  ${d}`)
const failed = out.filter((x) => !x[1]).length
console.log(`\n${out.length - failed}/${out.length} 通过`)
process.exit(failed ? 1 : 0)
