-- Shared control plane for the three interview applications.
-- This migration intentionally creates no application tables or interview accounts.
-- Membership and tenant state are server-managed; browser clients receive no write grant.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table private.interviews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  state text not null default 'draft'
    check (state in ('draft', 'active', 'closed')),
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint interviews_closed_at_state_check
    check ((state = 'closed') = (closed_at is not null))
);

create unique index interviews_single_seed_idx
  on private.interviews (is_seed)
  where is_seed;

create table private.interview_memberships (
  interview_id uuid not null references private.interviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('member', 'admin')),
  state text not null default 'active'
    check (state in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (interview_id, user_id),
  constraint interview_memberships_user_once unique (user_id),
  constraint interview_memberships_revoked_at_state_check
    check ((state = 'revoked') = (revoked_at is not null))
);

create index interview_memberships_active_user_idx
  on private.interview_memberships (user_id, interview_id)
  where state = 'active';

alter table private.interviews enable row level security;
alter table private.interviews force row level security;
alter table private.interview_memberships enable row level security;
alter table private.interview_memberships force row level security;

revoke all on table private.interviews from public, anon, authenticated;
revoke all on table private.interview_memberships from public, anon, authenticated;

-- These narrowly scoped definer functions read only server-managed control-plane
-- rows. They reject unauthenticated callers and never consult user-editable JWT metadata.
create or replace function private.active_interview_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.interview_id
  from private.interview_memberships as m
  join private.interviews as i on i.id = m.interview_id
  where auth.uid() is not null
    and m.user_id = auth.uid()
    and m.state = 'active'
    and i.state = 'active'
    and not i.is_seed
  limit 1;
$$;

create or replace function private.can_access_interview(p_interview_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_interview_id is not null
    and (
      p_interview_id = private.active_interview_id()
      or (
        private.active_interview_id() is not null
        and exists (
          select 1
          from private.interviews as i
          where i.id = p_interview_id
            and i.is_seed
            and i.state = 'active'
        )
      )
    );
$$;

create or replace function private.can_write_interview(p_interview_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_interview_id is not null
    and p_interview_id = private.active_interview_id();
$$;

create or replace function private.is_interview_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from private.interview_memberships as m
      join private.interviews as i on i.id = m.interview_id
      where m.user_id = auth.uid()
        and m.state = 'active'
        and m.role = 'admin'
        and i.state = 'active'
        and not i.is_seed
    );
$$;

revoke all on function private.active_interview_id() from public, anon;
revoke all on function private.can_access_interview(uuid) from public, anon;
revoke all on function private.can_write_interview(uuid) from public, anon;
revoke all on function private.is_interview_admin() from public, anon;
grant execute on function private.active_interview_id() to authenticated;
grant execute on function private.can_access_interview(uuid) to authenticated;
grant execute on function private.can_write_interview(uuid) to authenticated;
grant execute on function private.is_interview_admin() to authenticated;
