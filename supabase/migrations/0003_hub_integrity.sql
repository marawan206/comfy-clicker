-- =============================================================================
-- Comfy Clicker: ComfyHub integrity + royalty ledger
-- =============================================================================
-- Closes the review findings on hub runs:
--   * hub_runs are written by the server only (service role via /api/hub/run, which clamps
--     credits_paid to the real job cost and rate-limits per runner). The direct runner-insert
--     policy is dropped, so the anon key can no longer spoof runs, royalties or trending.
--   * Each run carries the rep it earned; the insert trigger bumps runs_24h / runs_total /
--     royalties_total / rep in one atomic UPDATE (no read-then-write from the route).
--   * hub_workflows.royalties_total replaces summing every hub_runs row on each listing.
--   * claim_hub_royalties(author) hands unclaimed royalties + rep to the author's game once
--     and marks the rows, so a second device cannot collect them twice.
--   * daily_logins is written by the server only as well (/api/daily with the service role);
--     the owner-insert/update policies let a client pre-insert future days or a fat streak.
--   * refresh_hub_runs_24h() gets a pg_cron schedule when the extension is present; Vercel
--     Cron hits /api/hub/refresh either way (see vercel.json).
-- Apply after 0001 (0002 is optional). Additive except for the two policy drops above.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.hub_runs
  add column if not exists rep        integer not null default 0 check (rep >= 0),
  add column if not exists claimed_at timestamptz null;

alter table public.hub_workflows
  add column if not exists royalties_total numeric not null default 0 check (royalties_total >= 0);

comment on column public.hub_runs.rep is 'Reputation the author earned from this run (0 on a self-run).';
comment on column public.hub_runs.claimed_at is 'When the author''s game collected this run''s royalty and rep; null = unclaimed.';
comment on column public.hub_workflows.royalties_total is 'Sum of hub_runs.royalty for this workflow, maintained by the insert trigger.';

create index if not exists hub_runs_unclaimed_idx on public.hub_runs (workflow_id) where claimed_at is null;

-- Backfill for rows recorded before this migration.
update public.hub_workflows w
   set royalties_total = coalesce((select sum(r.royalty) from public.hub_runs r where r.workflow_id = w.id), 0)
 where w.royalties_total = 0;

-- -----------------------------------------------------------------------------
-- Server-only writes: hub_runs and daily_logins
-- -----------------------------------------------------------------------------
drop policy if exists "hub_runs: runner insert" on public.hub_runs;
revoke insert on public.hub_runs from authenticated;

drop policy if exists "daily_logins: owner insert" on public.daily_logins;
drop policy if exists "daily_logins: owner update" on public.daily_logins;
revoke insert, update on public.daily_logins from authenticated;

-- -----------------------------------------------------------------------------
-- Counters: one atomic bump per run, and royalties_total is server-owned too
-- -----------------------------------------------------------------------------
create or replace function public.hub_workflows_protect_counters()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.runs_24h        := old.runs_24h;
    new.runs_total      := old.runs_total;
    new.rep             := old.rep;
    new.royalties_total := old.royalties_total;
  end if;
  return new;
end;
$$;

create or replace function public.hub_runs_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hub_workflows
     set runs_total      = runs_total + 1,
         runs_24h        = runs_24h + 1,
         royalties_total = royalties_total + new.royalty,
         rep             = rep + new.rep
   where id = new.workflow_id;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- claim_hub_royalties(author): collect every unclaimed run of the author's workflows.
-- Service role only (called by /api/hub/royalties for the cookie-authenticated user).
-- Self-runs never count: they carry no royalty, no rep, and are excluded from `runs`.
-- -----------------------------------------------------------------------------
create or replace function public.claim_hub_royalties(p_author uuid)
returns table (runs integer, royalty numeric, rep integer)
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.hub_runs r
       set claimed_at = now()
      from public.hub_workflows w
     where w.id = r.workflow_id
       and w.author_id = p_author
       and r.runner_id <> p_author
       and r.claimed_at is null
    returning r.royalty, r.rep
  )
  select count(*)::integer, coalesce(sum(royalty), 0)::numeric, coalesce(sum(rep), 0)::integer
    from claimed;
$$;

revoke all on function public.claim_hub_royalties(uuid) from public, anon, authenticated;
grant execute on function public.claim_hub_royalties(uuid) to service_role;

comment on function public.claim_hub_royalties(uuid) is
  'Marks the author''s unclaimed hub_runs as claimed and returns their count, royalty sum and rep sum. Service role only.';

-- -----------------------------------------------------------------------------
-- Decay the 24 h window from Postgres when pg_cron is installed (Vercel Cron covers the rest).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'comfy-clicker-hub-runs-24h') then
      perform cron.unschedule('comfy-clicker-hub-runs-24h');
    end if;
    perform cron.schedule('comfy-clicker-hub-runs-24h', '*/15 * * * *', 'select public.refresh_hub_runs_24h()');
  end if;
end;
$$;
