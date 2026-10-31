-- BS only. ACG decks and login identities are never merged.
-- Applied 2026-09-17; filename matches the Supabase migration history version.
-- ON destroys the sub's old BS library; OFF forks the current shared library.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table private.bs_account_links (
  manager_id uuid primary key references auth.users(id),
  main_id uuid not null references auth.users(id),
  sub_id uuid not null references auth.users(id),
  account_enabled boolean not null default false,
  deck_enabled boolean not null default false,
  revision uuid not null default gen_random_uuid(),
  check (main_id <> sub_id),
  check (manager_id in (main_id, sub_id))
);
alter table private.bs_account_links enable row level security;
revoke all on private.bs_account_links from public, anon, authenticated;
create table private.bs_deck_epochs (
  user_id uuid primary key references auth.users(id),
  revision uuid not null default gen_random_uuid()
);
alter table private.bs_deck_epochs enable row level security;
revoke all on private.bs_deck_epochs from public, anon, authenticated;

-- profiles.role is the existing authority for admin UI and RPC access.
-- Protect it before granting administrators access to another account's decks.
create function private.protect_profile_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (TG_OP = 'INSERT' and coalesce(new.role, 'user') <> 'user')
       or (TG_OP = 'UPDATE' and new.role is distinct from old.role) then
      raise exception '管理者権限はプロフィールから変更できません' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
alter table public.profiles alter column role set default 'user';
create trigger protect_profile_role before insert or update on public.profiles
for each row execute function private.protect_profile_role();

create function private.bs_deck_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  link private.bs_account_links;
  owner_id uuid;
begin
  if actor is null then raise exception 'ログインが必要です' using errcode = '42501'; end if;
  select * into link from private.bs_account_links
    where actor in (main_id, sub_id);
  owner_id := case when link.account_enabled and link.deck_enabled then link.main_id else actor end;
  return jsonb_build_object(
    'user_id', actor, 'owner_id', owner_id,
    'scope_key', owner_id::text || ':' || coalesce((select revision::text from private.bs_deck_epochs where user_id = actor), 'personal'),
    'shared', coalesce(link.account_enabled and link.deck_enabled, false)
  );
end;
$$;

