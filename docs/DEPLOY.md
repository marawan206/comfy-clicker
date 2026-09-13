# Deploying Comfy Clicker

## 1. Vercel (frontend + API routes)

1. `pnpm dlx vercel login` (once), then `pnpm dlx vercel link` in the repo, or import `marawan206/comfy-clicker` in the Vercel dashboard (framework preset: Next.js, build `pnpm build`).
2. Environment variables (Production + Preview):

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase legacy anon key (or `sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (`sb_secret_…`); server only |
| `CRON_SECRET` | any long random string; used by `/api/feed/refresh` |
| `NEXT_PUBLIC_SITE_URL` | `https://comfy-clicker.vercel.app` (the URL confirmation emails send people back to) |

3. `pnpm dlx vercel --prod` (or push to `main` with the Git integration).
4. `vercel.json` schedules `/api/feed/refresh` and `/api/hub/refresh` once a day (Hobby plan limit); Vercel sends the `Authorization: Bearer $CRON_SECRET` header automatically when `CRON_SECRET` is set. The feed also refreshes lazily whenever a page view finds it older than 15 minutes.

## 2. Supabase

### Schema

Apply in order: `0001_init.sql`, `0003_hub_integrity.sql`, `0004_profiles.sql` (all three applied on the live project). 0003 makes hub runs and daily claims server-only and adds the royalty ledger. 0004 is the username migration: it adds `profiles.handle_changed_at`, rewrites `handle_new_user()` so a sign-up can ask for its own handle (`raw_user_meta_data.handle`, taken when it is lowercase, matches `^[a-z0-9][a-z0-9_-]{2,31}$`, is not reserved and is free, otherwise the generated `comfy-xxxxxx` as before), and adds the `profiles_guard_handle()` before-update trigger that refuses reserved names, holds a user JWT to one rename a day, stamps `handle_changed_at` and pins `created_at`. It is additive: no drops, no data loss. `0002_feed_cron.sql` is optional; apply it after replacing `__DEPLOY_URL__` and `__CRON_SECRET__` and Postgres calls the refresh route every 15 minutes with `pg_cron` + `pg_net`. Details and the MCP / psql / CLI commands: `supabase/config.md`.

### Auth → Providers → Email

Enable email + password. For a frictionless demo, turn **Confirm email** off (otherwise new accounts must click the confirmation link before cloud saves sync).

### Auth → URL configuration (this is the confirmation-email fix)

| Field | Value |
|---|---|
| **Site URL** | `https://comfy-clicker.vercel.app` |
| **Redirect URLs** | `https://comfy-clicker.vercel.app/auth/callback` |
| | `https://comfy-clicker.vercel.app/**` |
| | `http://localhost:3000/**` |

All three redirect entries, exactly as written, and the Site URL with no trailing slash. Supabase falls back to the Site URL whenever the redirect the app asked for is not on the allow-list, which is why a link generated from a local dev server points at `localhost:3000`. So a confirmation email pointing at localhost means one of two things: the sign-up happened on `http://localhost:3000` (expected, and the link works there), or the Vercel redirect entries are missing and Supabase fell back to a Site URL that is still the default. Set `NEXT_PUBLIC_SITE_URL` in Vercel (section 1) so the app always asks for the production callback, and re-test by signing up from `https://comfy-clicker.vercel.app`.

## 3. Smoke test after deploy

```
curl https://<vercel-url>/api/health           # {"ok":true,"supabase":true}
curl -H "Authorization: Bearer $CRON_SECRET" https://<vercel-url>/api/feed/refresh
curl https://<vercel-url>/api/trending
```
Open the site, play as a guest, create an account, confirm the save appears in `saves`, publish a workflow on /hub, check /leaderboard.
