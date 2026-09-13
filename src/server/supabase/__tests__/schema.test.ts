/**
 * Static checks over the SQL text of the initial migration. No database needed.
 * Guards the security model: every table has RLS + policies, feed tables are
 * service-role-write-only, nothing destructive, leaderboard view exists.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { RESERVED_HANDLES as RESERVED_CLIENT_HANDLES } from '@/lib/handle'

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

// ---------------------------------------------------------------------------
// 0004_profiles.sql: player-chosen usernames
// ---------------------------------------------------------------------------
const PROFILES_MIGRATION_PATH = fileURLToPath(
  new URL('../../../../supabase/migrations/0004_profiles.sql', import.meta.url),
)
const rawProfiles = readFileSync(PROFILES_MIGRATION_PATH, 'utf8')
const sqlProfiles = rawProfiles
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

/** The two functions 0004 ships, sliced out of the file by their $$ body. */
function profilesFunctions(): { name: string; body: string }[] {
  return [...sqlProfiles.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\$\$;/gi)].map((m) => ({
    name: m[1],
    body: m[0],
  }))
}

const RESERVED_HANDLES = [
  'admin',
  'comfy',
  'comfyui',
  'comfyanonymous',
  'comfyorg',
  'comfy-org',
  'moderator',
  'support',
  'system',
] as const

