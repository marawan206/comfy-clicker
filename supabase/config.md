# Supabase setup

The schema lives in `supabase/migrations/*.sql` and is applied by hand (no Supabase CLI
project is checked in). Migrations are additive and numbered; never edit an applied one,
add `0002_*.sql` instead. The TypeScript row types in `src/server/supabase/types.ts` are
maintained by hand and must be updated alongside.

## 1. Apply the migration

### Option A — Supabase MCP (recommended from Claude Code)

With the Supabase MCP server connected to the project:

```
apply_migration({ name: "0001_init", query: <contents of supabase/migrations/0001_init.sql> })
```

`apply_migration` runs the SQL as the `postgres` role in one transaction and records it in
`supabase_migrations.schema_migrations`, so re-running it is refused rather than duplicated.

### Option B — psql

Grab the direct connection string from **Project Settings → Database** (use the session
pooler or direct URL, not the transaction pooler — the migration creates functions and
triggers):

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0001_init.sql
```

`-1` wraps the file in a single transaction; `ON_ERROR_STOP` aborts on the first error.

### Option C — Supabase CLI

```sh
supabase link --project-ref <ref>
supabase db push        # applies supabase/migrations/*.sql in order
```

## 2. Auth settings (Dashboard → Authentication)

- **Anonymous sign-ins: ON** — guests get a real `auth.users` row so cloud saves and the
  leaderboard work before they add an email.
- **Email provider: ON**. Magic link / OTP is enough; no password UI is planned.
- Add the site URL and `http://localhost:3000/**` to **Redirect URLs**.
- Every new `auth.users` row triggers `public.handle_new_user()` which creates the
  `profiles` row with `handle = 'comfy-' || left(id::text, 6)`.

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
service role only. Either:

- **Vercel Cron** → a route handler that checks `isCronAuthorized()` and calls
  `refreshHubRuns24h()` from `src/server/supabase/admin.ts` (every 15 min is plenty), or
- **pg_cron** inside Supabase:

  ```sql
  select cron.schedule('refresh-hub-runs-24h', '*/15 * * * *', $$select public.refresh_hub_runs_24h()$$);
  ```

The feed pipeline (`src/server/feed`) writes `feed_items`, `trending_tags` and `feed_meta`
with the admin client on its own cron.

## 5. Access model (what the migration enforces)

| Table | anon / authenticated read | writes |
| --- | --- | --- |
| `profiles` | everyone | owner (insert/update) |
| `saves` | owner only | owner |
| `daily_logins` | owner only | owner (insert/update) |
| `hub_workflows` | everyone | author (insert/update/delete); run counters and `rep` are server-owned |
| `hub_runs` | everyone | runner (insert) — trigger bumps the workflow's counters |
| `feed_items`, `trending_tags`, `feed_meta` | everyone | service role only |
| `leaderboard` (view) | everyone | — (top 100 by `lifetime_credits`; never exposes `state`) |

## 6. Verifying

```sh
pnpm vitest run src/server/supabase/__tests__/schema.test.ts
```

checks the SQL text (RLS on every table, policies present, no destructive statements,
leaderboard view exists). After applying, the Dashboard's **Database → Policies** page
should list every table above with RLS enabled.
