-- =============================================================================
-- Comfy Clicker: initial schema
-- =============================================================================
-- Apply with the Supabase MCP `apply_migration` tool or psql (see supabase/config.md).
-- Conventions:
--   * Every public table has RLS enabled and explicit policies. The service role
--     bypasses RLS, so "service role only" simply means "no anon/authenticated policy".
--   * SECURITY DEFINER functions pin `search_path` to '' and fully qualify names.
--   * The migration is additive and idempotent-ish (IF NOT EXISTS / OR REPLACE);
--     it never removes objects.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user, auto-created by trigger (handle = comfy-xxxxxx)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      text not null unique
              check (handle ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  avatar_seed integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Public player profile. Readable by everyone, writable by its owner.';
comment on column public.profiles.avatar_seed is 'Deterministic seed for the generated avatar (derived from the user id at signup).';

-- -----------------------------------------------------------------------------
-- saves: one cloud save per user. `state` is the opaque serialized GameState;
-- the numeric columns are denormalised for the leaderboard view.
-- -----------------------------------------------------------------------------
create table if not exists public.saves (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  version          integer not null check (version >= 1),
  state            jsonb not null,
  cps              numeric not null default 0 check (cps >= 0),
  lifetime_credits numeric not null default 0 check (lifetime_credits >= 0),
  followers        numeric not null default 0 check (followers >= 0),
  season           integer not null default 1 check (season >= 1),
  saved_at         timestamptz not null default now()
);

create index if not exists saves_lifetime_credits_idx on public.saves (lifetime_credits desc);

comment on table public.saves is 'Cloud save per user. Owner only; the leaderboard view exposes the summary columns.';

-- -----------------------------------------------------------------------------
-- daily_logins: one row per (user, UTC day) claim; streak snapshot at claim time
-- -----------------------------------------------------------------------------
create table if not exists public.daily_logins (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  streak  integer not null default 1 check (streak >= 1),
  primary key (user_id, day)
);

-- -----------------------------------------------------------------------------
-- hub_workflows: ComfyHub: shareable workflows other players can run
-- -----------------------------------------------------------------------------
create table if not exists public.hub_workflows (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  model_id   text not null,
  precision  text not null check (precision in ('native', 'fp8', 'q4')),
  lora_tag   text null,
  upscaler   boolean not null default false,
  hashtags   text[] not null default '{}' check (cardinality(hashtags) <= 8),
  runs_24h   integer not null default 0 check (runs_24h >= 0),
  runs_total integer not null default 0 check (runs_total >= 0),
  rep        integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists hub_workflows_author_idx     on public.hub_workflows (author_id);
create index if not exists hub_workflows_runs_24h_idx   on public.hub_workflows (runs_24h desc, created_at desc);
create index if not exists hub_workflows_created_at_idx on public.hub_workflows (created_at desc);
create index if not exists hub_workflows_hashtags_idx   on public.hub_workflows using gin (hashtags);

comment on column public.hub_workflows.runs_24h is 'Rolling 24h run count. Bumped on insert into hub_runs, decayed by refresh_hub_runs_24h().';
comment on column public.hub_workflows.rep is 'Reputation score, maintained by the server (service role).';

-- -----------------------------------------------------------------------------
-- hub_runs: a player ran someone else's workflow; author earns a royalty
-- -----------------------------------------------------------------------------
create table if not exists public.hub_runs (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references public.hub_workflows (id) on delete cascade,
  runner_id    uuid not null references public.profiles (id) on delete cascade,
  credits_paid numeric not null default 0 check (credits_paid >= 0),
  royalty      numeric not null default 0 check (royalty >= 0),
  created_at   timestamptz not null default now()
);

create index if not exists hub_runs_workflow_created_idx on public.hub_runs (workflow_id, created_at desc);
create index if not exists hub_runs_runner_idx           on public.hub_runs (runner_id, created_at desc);
create index if not exists hub_runs_created_at_idx       on public.hub_runs (created_at desc);

-- -----------------------------------------------------------------------------
-- feed_items / trending_tags / feed_meta: server-fetched social feed cache.
-- Written only by the feed pipeline (service role); readable by everyone.
-- -----------------------------------------------------------------------------
create table if not exists public.feed_items (
  id         text primary key,
  source     text not null,
  author     text not null,
  handle     text not null,
  avatar_url text null,
  url        text not null,
  text       text not null,
  date       timestamptz not null,
  likes      integer null,
  media_url  text null,
  tags       text[] not null default '{}',
  verified   boolean not null default false,
  fetched_at timestamptz not null default now()
);

create index if not exists feed_items_date_idx   on public.feed_items (date desc);
create index if not exists feed_items_source_idx on public.feed_items (source, date desc);
create index if not exists feed_items_tags_idx   on public.feed_items using gin (tags);

create table if not exists public.trending_tags (
  id          serial primary key,
  tags        text[] not null,
  computed_at timestamptz not null default now()
);

create index if not exists trending_tags_computed_at_idx on public.trending_tags (computed_at desc);

create table if not exists public.feed_meta (
  key        text primary key,
  updated_at timestamptz not null default now(),
  errors     jsonb not null default '[]'::jsonb
);

-- =============================================================================
-- Row level security
-- =============================================================================
alter table public.profiles      enable row level security;
alter table public.saves         enable row level security;
alter table public.daily_logins  enable row level security;
alter table public.hub_workflows enable row level security;
alter table public.hub_runs      enable row level security;
alter table public.feed_items    enable row level security;
alter table public.trending_tags enable row level security;
alter table public.feed_meta     enable row level security;

-- profiles: readable by all, writable by owner ---------------------------------
create policy "profiles: public read"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "profiles: owner insert"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles: owner update"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- saves: owner only --------------------------------------------------------------
create policy "saves: owner select"
  on public.saves for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "saves: owner insert"
  on public.saves for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "saves: owner update"
  on public.saves for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "saves: owner delete"
  on public.saves for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- daily_logins: owner only -------------------------------------------------------
create policy "daily_logins: owner select"
  on public.daily_logins for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "daily_logins: owner insert"
  on public.daily_logins for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "daily_logins: owner update"
  on public.daily_logins for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- hub_workflows: readable by all, insert/update by author -------------------------
create policy "hub_workflows: public read"
  on public.hub_workflows for select
  to anon, authenticated
  using (true);

create policy "hub_workflows: author insert"
  on public.hub_workflows for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

create policy "hub_workflows: author update"
  on public.hub_workflows for update
  to authenticated
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

create policy "hub_workflows: author delete"
  on public.hub_workflows for delete
  to authenticated
  using ((select auth.uid()) = author_id);

-- hub_runs: insert by runner, readable by all ------------------------------------
create policy "hub_runs: public read"
  on public.hub_runs for select
  to anon, authenticated
  using (true);

create policy "hub_runs: runner insert"
  on public.hub_runs for insert
  to authenticated
  with check ((select auth.uid()) = runner_id);

-- feed_*: readable by all; writes only via service role (no write policies) --------
create policy "feed_items: public read"
  on public.feed_items for select
  to anon, authenticated
  using (true);

create policy "trending_tags: public read"
  on public.trending_tags for select
  to anon, authenticated
  using (true);

create policy "feed_meta: public read"
  on public.feed_meta for select
  to anon, authenticated
  using (true);

-- =============================================================================
-- Grants (Supabase default privileges usually cover these; be explicit anyway)
-- =============================================================================
grant usage on schema public to anon, authenticated, service_role;

grant select                         on public.profiles      to anon, authenticated;
grant insert, update                 on public.profiles      to authenticated;
grant select, insert, update, delete on public.saves         to authenticated;
grant select, insert, update         on public.daily_logins  to authenticated;
grant select                         on public.hub_workflows to anon, authenticated;
grant insert, update, delete         on public.hub_workflows to authenticated;
grant select                         on public.hub_runs      to anon, authenticated;
grant insert                         on public.hub_runs      to authenticated;
grant select                         on public.feed_items    to anon, authenticated;
grant select                         on public.trending_tags to anon, authenticated;
grant select                         on public.feed_meta     to anon, authenticated;

grant all on public.profiles, public.saves, public.daily_logins, public.hub_workflows,
             public.hub_runs, public.feed_items, public.trending_tags, public.feed_meta
  to service_role;
grant usage, select on sequence public.trending_tags_id_seq to service_role;

-- =============================================================================
-- Leaderboard view: top 100 by lifetime credits.
-- Deliberately NOT security_invoker: it runs as the view owner so every visitor
-- can read the summary columns even though `saves` itself is owner-only.
-- The private `state` blob is never exposed.
-- =============================================================================
create or replace view public.leaderboard
  with (security_invoker = false)
as
  select
    s.user_id,
    p.handle,
    s.cps,
    s.lifetime_credits,
    s.followers,
    s.season
  from public.saves s
  join public.profiles p on p.id = s.user_id
  order by s.lifetime_credits desc, s.saved_at asc
  limit 100;

grant select on public.leaderboard to anon, authenticated, service_role;

-- =============================================================================
-- Functions & triggers
-- =============================================================================

-- profiles auto-insert on auth.users insert -------------------------------------
-- handle = 'comfy-' || left(id::text, 6); on the (rare) handle collision, retry
-- with a longer prefix of the hyphen-stripped uuid so signup never fails.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seed      integer := hashtext(new.id::text) & 2147483647;
  candidate text    := 'comfy-' || left(new.id::text, 6);
  n         integer := 6;
begin
  loop
    begin
      insert into public.profiles (id, handle, avatar_seed)
      values (new.id, candidate, seed);
      exit;
    exception when unique_violation then
      -- Either the profile already exists (id conflict) or the handle is taken.
      if exists (select 1 from public.profiles where id = new.id) then
        exit;
      end if;
      -- 'comfy-' + 26 hex chars = 32 chars, the handle check's upper bound.
      n := n + 2;
      if n > 26 then
        raise;
      end if;
      candidate := 'comfy-' || left(replace(new.id::text, '-', ''), n);
    end;
  end loop;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- hub_workflows counters are server-owned: user JWTs (authenticated/anon) can
-- update their own workflow rows but not bump runs/rep. Nested trigger updates
-- (pg_trigger_depth() > 1) and service-role / cron callers pass through.
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
    new.runs_24h   := old.runs_24h;
    new.runs_total := old.runs_total;
    new.rep        := old.rep;
  end if;
  return new;
end;
$$;

revoke all on function public.hub_workflows_protect_counters() from public, anon, authenticated;

create or replace trigger hub_workflows_protect_counters
  before update on public.hub_workflows
  for each row execute function public.hub_workflows_protect_counters();

-- hub_runs insert → bump the workflow's counters. SECURITY DEFINER so a runner
-- (who has no update rights on someone else's workflow) can still record a run.
create or replace function public.hub_runs_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hub_workflows
     set runs_total = runs_total + 1,
         runs_24h   = runs_24h + 1
   where id = new.workflow_id;
  return new;
end;
$$;

revoke all on function public.hub_runs_after_insert() from public, anon, authenticated;

create or replace trigger hub_runs_after_insert
  after insert on public.hub_runs
  for each row execute function public.hub_runs_after_insert();

-- refresh_hub_runs_24h(): recompute the rolling 24h window from hub_runs.
-- Service role only (cron). Returns the number of workflow rows that changed.
create or replace function public.refresh_hub_runs_24h()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  with counts as (
    select workflow_id, count(*)::integer as n
      from public.hub_runs
     where created_at > now() - interval '24 hours'
     group by workflow_id
  ),
  upd as (
    update public.hub_workflows w
       set runs_24h = coalesce(c.n, 0)
      from public.hub_workflows w2
      left join counts c on c.workflow_id = w2.id
     where w.id = w2.id
       and w.runs_24h is distinct from coalesce(c.n, 0)
    returning 1
  )
  select count(*)::integer into changed from upd;
  return changed;
end;
$$;

revoke all on function public.refresh_hub_runs_24h() from public, anon, authenticated;
grant execute on function public.refresh_hub_runs_24h() to service_role;

comment on function public.refresh_hub_runs_24h() is
  'Recomputes hub_workflows.runs_24h from hub_runs. Call from a cron with the service role.';
