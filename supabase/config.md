# Supabase setup

The schema lives in `supabase/migrations/*.sql` and is applied by hand (no Supabase CLI
project is checked in). Migrations are additive and numbered; never edit an applied one,
add `0002_*.sql` instead. The TypeScript row types in `src/server/supabase/types.ts` are
maintained by hand and must be updated alongside.

## 1. Apply the migrations

`0001_init.sql` is the schema; `0003_hub_integrity.sql` (required by the ComfyHub run and
royalty routes and the daily route's writes) moves `hub_runs` / `daily_logins` writes behind
the service role, adds the royalty ledger and `claim_hub_royalties()`; `0004_profiles.sql`
(required by the username picker) adds `profiles.handle_changed_at`, teaches
`handle_new_user()` to honour the handle the create-account form asked for, and adds the
`profiles_guard_handle()` rename gate. `0002_feed_cron.sql` is optional (pg_cron for the
feed) and needs its placeholders replaced. Apply in order: 0001, 0003, 0004.

### Option A: Supabase MCP (recommended from Claude Code)

With the Supabase MCP server connected to the project:

```
apply_migration({ name: "0001_init", query: <contents of supabase/migrations/0001_init.sql> })
```

`apply_migration` runs the SQL as the `postgres` role in one transaction and records it in
`supabase_migrations.schema_migrations`, so re-running it is refused rather than duplicated.

### Option B: psql

Grab the direct connection string from **Project Settings → Database** (use the session
pooler or direct URL, not the transaction pooler. The migration creates functions and
triggers):

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0001_init.sql
```

`-1` wraps the file in a single transaction; `ON_ERROR_STOP` aborts on the first error.

### Option C: Supabase CLI

```sh
supabase link --project-ref <ref>
supabase db push        # applies supabase/migrations/*.sql in order
```

## 2. Auth settings (Dashboard → Authentication)

- **Email provider: ON** with **email + password** (the app ships a sign-in / create-account
  sheet; guests never need an account: the local save keeps working without one).
- **Confirm email** may stay on: sign-up then shows "check your inbox" and the confirmation
  link lands on `/auth/callback`, which exchanges the code and bounces back signed in.
- **Site URL**: `https://comfy-clicker.vercel.app`. **Redirect URLs**: add
  `https://comfy-clicker.vercel.app/auth/callback`, `https://comfy-clicker.vercel.app/**`
  and `http://localhost:3000/**`. Supabase falls back to the Site URL whenever the redirect
  the app asked for is not on the allow-list, which is what makes a confirmation link point
  at localhost. Anonymous sign-ins are not used. Full walkthrough in `docs/DEPLOY.md`.
- Every new `auth.users` row triggers `public.handle_new_user()`. Since `0004_profiles.sql`
  it takes `raw_user_meta_data.handle` (the optional username on the create-account form)
  when that value is lowercase, matches `^[a-z0-9][a-z0-9_-]{2,31}$`, is not reserved and is
  free; otherwise it falls back to `handle = 'comfy-' || left(id::text, 6)` with the same
  collision retry. A sign-up never fails because the wanted username was taken.

## 3. Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API (anon / publishable) | public |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API (service_role / secret) | server only |
| `CRON_SECRET` | any random string (`openssl rand -hex 32`) | protects cron routes |

`hasSupabase()` in `src/server/supabase/env.ts` is false when the public pair is missing and
the app falls back to guest mode.

## 4. Scheduled jobs

`public.refresh_hub_runs_24h()` decays `hub_workflows.runs_24h`. It is executable by the
service role only. Both callers are wired:

- **Vercel Cron** → `/api/hub/refresh` (in `vercel.json`, every 30 min) checks
  `isCronAuthorized()` and calls `refreshHubRuns24h()` from `src/server/supabase/admin.ts`.
- **pg_cron** → `0003_hub_integrity.sql` schedules `comfy-clicker-hub-runs-24h` every 15 min
  when the `pg_cron` extension is installed (it is skipped silently otherwise).

The feed pipeline (`src/server/feed`) writes `feed_items`, `trending_tags` and `feed_meta`
with the admin client on its own cron.

## 5. Access model (what the migration enforces)

| Table | anon / authenticated read | writes |
| --- | --- | --- |
| `profiles` | everyone | owner (insert/update); `profiles_guard_handle()` refuses the reserved names, holds a user JWT to one rename a day, stamps `handle_changed_at` and pins `created_at` (since 0004) |
| `saves` | owner only | owner |
| `daily_logins` | owner only | service role only (`/api/daily`, since 0003) |
| `hub_workflows` | everyone | author (insert/update/delete); run counters, `rep` and `royalties_total` are server-owned |
| `hub_runs` | everyone | service role only (`/api/hub/run` clamps `credits_paid` to the job cost and rate-limits; trigger bumps the workflow's counters), since 0003 |
| `feed_items`, `trending_tags`, `feed_meta` | everyone | service role only |
| `leaderboard` (view) | everyone | none (top 100 by `lifetime_credits`; never exposes `state`) |

## 6. Verifying

```sh
pnpm vitest run src/server/supabase/__tests__/schema.test.ts
```

checks the SQL text of `0001` (RLS on every table, policies present, no destructive
statements, leaderboard view exists) and of `0004` (additive, `search_path = ''` on both
functions, the handle regex identical to the column check, the rename cooldown, the reserved
list); `0003` intentionally drops two policies. After applying, the Dashboard's
**Database → Policies** page should list every table above with RLS enabled.

The rename rules themselves are worth a live check after applying `0004`:

```sql
select handle, handle_changed_at from public.profiles limit 5;   -- null = still the signup handle
```

