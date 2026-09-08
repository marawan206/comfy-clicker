import { readFileSync } from 'node:fs'

/** Read a captured fixture (trimmed real responses, captured 2026-09-13). */
export function fixture(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
}

export function fixtureJson(name: string): unknown {
  return JSON.parse(fixture(name)) as unknown
}
