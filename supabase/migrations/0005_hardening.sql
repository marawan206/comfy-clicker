-- =============================================================================
-- Comfy Clicker: counter and handle hardening
-- =============================================================================
-- Three findings, all fixed here because the database is the only enforcement
-- point a client cannot skip. Every one of them is reachable with nothing but
-- the public anon key and the player's own access token, straight to PostgREST.
--
--   * hub_workflows counters were protected on UPDATE only (0001 registered
--     `hub_workflows_protect_counters` `before update`), while the insert
--     policy checks nothing but `auth.uid() = author_id` and the grant is
--     table-level with no column list. So a signed-in player could POST a brand
--     new workflow row with runs_24h / runs_total / rep / royalties_total
--     already filled in and land at the top of the trending list, which ranks
--     on runs_24h alone. The guard now runs before insert as well and zeroes
--     all four for user JWTs.
--
--   * The rename cooldown on profiles.handle was bypassable. handle_changed_at
--     is a plain column the "profiles: owner update" policy lets the owner
--     write, and an update that does not touch the handle skips the rename
--     branch entirely, so clearing the stamp in its own PATCH reset the
--     one-rename-a-day limit and the next rename went straight through. It is
--     now pinned for user JWTs whenever the handle is not actually changing;
--     a real rename still overwrites it with now().
--
--   * The reserved-name list was 26 names on the client (src/lib/handle.ts) and
--     9 in SQL, so root, staff, administrator, hub, leaderboard and a dozen
--     others were claimable by a direct PostgREST update while the in-app modal
--     refused them. handle is shown on the public leaderboard and on every
--     ComfyHub card, so `root` or `staff` reads as an official account. Both
--     functions now carry the client's full list plus the two comfy-org names
--     0004 already reserved.
--
-- Apply after 0004 (see supabase/config.md). Additive: no drops, no deletes,
-- no column changes, no policy changes. Only function and trigger bodies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- hub_workflows: counters are server-owned on INSERT as well as UPDATE
-- -----------------------------------------------------------------------------
-- Nested trigger updates (hub_runs_after_insert, pg_trigger_depth() > 1) and
-- service-role / cron callers still pass through untouched; only user JWTs are
-- rewritten. On insert the four counters are forced to their zero start, which
-- is what /api/hub/publish sets anyway: the route was never the hole, the
-- table grant was.
create or replace function public.hub_workflows_protect_counters()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.runs_24h        := 0;
    new.runs_total      := 0;
    new.rep             := 0;
    new.royalties_total := 0;
  else
    new.runs_24h        := old.runs_24h;
    new.runs_total      := old.runs_total;
    new.rep             := old.rep;
    new.royalties_total := old.royalties_total;
  end if;

  return new;
end;
$$;

revoke all on function public.hub_workflows_protect_counters() from public, anon, authenticated;

create or replace trigger hub_workflows_protect_counters
  before insert or update on public.hub_workflows
  for each row execute function public.hub_workflows_protect_counters();

comment on function public.hub_workflows_protect_counters() is
  'Keeps runs_24h, runs_total, rep and royalties_total server-owned: zeroed on insert and held at their old values on update whenever the caller is a user JWT. Nested trigger updates and the service role pass through.';

-- -----------------------------------------------------------------------------
-- profiles: the full reserved list, and a cooldown stamp a client cannot clear
-- -----------------------------------------------------------------------------
-- The array is src/lib/handle.ts RESERVED_HANDLES (routes, roles and the
-- generated-handle prefix) plus 'comfyorg' and 'comfy-org' from 0004. SQL is
-- deliberately the stricter of the two: a name the client would allow and the
-- server refuses comes back as 'handle_reserved', which mapProfileError already
-- turns into copy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved  text[]  := array[
    'admin', 'administrator', 'api', 'board', 'comfy', 'comfyui', 'comfyanonymous',
    'comfyorg', 'comfy-org', 'guest', 'help', 'hub', 'leaderboard', 'login', 'logout',
    'map', 'moderator', 'null', 'root', 'settings', 'signin', 'signup', 'staff',
    'stats', 'support', 'system', 'undefined', 'user'
  ];
  seed      integer := hashtext(new.id::text) & 2147483647;
  wanted    text    := lower(btrim(coalesce(new.raw_user_meta_data ->> 'handle', '')));
  candidate text    := 'comfy-' || left(new.id::text, 6);
  n         integer := 6;
begin
  if wanted ~ '^[a-z0-9][a-z0-9_-]{2,31}$' and not (wanted = any (reserved)) then
    begin
      insert into public.profiles (id, handle, avatar_seed)
      values (new.id, wanted, seed);
      return new;
    exception when unique_violation then
      -- The id is already there (nothing to do), or the handle was claimed first
      -- (fall through to the generated handle).
      if exists (select 1 from public.profiles where id = new.id) then
        return new;
      end if;
    end;
  end if;

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

comment on function public.handle_new_user() is
  'Creates the profiles row for a new auth user. Takes raw_user_meta_data.handle when it is valid, unreserved and free; otherwise generates comfy-xxxxxx and retries on collision.';

create or replace function public.profiles_guard_handle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reserved text[] := array[
    'admin', 'administrator', 'api', 'board', 'comfy', 'comfyui', 'comfyanonymous',
    'comfyorg', 'comfy-org', 'guest', 'help', 'hub', 'leaderboard', 'login', 'logout',
    'map', 'moderator', 'null', 'root', 'settings', 'signin', 'signup', 'staff',
    'stats', 'support', 'system', 'undefined', 'user'
  ];
  is_user  boolean := coalesce(auth.role(), '') in ('authenticated', 'anon');
begin
  if new.handle is distinct from old.handle then
    if new.handle = any (reserved) then
      raise exception 'handle_reserved' using errcode = 'P0001';
    end if;

    if is_user
       and old.handle_changed_at is not null
       and old.handle_changed_at > now() - interval '1 day' then
      raise exception 'handle_cooldown' using errcode = 'P0001';
    end if;

    new.handle_changed_at := now();
  end if;

  if is_user then
    new.created_at := old.created_at;
    -- handle_changed_at is the cooldown's entire memory, and an update that
    -- leaves the handle alone never reaches the branch above. Pin it here, or a
    -- PATCH setting it to null buys an unlimited supply of renames.
    if new.handle is not distinct from old.handle then
      new.handle_changed_at := old.handle_changed_at;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_guard_handle() from public, anon, authenticated;

create or replace trigger profiles_guard_handle
  before update on public.profiles
  for each row execute function public.profiles_guard_handle();

comment on function public.profiles_guard_handle() is
  'Before-update gate on profiles.handle: refuses reserved names, holds user JWTs to one rename a day, stamps handle_changed_at on a real rename and pins both handle_changed_at and created_at against everything else a user JWT writes.';