describe('0004_profiles.sql', () => {
  it('adds handle_changed_at to profiles without touching the rest of the table', () => {
    expect(sqlProfiles).toMatch(/alter table public\.profiles\s+add column if not exists handle_changed_at timestamptz null/i)
    expect(rawProfiles).toMatch(/comment on column public\.profiles\.handle_changed_at is/i)
    expect(sqlProfiles).not.toMatch(/create table/i)
    expect(sqlProfiles).not.toMatch(/alter column/i)
  })

  it('contains no destructive statements', () => {
    expect(sqlProfiles).not.toMatch(/\bdrop\b/i)
    expect(sqlProfiles).not.toMatch(/\btruncate\b/i)
    expect(sqlProfiles).not.toMatch(/\bdelete from\b/i)
    expect(sqlProfiles).not.toMatch(/\brevoke [^;]*\bon public\.profiles\b/i)
  })

  it('ships exactly handle_new_user and profiles_guard_handle, both with a pinned search_path', () => {
    const fns = profilesFunctions()
    expect(fns.map((f) => f.name).sort()).toEqual(['handle_new_user', 'profiles_guard_handle'])
    for (const fn of fns) {
      expect(fn.body, `${fn.name} lacks a pinned search_path`).toMatch(/set search_path = ''/i)
      expect(sqlProfiles, `${fn.name} is still executable by user roles`).toMatch(
        new RegExp(`revoke all on function public\\.${fn.name}\\(\\) from public, anon, authenticated`, 'i'),
      )
    }
    // security definer stays where 0001 had it: the signup trigger writes profiles
    // for a brand new user; the rename guard only inspects OLD/NEW.
    expect(fns.find((f) => f.name === 'handle_new_user')?.body).toMatch(/security definer/i)
    expect(fns.find((f) => f.name === 'profiles_guard_handle')?.body).not.toMatch(/security definer/i)
  })

  it('reuses the exact handle regex from 0001 so the trigger and the check constraint agree', () => {
    const literal = sql.match(/'\^\[a-z0-9\]\[a-z0-9_-\]\{2,31\}\$'/)?.[0]
    expect(literal).toBe("'^[a-z0-9][a-z0-9_-]{2,31}$'")
    expect(sqlProfiles).toContain(literal!)
  })

  it('honours a wanted handle at signup and still falls back to the generated one', () => {
    const fn = profilesFunctions().find((f) => f.name === 'handle_new_user')!.body
    expect(fn).toMatch(/new\.raw_user_meta_data ->> 'handle'/)
    expect(fn).toMatch(/lower\(btrim\(/i)
    // the 0001 fallback and its collision retry loop survive
    expect(fn).toMatch(/'comfy-' \|\| left\(new\.id::text, 6\)/)
    expect(fn).toMatch(/exception when unique_violation then/i)
    expect(fn).toMatch(/'comfy-' \|\| left\(replace\(new\.id::text, '-', ''\), n\)/)
    expect(sqlProfiles).toMatch(/create (?:or replace )?trigger on_auth_user_created\s+after insert on auth\.users/i)
  })

  it('guards renames with a before update trigger on profiles', () => {
    expect(sqlProfiles).toMatch(
      /create (?:or replace )?trigger profiles_guard_handle\s+before update on public\.profiles\s+for each row execute function public\.profiles_guard_handle\(\)/i,
    )
    const fn = profilesFunctions().find((f) => f.name === 'profiles_guard_handle')!.body
    expect(fn).toMatch(/new\.handle is distinct from old\.handle/i)
    expect(fn).toMatch(/raise exception 'handle_reserved' using errcode = 'P0001'/i)
    expect(fn).toMatch(/raise exception 'handle_cooldown' using errcode = 'P0001'/i)
    expect(fn).toMatch(/new\.handle_changed_at := now\(\)/i)
    // cooldown: one rename a day, for user JWTs only
    expect(fn).toMatch(/interval '1 day'/i)
    expect(fn).toMatch(/auth\.role\(\)[\s\S]*?in \('authenticated', 'anon'\)/i)
    // created_at is server-owned for user JWTs
    expect(fn).toMatch(/new\.created_at := old\.created_at/i)
  })

  it('reserves the comfy-org names in both functions', () => {
    for (const name of RESERVED_HANDLES) {
      expect(sqlProfiles, `${name} is not reserved`).toContain(`'${name}'`)
    }
    const arrays = [...sqlProfiles.matchAll(/reserved\s+text\[\]\s*:=\s*array\[([^\]]+)\]/gi)]
    expect(arrays.length).toBe(2)
    for (const arr of arrays) {
      const names = arr[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
      expect(names.sort()).toEqual([...RESERVED_HANDLES].sort())
    }
  })
})

// ---------------------------------------------------------------------------
// 0005_hardening.sql: server-owned counters on insert, an unclearable rename
// stamp, and the full reserved-name list
// ---------------------------------------------------------------------------
const HARDENING_MIGRATION_PATH = fileURLToPath(
  new URL('../../../../supabase/migrations/0005_hardening.sql', import.meta.url),
)
const rawHardening = readFileSync(HARDENING_MIGRATION_PATH, 'utf8')
const sqlHardening = rawHardening
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

function hardeningFunctions(): { name: string; body: string }[] {
  return [...sqlHardening.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\$\$;/gi)].map((m) => ({
    name: m[1],
    body: m[0],
  }))
}

/** 0004 reserved two comfy-org spellings the client list does not carry; 0005 keeps them. */
const EXTRA_RESERVED = ['comfyorg', 'comfy-org'] as const

describe('0005_hardening.sql', () => {
  it('is additive: functions and triggers only', () => {
    expect(sqlHardening).not.toMatch(/\bdrop\b/i)
    expect(sqlHardening).not.toMatch(/\btruncate\b/i)
    expect(sqlHardening).not.toMatch(/\bdelete from\b/i)
    expect(sqlHardening).not.toMatch(/create table/i)
    expect(sqlHardening).not.toMatch(/alter table/i)
    expect(sqlHardening).not.toMatch(/create policy/i)
  })

  it('ships the three functions 0001 and 0004 already own, with pinned search_paths', () => {
    const fns = hardeningFunctions()
    expect(fns.map((f) => f.name).sort()).toEqual([
      'handle_new_user',
      'hub_workflows_protect_counters',
      'profiles_guard_handle',
    ])
    for (const fn of fns) {
      expect(fn.body, `${fn.name} lacks a pinned search_path`).toMatch(/set search_path = ''/i)
      expect(sqlHardening, `${fn.name} is still executable by user roles`).toMatch(
        new RegExp(`revoke all on function public\\.${fn.name}\\(\\) from public, anon, authenticated`, 'i'),
      )
    }
  })

  it('guards hub_workflows counters on insert as well as update', () => {
    expect(sqlHardening).toMatch(
      /create (?:or replace )?trigger hub_workflows_protect_counters\s+before insert or update on public\.hub_workflows/i,
    )
    const fn = hardeningFunctions().find((f) => f.name === 'hub_workflows_protect_counters')!.body
    expect(fn).toMatch(/pg_trigger_depth\(\) > 1/i)
    expect(fn).toMatch(/auth\.role\(\)[\s\S]*?not in \('authenticated', 'anon'\)/i)
    expect(fn).toMatch(/tg_op = 'INSERT'/i)
    // Zeroed on insert, held on update: all four counters, both ways.
    for (const col of ['runs_24h', 'runs_total', 'rep', 'royalties_total']) {
      expect(fn, `${col} is not zeroed on insert`).toMatch(new RegExp(`new\\.${col}\\s*:=\\s*0;`))
      expect(fn, `${col} is not pinned on update`).toMatch(new RegExp(`new\\.${col}\\s*:=\\s*old\\.${col};`))
    }
  })

  it('pins handle_changed_at for user JWTs whenever the handle is not changing', () => {
    const fn = hardeningFunctions().find((f) => f.name === 'profiles_guard_handle')!.body
    // The rename branch still stamps it, so a legitimate rename is unaffected.
    expect(fn).toMatch(/new\.handle is distinct from old\.handle[\s\S]*?new\.handle_changed_at := now\(\)/i)
    expect(fn).toMatch(/if is_user then[\s\S]*?new\.created_at := old\.created_at/i)
    expect(fn).toMatch(
      /if new\.handle is not distinct from old\.handle then\s+new\.handle_changed_at := old\.handle_changed_at;/i,
    )
    expect(fn).toMatch(/raise exception 'handle_cooldown' using errcode = 'P0001'/i)
  })

  it('reserves every name the client reserves, in both functions', () => {
    const arrays = [...sqlHardening.matchAll(/reserved\s+text\[\]\s*:=\s*array\[([^\]]+)\]/gi)]
    expect(arrays.length).toBe(2)
    const lists = arrays.map((a) => a[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort())
    expect(lists[0]).toEqual(lists[1])
    const expected = [...RESERVED_CLIENT_HANDLES, ...EXTRA_RESERVED].sort()
    expect(lists[0]).toEqual(expected)
    // The names the audit found claimable are in there now.
    for (const name of ['root', 'staff', 'administrator', 'hub', 'leaderboard']) {
      expect(lists[0], `${name} is still claimable`).toContain(name)
    }
  })

  it('keeps the sign-up handle regex identical to 0001', () => {
    expect(sqlHardening).toContain("'^[a-z0-9][a-z0-9_-]{2,31}$'")
  })
})
