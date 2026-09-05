import { existsSync } from 'node:fs'
import { ASSET_LIST } from '../src/data/assetManifest'

const missing = ASSET_LIST.filter(a => !existsSync(`public/art/${a.file}`))
const byCat = new Map<string, number>()
for (const m of missing) byCat.set(m.category, (byCat.get(m.category) ?? 0) + 1)
console.log(`${ASSET_LIST.length - missing.length}/${ASSET_LIST.length} assets present`)
for (const [cat, n] of byCat) console.log(`  missing ${cat}: ${n}`)
if (process.argv.includes('--list')) for (const m of missing) console.log(m.id)
