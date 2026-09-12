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

3. `pnpm dlx vercel --prod` (or push to `main` with the Git integration).
4. `vercel.json` schedules `/api/feed/refresh` and `/api/hub/refresh` once a day (Hobby plan limit); Vercel sends the `Authorization: Bearer $CRON_SECRET` header automatically when `CRON_SECRET` is set. The feed also refreshes lazily whenever a page view finds it older than 15 minutes.

## 2. Supabase

- Schema: `supabase/migrations/0001_init.sql` and `0003_hub_integrity.sql` (both applied; 0003 makes hub runs and daily claims server-only and adds the royalty ledger). Apply `0002_feed_cron.sql` after replacing `__DEPLOY_URL__` and `__CRON_SECRET__`. It makes Postgres call the refresh route every 15 minutes with `pg_cron` + `pg_net`.
- Auth → Providers → Email: enable email + password. For a frictionless demo, turn **Confirm email** off (otherwise new accounts must click the confirmation link before cloud saves sync).
- Auth → URL configuration: set Site URL to the Vercel URL and add `https://<vercel-url>/auth/callback` to redirect URLs.

## 3. Smoke test after deploy

```
curl https://<vercel-url>/api/health           # {"ok":true,"supabase":true}
curl -H "Authorization: Bearer $CRON_SECRET" https://<vercel-url>/api/feed/refresh
curl https://<vercel-url>/api/trending
```
Open the site, play as a guest, create an account, confirm the save appears in `saves`, publish a workflow on /hub, check /leaderboard.
