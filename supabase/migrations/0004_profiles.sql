-- =============================================================================
-- Comfy Clicker: player-chosen usernames
-- =============================================================================
-- Lets a player pick a handle at sign-up and change it later, without giving up
-- any of the guarantees 0001 put on `public.profiles`:
--   * `handle_changed_at` records the last rename; null means the handle is
--     still whatever sign-up handed out.
--   * `handle_new_user()` honours `raw_user_meta_data.handle` when it is well
--     formed, not reserved and still free, and otherwise falls back to the
--     generated `comfy-xxxxxx` handle with the same collision retry loop.
--     A sign-up never fails because the wanted handle was taken.
--   * `profiles_guard_handle()` is the rename gate: reserved names are refused,
--     user JWTs get one rename a day, every rename stamps `handle_changed_at`,
--     and `created_at` is pinned so a client cannot rewrite its own join date.
--
-- The regex is the one 0001 put on the column check, repeated verbatim so the
-- trigger and the constraint can never disagree; `src/lib/handle.ts` carries the
-- same literal for the client.
--
-- Apply after 0003 (see supabase/config.md). Additive: no drops, no deletes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists handle_changed_at timestamptz null;

comment on column public.profiles.handle_changed_at is
  'When the owner last renamed themselves. Null means the handle is still the one sign-up assigned (generated or picked on the create-account form), so the first rename is always free of the cooldown.';

-- -----------------------------------------------------------------------------
-- Sign-up: honour a wanted handle, fall back to the generated one
-- -----------------------------------------------------------------------------
-- `options.data.handle` from the create-account form arrives as
-- `raw_user_meta_data.handle`. It is untrusted, so it is lowercased, trimmed and
-- put through the same regex as the column check, refused if reserved, and taken
-- only if the insert succeeds. Anything else (missing, malformed, reserved,
-- already taken) falls through to 'comfy-' || left(id::text, 6) exactly as in
-- 0001, so a sign-up can never fail over a username.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved  text[]  := array['admin', 'comfy', 'comfyui', 'comfyanonymous', 'comfyorg', 'comfy-org', 'moderator', 'support', 'system'];
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

-- -----------------------------------------------------------------------------
-- Rename gate
-- -----------------------------------------------------------------------------
-- Runs as the caller (like hub_workflows_protect_counters in 0001): it only
-- inspects OLD/NEW and raises, so it needs no elevated rights. The cooldown and
-- the created_at pin apply to user JWTs only, so the service role can still fix
-- a handle from a server route or the SQL editor. `auth.role()` is null for the
-- postgres role, hence the coalesce.
--
-- Error names are the contract the client maps to copy (src/lib/handle.ts):
-- 'handle_reserved' and 'handle_cooldown'. The 23505 (taken) and 23514 (regex)
-- codes still come from the table's own unique index and check constraint.
create or replace function public.profiles_guard_handle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reserved text[] := array['admin', 'comfy', 'comfyui', 'comfyanonymous', 'comfyorg', 'comfy-org', 'moderator', 'support', 'system'];
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
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_guard_handle() from public, anon, authenticated;

create or replace trigger profiles_guard_handle
  before update on public.profiles
  for each row execute function public.profiles_guard_handle();

comment on function public.profiles_guard_handle() is
  'Before-update gate on profiles.handle: refuses reserved names, holds user JWTs to one rename a day, stamps handle_changed_at and pins created_at.';
