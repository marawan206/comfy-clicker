import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { CHANGE_ORDER, GAME_VERSION, PATCH_NOTES, type ChangeKind } from '@/data/patchNotes'
import { compareVersions, hasUnseenNotes, notesSince, parseVersion } from '@/lib/version'

/**
 * The patch notes are the one place a release is written down, and three things read them: the
 * in-game modal, CHANGELOG.md and the version the About box prints. These tests are what stop the
 * three from drifting, so a forgotten `pnpm notes` or a forgotten version bump fails here rather
 * than shipping a game that claims to be a version it is not.
 */
const SEMVER = /^\d+\.\d+\.\d+$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const KINDS: readonly ChangeKind[] = CHANGE_ORDER

describe('patch notes', () => {
  it('is newest first with unique, well formed versions and dates', () => {
    expect(PATCH_NOTES.length).toBeGreaterThan(0)
    const versions = PATCH_NOTES.map((n) => n.version)
    expect(new Set(versions).size).toBe(versions.length)
    for (const note of PATCH_NOTES) {
      expect(note.version, note.version).toMatch(SEMVER)
      expect(note.date, note.version).toMatch(DAY)
      expect(Date.parse(`${note.date}T00:00:00Z`), note.version).not.toBeNaN()
      // A release dated in the future is a copy-paste, not a plan.
      expect(Date.parse(`${note.date}T00:00:00Z`), note.version).toBeLessThanOrEqual(Date.now() + 86_400_000)
    }
    for (let i = 1; i < PATCH_NOTES.length; i++) {
      const newer = PATCH_NOTES[i - 1]!
      const older = PATCH_NOTES[i]!
      expect(compareVersions(newer.version, older.version), `${newer.version} > ${older.version}`).toBeGreaterThan(0)
      expect(newer.date >= older.date, `${newer.version} dated after ${older.version}`).toBe(true)
    }
  })

  it('gives every entry a title and at least one change, in a known bucket', () => {
    for (const note of PATCH_NOTES) {
      expect(note.title.length, note.version).toBeGreaterThan(0)
      expect(note.changes.length, note.version).toBeGreaterThan(0)
      expect(['release', 'hotfix']).toContain(note.kind)
      for (const change of note.changes) {
        expect(KINDS, `${note.version}: ${change.kind}`).toContain(change.kind)
        expect(change.text.trim()).toBe(change.text)
        expect(change.text.length).toBeGreaterThan(0)
        // House style: no trailing period on a bullet, and never an em-dash anywhere in the repo.
        expect(change.text.endsWith('.'), change.text).toBe(false)
        expect(change.text).not.toContain('—')
      }
    }
  })

  it('runs the version package.json ships', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(GAME_VERSION).toBe(PATCH_NOTES[0]!.version)
    expect(pkg.version).toBe(GAME_VERSION)
  })

  it('keeps CHANGELOG.md in step with the data file', async () => {
    const { readNotes, renderChangelog } = (await import('../../../scripts/patch-notes.mjs')) as {
      readNotes: (source?: string) => unknown[]
      renderChangelog: (notes: unknown[]) => string
    }
    const root = new URL('../../../', import.meta.url).pathname
    const parsed = readNotes(`${root}src/data/patchNotes.ts`)
    // The parser and the module must see the same releases, or the changelog is a different story.
    expect(parsed).toHaveLength(PATCH_NOTES.length)
    expect(readFileSync(`${root}CHANGELOG.md`, 'utf8')).toBe(renderChangelog(parsed))
  })
})

describe('version helpers', () => {
  it('parses and orders semver, and treats rubbish as 0.0.0', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('nonsense')).toEqual([0, 0, 0])
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
  })

  it('reports the notes a returning player has not seen', () => {
    const notes = [
      { version: '0.3.0', date: '2026-09-20', kind: 'release' as const, title: 'c', changes: [] },
      { version: '0.2.1', date: '2026-09-16', kind: 'hotfix' as const, title: 'b', changes: [] },
      { version: '0.2.0', date: '2026-09-14', kind: 'release' as const, title: 'a', changes: [] },
    ]
    expect(notesSince('0.2.0', notes).map((n) => n.version)).toEqual(['0.3.0', '0.2.1'])
    expect(notesSince('0.3.0', notes)).toEqual([])
    // A player with no watermark is new: nothing is "unseen" for them.
    expect(notesSince(null, notes)).toEqual([])
    expect(hasUnseenNotes(null, '0.3.0')).toBe(false)
    expect(hasUnseenNotes('0.2.0', '0.3.0')).toBe(true)
    expect(hasUnseenNotes('0.3.0', '0.3.0')).toBe(false)
  })
})
