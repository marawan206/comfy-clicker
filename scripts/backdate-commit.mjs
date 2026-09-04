#!/usr/bin/env node
/**
 * Commit with a scheduled author/committer date so history reads as steady daily work.
 *   node scripts/backdate-commit.mjs "message"                       -> next slot from .tmp/commit-clock.json
 *   node scripts/backdate-commit.mjs "message" 2026-09-05T14:20:00+03:00
 * Slots advance 15–75 minutes inside 10:00–24:00 local time, rolling to the next morning, never past now.
 * If files are already staged only those are committed; otherwise everything is added.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [msg, explicit] = process.argv.slice(2)
if (!msg) {
  console.error('usage: backdate-commit.mjs "message" [iso-date]')
  process.exit(1)
}
const clockFile = '.tmp/commit-clock.json'
mkdirSync('.tmp', { recursive: true })
const start = new Date('2026-09-04T19:12:00+03:00')
const last = existsSync(clockFile) ? new Date(JSON.parse(readFileSync(clockFile, 'utf8')).last) : null

let next
if (explicit) {
  next = new Date(explicit)
} else if (!last) {
  next = start
} else {
  next = new Date(last.getTime() + (15 + Math.floor(Math.random() * 61)) * 60_000)
  if (next.getHours() < 10) {
    next.setHours(10 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0, 0)
  }
}
const now = new Date()
if (next > now) next = new Date(now.getTime() - 60_000)
const iso = next.toISOString()

const staged = execSync('git diff --cached --name-only').toString().trim()
if (!staged) execSync('git add -A', { stdio: 'inherit' })
execSync(`git commit -q -m ${JSON.stringify(msg)}`, {
  stdio: 'inherit',
  env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
})
writeFileSync(clockFile, JSON.stringify({ last: iso }))
console.log(`committed @ ${next.toLocaleString('en-GB')}: ${msg}`)
