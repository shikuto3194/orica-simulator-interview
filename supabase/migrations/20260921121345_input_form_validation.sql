-- Input resource limits: paired with apps/playground-web/src/input-validation.ts.
-- 適用日: 2026-09-21 (Supabase MCP migration history: 20260921121345)
-- No existing rows are changed. CHECK validation fails atomically on incompatible data.
-- BS card/deck limits do not change ACG deck storage.
create function private.bs_deck_entries_valid(entries jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  entry jsonb;
  item_count numeric;
  item_id numeric;
  total numeric := 0;
begin
  if jsonb_typeof(entries) is distinct from 'array' then return false; end if;
  if jsonb_array_length(entries) > 1000 or octet_length(entries::text) > 1048576 then
    return false;
  end if;
  for entry in select value from jsonb_array_elements(entries) loop
    if jsonb_typeof(entry) is distinct from 'object'
       or jsonb_typeof(entry->'count') is distinct from 'number'
       or jsonb_typeof(entry->'id') is distinct from 'number' then
      return false;
    end if;
    item_count := (entry->>'count')::numeric;
    item_id := (entry->>'id')::numeric;
    if item_count < 1 or item_count > 1000 or item_count <> trunc(item_count)
       or item_id < 1 or item_id > 9007199254740991 or item_id <> trunc(item_id) then
      return false;
    end if;
    total := total + item_count;
    if total > 1000 then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.bs_deck_entries_valid(jsonb) from public, anon;
grant usage on schema private to service_role;
grant execute on function private.bs_deck_entries_valid(jsonb) to authenticated, service_role;

alter table public.profiles add constraint profiles_display_name_length
  check (display_name is null or char_length(display_name) <= 30);

alter table public.decks add constraint bs_deck_name_valid
  check (game is distinct from 'bs' or
         (name is not null and char_length(name) between 1 and 100 and length(btrim(name)) > 0));
alter table public.decks add constraint bs_deck_cards_valid
  check (game is distinct from 'bs' or private.bs_deck_entries_valid(cards));
alter table public.decks add constraint bs_deck_tokens_valid
  check (game is distinct from 'bs' or private.bs_deck_entries_valid(coalesce(token_deck, '[]'::jsonb)));

create or replace function private.bs_deck_library(p_action text, p_scope text default null, p_deck jsonb default null) returns jsonb
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
  if jsonb_typeof(p_deck) is distinct from 'object'
     or jsonb_typeof(p_deck->'name') is distinct from 'string'
     or char_length(p_deck->>'name') > 100 then
    raise exception 'デッキ名は100文字以内の文字列で指定してください' using errcode = '22023';
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
