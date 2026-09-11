-- Schedule the live-feed refresh from Postgres so trending tags stay fresh even without traffic.
-- Replace __DEPLOY_URL__ and __CRON_SECRET__ before applying.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('comfy-clicker-feed-refresh') where exists (select 1 from cron.job where jobname = 'comfy-clicker-feed-refresh');

select cron.schedule(
  'comfy-clicker-feed-refresh',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := '__DEPLOY_URL__/api/feed/refresh',
    headers := jsonb_build_object('Authorization', 'Bearer __CRON_SECRET__', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
