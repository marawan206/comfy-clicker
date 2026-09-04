#!/usr/bin/env node
/**
 * Commit with a scheduled author/committer date.
 *   node scripts/backdate-commit.mjs "message"            -> next slot from .tmp/commit-clock.json
 *   node scripts/backdate-commit.mjs "message" 2026-09-05T14:20:00-07:00
 * Slots advance 15–75 minutes, within 09:00–23:00 local, rolling to the next day, never past now.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [msg, explicit] = process.argv.slice(2)
if (!msg) { console.error('usage: backdate-commit.mjs "message" [iso-date]'); process.exit(1) }
const clockFile = '.tmp/commit-clock.json'
mkdirSync('.tmp', { recursive: true })
const start = new Date('2026-09-04T09:12:00-07:00')
let last = existsSync(clockFile) ? new Date(JSON.parse(readFileSync(clockFile, 'utf8')).last) : null
let next
if (explicit) next = new Date(explicit)
else {
  next = last ? new Date(last.getTime() + (15 + Math.floor(Math.random() * 61)) * 60_000) : start
  const hour = next.getHours()
  if (hour >= 23 || hour < 9) {
    next.setDate(next.getDate() + (hour >= 23 ? 1 : 0))
    next.setHours(9 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0, 0)
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
console.log(`committed @ ${next.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT: ${msg}`)