-- One private implementation, with authenticated public invoker wrappers below.
create function private.bs_admin_account_link(p_settings jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous private.bs_account_links;
  current_link private.bs_account_links;
  main_uid uuid;
  sub_uid uuid;
  account_on boolean;
  deck_on boolean;
  was_shared boolean;
  will_share boolean;
  swapping boolean;
begin
  if actor is null or not exists (
    select 1 from public.profiles where user_id = actor and role = 'admin'
  ) then raise exception '管理者権限が必要です' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(734645);
  select * into previous from private.bs_account_links where manager_id = actor;
  if p_settings is not null then
    if (p_settings->>'revision') is distinct from previous.revision::text then
      raise exception '設定が変更されています。再読み込みしてください' using errcode = '40001';
    end if;
    select id into main_uid from auth.users where lower(email) = lower(trim(p_settings->>'main_email'));
    select id into sub_uid from auth.users where lower(email) = lower(trim(p_settings->>'sub_email'));
    if main_uid is null or sub_uid is null then raise exception '登録済みのメールアドレスを指定してください'; end if;
    if main_uid = sub_uid then raise exception 'メインとサブには別のアカウントを指定してください'; end if;
    if actor not in (main_uid, sub_uid) then raise exception 'ログイン中の管理者をメインまたはサブに指定してください'; end if;
    if exists (select 1 from private.bs_account_links where manager_id <> actor
      and (main_id in (main_uid, sub_uid) or sub_id in (main_uid, sub_uid))) then
      raise exception '別の管理者の連携設定で使用中です';
    end if;
    account_on := coalesce((p_settings->>'account_enabled')::boolean, false);
    deck_on := coalesce((p_settings->>'deck_enabled')::boolean, false);
    was_shared := coalesce(previous.account_enabled and previous.deck_enabled, false);
    will_share := account_on and deck_on;
    swapping := was_shared and will_share and previous.main_id = sub_uid and previous.sub_id = main_uid;
    if swapping then
      -- Changing which of the same two accounts is main transfers the shared library.
      delete from public.decks where user_id = main_uid and game = 'bs';
      update public.decks set user_id = main_uid where user_id = previous.main_id and game = 'bs';
    else
      if was_shared and (not will_share or previous.main_id <> main_uid or previous.sub_id <> sub_uid) then
        -- Split: copy today's data. No archive of the sub's pre-link data exists.
        delete from public.decks where user_id = previous.sub_id and game = 'bs';
        insert into public.decks (user_id, game, name, cards, token_deck, thumbnail_card_id,
          side_deck, is_public, description, tags, posted_at, content_updated_at)
        select previous.sub_id, game, name, cards, token_deck, thumbnail_card_id,
          side_deck, false, description, tags, null, content_updated_at
        from public.decks where user_id = previous.main_id and game = 'bs';
      end if;
      if will_share and (not was_shared or previous.main_id <> main_uid or previous.sub_id <> sub_uid) then
        delete from public.decks where user_id = sub_uid and game = 'bs';
      end if;
    end if;
    insert into private.bs_account_links (manager_id, main_id, sub_id, account_enabled, deck_enabled)
    values (actor, main_uid, sub_uid, account_on, deck_on)
    on conflict (manager_id) do update set main_id = excluded.main_id, sub_id = excluded.sub_id,
      account_enabled = excluded.account_enabled, deck_enabled = excluded.deck_enabled, revision = gen_random_uuid();
    insert into private.bs_deck_epochs (user_id)
      select distinct uid from unnest(array[main_uid, sub_uid, previous.main_id, previous.sub_id]) uid where uid is not null
      on conflict (user_id) do update set revision = gen_random_uuid();
  end if;
  select * into current_link from private.bs_account_links where manager_id = actor;
  return jsonb_build_object(
    'main_email', coalesce((select email from auth.users where id = current_link.main_id),
                          (select email from auth.users where id = actor)),
    'sub_email', coalesce((select email from auth.users where id = current_link.sub_id), ''),
    'account_enabled', coalesce(current_link.account_enabled, false),
    'deck_enabled', coalesce(current_link.deck_enabled, false),
    'revision', current_link.revision
  );
end;
$$;

create function private.bs_deck_library(p_action text, p_scope text default null, p_deck jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
  owner_uid uuid;
  deck_id uuid;
  deck_name text;
begin
  if auth.uid() is null then raise exception 'ログインが必要です' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(734645);
  context := private.bs_deck_context();
  owner_uid := (context->>'owner_id')::uuid;
  if p_action = 'list' then
    return context || jsonb_build_object('decks', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.created_at, d.id)
      from public.decks d where user_id = owner_uid and game = 'bs'
    ), '[]'::jsonb));
  end if;
  if p_scope is distinct from context->>'scope_key' then
    raise exception 'デッキ連携設定が変更されています。再読み込みしてから保存してください' using errcode = '40001';
  end if;
  deck_name := trim(p_deck->>'name');
  if coalesce(deck_name, '') = '' then raise exception 'デッキ名を入力してください'; end if;
  if p_action = 'delete' then
    delete from public.decks where user_id = owner_uid and game = 'bs' and name = deck_name;
  elsif p_action = 'save' then
    if jsonb_typeof(p_deck->'cards') is distinct from 'array'
       or jsonb_typeof(coalesce(p_deck->'token_deck', '[]')) <> 'array' then
      raise exception 'デッキ形式が不正です';
    end if;
    select id into deck_id from public.decks where user_id = owner_uid and game = 'bs' and name = deck_name
      order by created_at, id limit 1;
    if deck_id is null then
      insert into public.decks (user_id, game, name, cards, token_deck, thumbnail_card_id)
      values (owner_uid, 'bs', deck_name, p_deck->'cards', coalesce(p_deck->'token_deck', '[]'),
              (p_deck->>'thumbnail_card_id')::bigint);
    else
      update public.decks set cards = p_deck->'cards', token_deck = coalesce(p_deck->'token_deck', '[]'),
        thumbnail_card_id = (p_deck->>'thumbnail_card_id')::bigint, updated_at = now()
      where id = deck_id;
      delete from public.decks where user_id = owner_uid and game = 'bs' and name = deck_name and id <> deck_id;
    end if;
  else raise exception '不明なデッキ操作です';
  end if;
  return context;
end;
$$;

-- Restrictive RLS guards direct clients without weakening existing public-deck policies.
create policy bs_linked_insert_guard on public.decks as restrictive for insert to authenticated
  with check (game <> 'bs' or user_id = (private.bs_deck_context()->>'owner_id')::uuid);
create policy bs_linked_update_guard on public.decks as restrictive for update to authenticated
  using (game <> 'bs' or user_id = (private.bs_deck_context()->>'owner_id')::uuid)
  with check (game <> 'bs' or user_id = (private.bs_deck_context()->>'owner_id')::uuid);
create policy bs_linked_delete_guard on public.decks as restrictive for delete to authenticated
  using (game <> 'bs' or user_id = (private.bs_deck_context()->>'owner_id')::uuid);

create function public.bs_admin_account_link(p_settings jsonb default null) returns jsonb
language sql security invoker set search_path = '' as $$ select private.bs_admin_account_link(p_settings); $$;
create function public.bs_deck_library(p_action text, p_scope text default null, p_deck jsonb default null) returns jsonb
language sql security invoker set search_path = '' as $$ select private.bs_deck_library(p_action, p_scope, p_deck); $$;

revoke all on function private.protect_profile_role() from public, anon, authenticated;
revoke all on function private.bs_deck_context() from public, anon;
revoke all on function private.bs_admin_account_link(jsonb) from public, anon;
revoke all on function private.bs_deck_library(text, text, jsonb) from public, anon;
revoke all on function public.bs_admin_account_link(jsonb) from public, anon;
revoke all on function public.bs_deck_library(text, text, jsonb) from public, anon;
grant execute on function private.bs_deck_context(), private.bs_admin_account_link(jsonb),
  private.bs_deck_library(text, text, jsonb), public.bs_admin_account_link(jsonb),
  public.bs_deck_library(text, text, jsonb) to authenticated;
