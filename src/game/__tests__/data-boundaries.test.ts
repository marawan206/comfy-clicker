import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The data layer is plain content: it may lean on the game's types and tunables, nothing else.
 * Game modules import the shipped data only through a `Catalog` argument (save.ts's default
 * `CATALOG` and map.ts's default `MAP_NODES` are the documented exceptions), so this is what keeps
 * src/data → src/game from ever turning into a cycle.
 */
const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url))
const GAME_DIR = fileURLToPath(new URL('../', import.meta.url))
const ALLOWED = new Set(['@/game/types', '@/game/constants'])
const IMPORT_RE = /from\s+['"](@\/game\/[^'"]+)['"]/g

const tsFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.join(dir, f))

describe('module boundaries', () => {
  it('src/data imports nothing from src/game beyond types and constants', () => {
    const offenders: string[] = []
    for (const file of tsFiles(DATA_DIR)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(IMPORT_RE)) {
        if (!ALLOWED.has(m[1] as string)) offenders.push(`${path.basename(file)} → ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('src/game reaches shipped data only where the contract documents a default catalog', () => {
    const allowed: Record<string, string[]> = {
      'save.ts': ['@/data'],
      'map.ts': ['@/data/mapNodes'],
    }
    const offenders: string[] = []
    for (const file of tsFiles(GAME_DIR)) {
      const name = path.basename(file)
      const src = readFileSync(file, 'utf8')
      // `import type` is erased at runtime and never a cycle.
      const runtime = src.replace(/(?:import|export)\s+type\s[^;]+;?/g, '')
      for (const m of runtime.matchAll(/from\s+['"](@\/data(?:\/[^'"]+)?)['"]/g)) {
        if (!(allowed[name] ?? []).includes(m[1] as string)) offenders.push(`${name} → ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
