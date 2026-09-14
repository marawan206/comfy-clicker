/**
 * Projector mode is an enumeration, and enumerations drift.
 *
 * `html.projector` only bumps the root font size, so anything Tailwind emits as a literal pixel
 * font-size ignores it. The block at the end of globals.css restates every arbitrary `text-[Npx]`
 * class in the codebase as `N / 16` rem: identical when the mode is off, scaling when it is on.
 * It has already fallen behind the code once. This test walks the source for those classes and
 * insists the two lists match, so the next person who writes a new arbitrary size gets a failing
 * test instead of one label that stays 11 px on the projector.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../..', import.meta.url))
const GLOBALS = fileURLToPath(new URL('../globals.css', import.meta.url))
/** This file names the sizes it is testing, so scanning it would make the test its own source. */
const SELF = 'projector.test.ts'

/** Tailwind's arbitrary font-size utility, decimals included (`text-[12.5px]` is a real one). */
const USED = /text-\[(\d+(?:\.\d+)?)px\]/g
/** The twin in globals.css: `html.projector .text-\[11px\] { font-size: 0.6875rem }`. */
const DECLARED = /html\.projector\s+\.text-\\\[([\d\\.]+)px\\\]\s*\{[^}]*?font-size:\s*([\d.]+)rem/g

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path))
    } else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && name !== SELF) {
      out.push(path)
    }
  }
  return out
}

/** Every distinct `text-[Npx]` size written anywhere in `src/`, as the number N. */
function usedSizes(): number[] {
  const sizes = new Set<number>()
  for (const file of sourceFiles(SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(USED)) sizes.add(Number(m[1]))
  }
  return [...sizes].sort((a, b) => a - b)
}

/** The sizes globals.css restates, mapped to the rem value it gives them. */
function declaredSizes(): Map<number, number> {
  const rules = new Map<number, number>()
  for (const m of readFileSync(GLOBALS, 'utf8').matchAll(DECLARED)) {
    rules.set(Number(m[1].replace(/\\/g, '')), Number(m[2]))
  }
  return rules
}

describe('projector mode covers every arbitrary type size', () => {
  const used = usedSizes()
  const declared = declaredSizes()

  it('finds sizes on both sides (the scan itself still works)', () => {
    expect(used.length).toBeGreaterThan(5)
    expect(declared.size).toBeGreaterThan(5)
  })

  it('restates every size the code uses', () => {
    const missing = used.filter((px) => !declared.has(px))
    expect(missing, `add "html.projector .text-\\[Npx\\] { font-size: N/16 rem }" to globals.css for: ${missing.join(', ')}`).toEqual([])
  })

  it('gives each one the same size it already had at the 16 px base', () => {
    for (const px of used) expect(declared.get(px), `${px}px`).toBeCloseTo(px / 16, 6)
  })

  it('keeps no rule for a size nothing uses any more', () => {
    const stale = [...declared.keys()].filter((px) => !used.includes(px)).sort((a, b) => a - b)
    expect(stale, `these projector rules have no call site left: ${stale.join(', ')}`).toEqual([])
  })
})
