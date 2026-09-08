/**
 * Static checks over the SQL text of the initial migration. No database needed.
 * Guards the security model: every table has RLS + policies, feed tables are
 * service-role-write-only, nothing destructive, leaderboard view exists.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const MIGRATION_PATH = fileURLToPath(new URL('../../../../supabase/migrations/0001_init.sql', import.meta.url))
const raw = readFileSync(MIGRATION_PATH, 'utf8')

/** SQL with `-- comments` stripped, so prose in comments can't mask or trigger checks. */
const sql = raw
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

const EXPECTED_TABLES = [
  'profiles',
  'saves',
  'daily_logins',
  'hub_workflows',
  'hub_runs',
  'feed_items',
  'trending_tags',
  'feed_meta',
] as const

const SERVICE_ROLE_ONLY_WRITE = ['feed_items', 'trending_tags', 'feed_meta'] as const

function createdTables(): string[] {
  return [...sql.matchAll(/create table(?: if not exists)? public\.(\w+)/gi)].map((m) => m[1])
}

function policiesFor(table: string): { name: string; command: string; roles: string }[] {
  const re = new RegExp(
    `create policy "([^"]+)"\\s+on public\\.${table}\\s+for (select|insert|update|delete|all)\\s+to ([\\w, ]+?)\\s+(?:using|with check)`,
    'gi',
  )
  return [...sql.matchAll(re)].map((m) => ({ name: m[1], command: m[2].toLowerCase(), roles: m[3] }))
}

describe('0001_init.sql', () => {
  it('creates exactly the expected tables', () => {
    expect(createdTables().sort()).toEqual([...EXPECTED_TABLES].sort())
  })

  it('enables RLS on every table', () => {
    for (const table of createdTables()) {
      expect(sql, `RLS missing on ${table}`).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i'),
      )
    }
  })

  it('declares at least one policy per table', () => {
    for (const table of createdTables()) {
      expect(policiesFor(table).length, `no policies on ${table}`).toBeGreaterThan(0)
    }
  })

  it('contains no destructive statements', () => {
    expect(sql).not.toMatch(/\bdrop\b/i)
    expect(sql).not.toMatch(/\btruncate\b/i)
    expect(sql).not.toMatch(/\bdelete from\b/i)
  })

  it('defines the leaderboard view over saves join profiles, top 100 by lifetime_credits, without state', () => {
    const view = sql.match(/create (?:or replace )?view public\.leaderboard[\s\S]*?;/i)?.[0]
    expect(view).toBeDefined()
    expect(view).toMatch(/from public\.saves/i)
    expect(view).toMatch(/join public\.profiles/i)
    expect(view).toMatch(/order by s\.lifetime_credits desc/i)
    expect(view).toMatch(/limit 100/i)
    for (const col of ['user_id', 'handle', 'cps', 'lifetime_credits', 'followers', 'season']) {
      expect(view).toMatch(new RegExp(`\\b${col}\\b`))
    }
    expect(view).not.toMatch(/\bstate\b/)
    expect(sql).toMatch(/grant select on public\.leaderboard to anon, authenticated/i)
  })

  it('keeps saves and daily_logins owner-only (no anon policies, uid checks everywhere)', () => {
    for (const table of ['saves', 'daily_logins']) {
      const policies = policiesFor(table)
      expect(policies.length).toBeGreaterThan(0)
      for (const p of policies) {
        expect(p.roles, `${table} policy "${p.name}" grants anon`).not.toMatch(/\banon\b/)
      }
      // Every policy body on these tables must compare against auth.uid().
      const bodies = [...sql.matchAll(new RegExp(`create policy "[^"]+"\\s+on public\\.${table}[\\s\\S]*?;`, 'gi'))]
      expect(bodies.length).toBe(policies.length)
      for (const b of bodies) expect(b[0]).toMatch(/auth\.uid\(\)/)
    }
  })

  it('feed tables are readable by all and have no write policies', () => {
    for (const table of SERVICE_ROLE_ONLY_WRITE) {
      const policies = policiesFor(table)
      expect(policies.map((p) => p.command)).toEqual(['select'])
      expect(policies[0].roles).toMatch(/\banon\b/)
      expect(policies[0].roles).toMatch(/\bauthenticated\b/)
      // and no direct grants beyond select for user roles
      expect(sql).not.toMatch(new RegExp(`grant [^;]*\\b(insert|update|delete)\\b[^;]*on public\\.${table}\\s+to [^;]*\\b(anon|authenticated)\\b`, 'i'))
    }
  })

  it('profiles and hub_workflows are publicly readable and owner/author writable', () => {
    const profiles = policiesFor('profiles')
    expect(profiles.find((p) => p.command === 'select')?.roles).toMatch(/anon/)
    expect(profiles.map((p) => p.command)).toEqual(expect.arrayContaining(['insert', 'update']))

    const hub = policiesFor('hub_workflows')
    expect(hub.find((p) => p.command === 'select')?.roles).toMatch(/anon/)
    expect(hub.map((p) => p.command)).toEqual(expect.arrayContaining(['insert', 'update']))
    expect(sql).toMatch(/create policy "hub_workflows: author insert"[\s\S]*?auth\.uid\(\)\) = author_id/)

    const runs = policiesFor('hub_runs')
    expect(runs.map((p) => p.command).sort()).toEqual(['insert', 'select'])
    expect(sql).toMatch(/create policy "hub_runs: runner insert"[\s\S]*?auth\.uid\(\)\) = runner_id/)
  })

  it('auto-creates profiles from auth.users with a comfy-xxxxxx handle', () => {
    expect(sql).toMatch(/create (?:or replace )?function public\.handle_new_user\(\)/i)
    expect(sql).toMatch(/after insert on auth\.users/i)
    expect(sql).toMatch(/execute function public\.handle_new_user\(\)/i)
    expect(sql).toMatch(/'comfy-' \|\| left\(new\.id::text, 6\)/)
  })

  it('exposes refresh_hub_runs_24h() to the service role only', () => {
    expect(sql).toMatch(/create (?:or replace )?function public\.refresh_hub_runs_24h\(\)/i)
    expect(sql).toMatch(/revoke all on function public\.refresh_hub_runs_24h\(\) from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function public\.refresh_hub_runs_24h\(\) to service_role/i)
  })

  it('pins search_path on every security definer function', () => {
    const fns = [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\$\$;/gi)]
    expect(fns.length).toBeGreaterThan(0)
    for (const fn of fns) {
      if (/security definer/i.test(fn[0])) {
        expect(fn[0], `${fn[1]} lacks a pinned search_path`).toMatch(/set search_path = ''/i)
      }
    }
  })

  it('uses stable primary keys and expected column shapes', () => {
    expect(sql).toMatch(/profiles \(\s*id\s+uuid primary key references auth\.users/i)
    expect(sql).toMatch(/saves \(\s*user_id\s+uuid primary key references auth\.users/i)
    expect(sql).toMatch(/primary key \(user_id, day\)/i)
    expect(sql).toMatch(/hub_workflows \(\s*id\s+uuid primary key default gen_random_uuid\(\)/i)
    expect(sql).toMatch(/feed_items \(\s*id\s+text primary key/i)
    expect(sql).toMatch(/trending_tags \(\s*id\s+serial primary key/i)
    expect(sql).toMatch(/feed_meta \(\s*key\s+text primary key/i)
    expect(sql).toMatch(/precision\s+text not null check \(precision in \('native', 'fp8', 'q4'\)\)/i)
  })
})
