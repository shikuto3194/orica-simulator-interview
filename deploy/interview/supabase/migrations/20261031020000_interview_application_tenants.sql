-- Shared interview schema only. Never apply to production Supabase.
-- No production RLS policy or Auth identity is copied.

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end; $$;

create table public.profiles (
 id uuid primary key default gen_random_uuid(), interview_id uuid not null references private.interviews(id) on delete cascade,
 created_at timestamptz not null default now(), user_id uuid not null,
 display_name text check(display_name is null or char_length(display_name)<=30),
 role text not null default 'user' check(role in ('user','admin')), avatar_id text,
 unique(interview_id,user_id), unique(interview_id,id));
create table public.decks (
 id uuid primary key default gen_random_uuid(), interview_id uuid not null references private.interviews(id) on delete cascade,
 created_at timestamptz not null default now(), user_id uuid not null, name text not null,
 cards jsonb not null default '[]', token_deck jsonb not null default '[]', thumbnail_card_id bigint,
 updated_at timestamptz not null default now(), game text not null default 'bs', side_deck jsonb not null default '[]',
 is_public boolean not null default false, description text, tags text[] not null default '{}', posted_at timestamptz,
 content_updated_at timestamptz, unique(interview_id,user_id,game,name), unique(interview_id,id));
create index decks_interview_user_game_idx on public.decks(interview_id,user_id,game);
create index decks_interview_public_recent_idx on public.decks(interview_id,game,coalesce(content_updated_at,posted_at) desc) where is_public;
create table public.events (
 id uuid primary key default gen_random_uuid(), interview_id uuid not null references private.interviews(id) on delete cascade,
 name text not null, date date not null default current_date, status text not null default 'recruiting',
 format text not null default 'swiss', match_type text not null default 'bo1', max_rounds integer not null default 3,
 current_round integer not null default 0, created_by uuid not null, created_at timestamptz not null default now(),
 deck_count integer not null default 1, game text not null default 'bs', unique(interview_id,id));
create index events_interview_game_date_idx on public.events(interview_id,game,date desc);
create table public.event_participants (
 id uuid primary key default gen_random_uuid(), interview_id uuid not null references private.interviews(id) on delete cascade,
 event_id uuid not null, user_id uuid not null, deck_name text, deck_data jsonb not null default '[]',
 token_deck jsonb not null default '[]', registered_at timestamptz not null default now(), deck_name_2 text,
 deck_data_2 jsonb not null default '[]', token_deck_2 jsonb not null default '[]',
 unique(interview_id,event_id,user_id), unique(interview_id,id),
 foreign key(interview_id,event_id) references public.events(interview_id,id) on delete cascade);
create table public.event_rounds (
 id uuid primary key default gen_random_uuid(), interview_id uuid not null references private.interviews(id) on delete cascade,
 event_id uuid not null, round_number integer not null, status text not null default 'pending',
 created_at timestamptz not null default now(), unique(interview_id,event_id,round_number), unique(interview_id,id),
 foreign key(interview_id,event_id) references public.events(interview_id,id) on delete cascade);
create table public.round_matches (
 id uuid primary key default gen_random_uuid(), interview_id uuid not null references private.interviews(id) on delete cascade,
 round_id uuid not null, event_id uuid not null, player1_id uuid not null, player2_id uuid, winner_id uuid,
 is_draw boolean default false, player1_reported uuid, player2_reported uuid, status text not null default 'pending',
 created_at timestamptz not null default now(), games jsonb not null default '[]', table_number integer,
 unique(interview_id,id), foreign key(interview_id,event_id) references public.events(interview_id,id) on delete cascade,
 foreign key(interview_id,round_id) references public.event_rounds(interview_id,id) on delete cascade);
create index round_matches_interview_event_idx on public.round_matches(interview_id,event_id);
create table public.preview_cards (
 id uuid primary key default gen_random_uuid(), interview_id uuid not null references private.interviews(id) on delete cascade,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), game text not null default 'acg',
 source_type text not null check(source_type in ('x_url','x_upload','x_paste')), source_url text,
 permanent_image_url text not null, card_data jsonb not null default '{}', confidence jsonb,
 status text not null default 'pending' check(status in ('auto_approved','pending','rejected','superseded')),
 reviewed_by uuid, reviewed_at timestamptz, superseded_by_card_number text, source_post_url text,
 notes text, display_label text, tentative_card_number text, unique(interview_id,id));
create trigger preview_cards_set_updated_at before update on public.preview_cards for each row execute function public.set_updated_at();
create table public.acg_pack_seen (interview_id uuid not null references private.interviews(id) on delete cascade,
 prefix text not null, first_seen_at timestamptz not null default now(), primary key(interview_id,prefix));

create table public.rooms (
 id text not null, interview_id uuid not null references private.interviews(id) on delete cascade,
 players jsonb not null default '[]', state jsonb, state_version integer not null default 0, scenario_id text,
 connected jsonb not null default '{}', all_disconnected_at timestamptz, created_at timestamptz not null default now(),
 spectator_mode text not null default 'private' check(spectator_mode in ('private','public_link')),
 last_heartbeat jsonb not null default '{}', primary key(interview_id,id), unique(id));
create index rooms_interview_disconnected_idx on public.rooms(interview_id,all_disconnected_at) where all_disconnected_at is not null;
create table public.replay_events (
 id bigserial primary key, interview_id uuid not null references private.interviews(id) on delete cascade,
 room_id text not null, state_version integer not null, acting_player_id text not null,
 endpoint text not null check(endpoint in ('action','step','claim-victory','core-move','brave-separation','pregame-update','replay-restore')),
 payload jsonb not null, created_at timestamptz not null default now(), client_mutation_id text,
 foreign key(interview_id,room_id) references public.rooms(interview_id,id) on delete cascade);
create unique index replay_events_interview_room_version_uq on public.replay_events(interview_id,room_id,state_version);
create unique index replay_events_interview_mutation_uq on public.replay_events(interview_id,room_id,client_mutation_id) where client_mutation_id is not null;
create index replay_events_interview_room_created_idx on public.replay_events(interview_id,room_id,created_at);
create table public.snapshots (
 id uuid primary key default gen_random_uuid(), interview_id uuid not null references private.interviews(id) on delete cascade,
 owner_user_id uuid, room_id text, from_version integer, to_version integer, label text,
 origin text not null default 'manual' check(origin in ('scenario','room','manual')), state jsonb not null,
 is_public boolean not null default false, created_at timestamptz not null default now(), is_server_checkpoint boolean not null default false,
 unique(interview_id,id), foreign key(interview_id,room_id) references public.rooms(interview_id,id) on delete set null (room_id));
create index snapshots_interview_owner_created_idx on public.snapshots(interview_id,owner_user_id,created_at desc) where owner_user_id is not null;
create index snapshots_interview_public_created_idx on public.snapshots(interview_id,created_at desc) where is_public;
create index snapshots_interview_room_idx on public.snapshots(interview_id,room_id,to_version) where room_id is not null;
create table public.room_invitations (
 id uuid primary key default gen_random_uuid(), interview_id uuid not null references private.interviews(id) on delete cascade,
 room_id text not null, sender_id uuid not null references auth.users(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '24 hours'), read_at timestamptz, accepted_at timestamptz,
 push_processed_at timestamptz, push_attempts integer not null default 0, next_push_attempt_at timestamptz not null default now(),
 unique(interview_id,id), unique(interview_id,room_id,recipient_id), check(sender_id<>recipient_id),
 foreign key(interview_id,room_id) references public.rooms(interview_id,id) on delete cascade);
create index room_invitations_interview_recipient_idx on public.room_invitations(interview_id,recipient_id,created_at desc);
create table public.room_mutation_cancellations (
 interview_id uuid not null references private.interviews(id) on delete cascade, room_id text not null,
 client_mutation_id text not null, acting_player_id text not null, created_at timestamptz not null default now(),
 request_fingerprint text, primary key(interview_id,room_id,client_mutation_id,acting_player_id),
 foreign key(interview_id,room_id) references public.rooms(interview_id,id) on delete cascade);
create table public.room_network_contract (
 interview_id uuid not null references private.interviews(id) on delete cascade, signature text not null,
 source_hash text not null, primary key(interview_id,signature));
create table public.room_push_subscriptions (
 interview_id uuid not null references private.interviews(id) on delete cascade, endpoint text not null check(length(endpoint)<=2048),
 user_id uuid not null references auth.users(id) on delete cascade, p256dh text not null, auth text not null,
 updated_at timestamptz not null default now(), delivery_channel text not null default 'browser' check(delivery_channel in ('pwa','app','browser')),
 primary key(interview_id,endpoint));
create index room_push_subscriptions_interview_user_idx on public.room_push_subscriptions(interview_id,user_id);

create table public.operation_notices (
 interview_id uuid not null references private.interviews(id) on delete cascade, day date not null,
 title text not null check(char_length(title) between 1 and 100), introduction text not null check(char_length(introduction) between 1 and 400),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 20),
 published_at timestamptz not null default now(), primary key(interview_id,day));
create table public.operation_notice_reads (
 interview_id uuid not null references private.interviews(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 notice_day date not null, primary key(interview_id,user_id,notice_day),
 foreign key(interview_id,notice_day) references public.operation_notices(interview_id,day) on delete cascade);
create table public.operation_notice_digest_state (
 interview_id uuid primary key references private.interviews(id) on delete cascade,
 start_day date not null default ((now() at time zone 'Asia/Tokyo')::date-1), last_day date,
 through_revision text check(through_revision is null or through_revision ~ '^[0-9a-f]{40}$'), evidence jsonb not null default '{}');

create or replace function private.assign_active_interview_id() returns trigger
language plpgsql set search_path = '' as $$ begin
 if tg_op='INSERT' and auth.uid() is not null then new.interview_id:=private.active_interview_id();
 elsif tg_op='UPDATE' and new.interview_id is distinct from old.interview_id then raise exception 'interview_id cannot be changed' using errcode='42501';
 elsif tg_op='INSERT' and new.interview_id is null then raise exception 'interview_id is required' using errcode='23502'; end if;
 return new; end; $$;
create or replace function private.protect_profile_role() returns trigger
language plpgsql set search_path = '' as $$ begin
 if tg_op='INSERT' and auth.uid() is not null then new.role:=case when private.is_interview_admin() then 'admin' else 'user' end;
 elsif tg_op='UPDATE' and new.role is distinct from old.role then raise exception 'role is managed by interview membership' using errcode='42501'; end if;
 return new; end; $$;
create trigger assign_interview_id_profiles before insert or update on public.profiles for each row execute function private.assign_active_interview_id();
create trigger protect_profile_role before insert or update on public.profiles for each row execute function private.protect_profile_role();
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select private.is_interview_admin(); $$;

-- Orika deck library RPC: single interview account, no cross-account linking.
create or replace function private.bs_deck_context() returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('user_id',auth.uid(),'owner_id',auth.uid(),'scope_key',auth.uid()::text||':'||private.active_interview_id()::text,'shared',false); $$;
create or replace function private.bs_deck_library(p_action text,p_scope text default null,p_deck jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ctx jsonb; tenant uuid; actor uuid; deck_name text; deck_id uuid;
begin
 actor:=auth.uid(); tenant:=private.active_interview_id();
 if actor is null or tenant is null then raise exception 'Interview access required' using errcode='42501'; end if;
 ctx:=private.bs_deck_context();
 if p_action='list' then return ctx||jsonb_build_object('decks',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from public.decks d where d.interview_id=tenant and d.user_id=actor and d.game='bs'),'[]'::jsonb)); end if;
 if p_scope is distinct from ctx->>'scope_key' then raise exception 'Deck scope changed' using errcode='40001'; end if;
 if jsonb_typeof(p_deck) is distinct from 'object' or jsonb_typeof(p_deck->'name') is distinct from 'string' then raise exception 'Invalid deck'; end if;
 deck_name:=trim(p_deck->>'name'); if deck_name='' or char_length(deck_name)>100 then raise exception 'Invalid deck name'; end if;
 if p_action='delete' then delete from public.decks where interview_id=tenant and user_id=actor and game='bs' and name=deck_name;
 elsif p_action='save' then
  if jsonb_typeof(p_deck->'cards') is distinct from 'array' or jsonb_typeof(coalesce(p_deck->'token_deck','[]'))<>'array' then raise exception 'Invalid deck data'; end if;
  select id into deck_id from public.decks where interview_id=tenant and user_id=actor and game='bs' and name=deck_name limit 1;
  if deck_id is null then insert into public.decks(interview_id,user_id,game,name,cards,token_deck,thumbnail_card_id) values(tenant,actor,'bs',deck_name,p_deck->'cards',coalesce(p_deck->'token_deck','[]'),nullif(p_deck->>'thumbnail_card_id','')::bigint);
  else update public.decks set cards=p_deck->'cards',token_deck=coalesce(p_deck->'token_deck','[]'),thumbnail_card_id=nullif(p_deck->>'thumbnail_card_id','')::bigint,updated_at=now() where interview_id=tenant and user_id=actor and game='bs' and id=deck_id; end if;
 else raise exception 'Unknown deck operation'; end if; return ctx;
end; $$;
create or replace function public.bs_deck_library(p_action text,p_scope text default null,p_deck jsonb default null) returns jsonb
language sql set search_path = '' as $$ select private.bs_deck_library(p_action,p_scope,p_deck); $$;
revoke all on function private.bs_deck_context() from public,anon;
revoke all on function private.bs_deck_library(text,text,jsonb) from public,anon;
revoke all on function public.bs_deck_library(text,text,jsonb) from public,anon;
grant execute on function private.bs_deck_context() to authenticated;
grant execute on function private.bs_deck_library(text,text,jsonb) to authenticated;
grant execute on function public.bs_deck_library(text,text,jsonb) to authenticated;
revoke all on function public.is_admin() from public,anon;
grant execute on function public.is_admin() to authenticated;

-- All interview tables are default-deny until each narrow policy below applies.
do $$ declare t text; begin foreach t in array array[
 'profiles','decks','events','event_participants','event_rounds','round_matches','preview_cards','acg_pack_seen','rooms','replay_events','snapshots','room_invitations','room_mutation_cancellations','room_network_contract','room_push_subscriptions','operation_notices','operation_notice_reads','operation_notice_digest_state'
] loop execute format('alter table public.%I enable row level security',t); execute format('alter table public.%I force row level security',t); execute format('revoke all on table public.%I from public,anon',t); execute format('grant select,insert,update,delete on table public.%I to authenticated,service_role',t); end loop; end $$;

create policy interview_profiles_select on public.profiles for select to authenticated using((select private.can_access_interview(interview_id)));
create policy interview_profiles_insert on public.profiles for insert to authenticated with check((select private.can_write_interview(interview_id)) and user_id=auth.uid());
create policy interview_profiles_update on public.profiles for update to authenticated using((select private.can_write_interview(interview_id)) and user_id=auth.uid()) with check((select private.can_write_interview(interview_id)) and user_id=auth.uid());
create policy interview_decks_select on public.decks for select to authenticated using((select private.can_access_interview(interview_id)) and (user_id=auth.uid() or is_public or (select private.is_interview_admin())));
create policy interview_decks_insert on public.decks for insert to authenticated with check((select private.can_write_interview(interview_id)) and user_id=auth.uid());
create policy interview_decks_update on public.decks for update to authenticated using((select private.can_write_interview(interview_id)) and user_id=auth.uid()) with check((select private.can_write_interview(interview_id)) and user_id=auth.uid());
create policy interview_decks_delete on public.decks for delete to authenticated using((select private.can_write_interview(interview_id)) and user_id=auth.uid());
create policy interview_events_select on public.events for select to authenticated using((select private.can_access_interview(interview_id)));
create policy interview_events_admin_insert on public.events for insert to authenticated with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()) and created_by=auth.uid());
create policy interview_events_admin_update on public.events for update to authenticated using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin())) with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_events_admin_delete on public.events for delete to authenticated using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_participants_select on public.event_participants for select to authenticated using((select private.can_access_interview(interview_id)));
create policy interview_participants_insert on public.event_participants for insert to authenticated with check((select private.can_write_interview(interview_id)) and (user_id=auth.uid() or (select private.is_interview_admin())));
create policy interview_participants_update on public.event_participants for update to authenticated using((select private.can_write_interview(interview_id)) and (user_id=auth.uid() or (select private.is_interview_admin()))) with check((select private.can_write_interview(interview_id)) and (user_id=auth.uid() or (select private.is_interview_admin())));
create policy interview_participants_delete on public.event_participants for delete to authenticated using((select private.can_write_interview(interview_id)) and (user_id=auth.uid() or (select private.is_interview_admin())));
create policy interview_rounds_select on public.event_rounds for select to authenticated using((select private.can_access_interview(interview_id)));
create policy interview_rounds_admin_all on public.event_rounds for all to authenticated using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin())) with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_matches_select on public.round_matches for select to authenticated using((select private.can_access_interview(interview_id)));
create policy interview_matches_insert on public.round_matches for insert to authenticated with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_matches_update on public.round_matches for update to authenticated using((select private.can_write_interview(interview_id)) and (player1_id=auth.uid() or player2_id=auth.uid() or (select private.is_interview_admin()))) with check((select private.can_write_interview(interview_id)) and (player1_id=auth.uid() or player2_id=auth.uid() or (select private.is_interview_admin())));
create policy interview_matches_delete on public.round_matches for delete to authenticated using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_preview_select on public.preview_cards for select to authenticated using((select private.can_access_interview(interview_id)) and (status='auto_approved' or (select private.is_interview_admin())));
create policy interview_preview_admin_all on public.preview_cards for all to authenticated using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin())) with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_rooms_select on public.rooms for select to authenticated using((select private.can_access_interview(interview_id)));
create policy interview_rooms_admin_all on public.rooms for all to service_role using(true) with check(true);
create policy interview_replay_admin_all on public.replay_events for all to service_role using(true) with check(true);
create policy interview_snapshots_select on public.snapshots for select to authenticated using((select private.can_access_interview(interview_id)) and (owner_user_id=auth.uid() or is_public or (select private.is_interview_admin())));
create policy interview_snapshots_insert on public.snapshots for insert to authenticated with check((select private.can_write_interview(interview_id)) and (owner_user_id=auth.uid() or (select private.is_interview_admin())));
create policy interview_snapshots_update on public.snapshots for update to authenticated using((select private.can_write_interview(interview_id)) and owner_user_id=auth.uid()) with check((select private.can_write_interview(interview_id)) and owner_user_id=auth.uid());
create policy interview_snapshots_delete on public.snapshots for delete to authenticated using((select private.can_write_interview(interview_id)) and (owner_user_id=auth.uid() or (select private.is_interview_admin())));
create policy interview_invitations_server_only on public.room_invitations for all to service_role using(true) with check(true);
create policy interview_cancellations_server_only on public.room_mutation_cancellations for all to service_role using(true) with check(true);
create policy interview_contract_server_only on public.room_network_contract for all to service_role using(true) with check(true);
create policy interview_push_server_only on public.room_push_subscriptions for all to service_role using(true) with check(true);
create policy interview_notices_select on public.operation_notices for select to authenticated using((select private.can_access_interview(interview_id)));
create policy interview_notice_reads_all on public.operation_notice_reads for all to authenticated using((select private.can_write_interview(interview_id)) and user_id=auth.uid()) with check((select private.can_write_interview(interview_id)) and user_id=auth.uid());
create policy interview_notice_digest_admin on public.operation_notice_digest_state for all to authenticated using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin())) with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));

-- These tables have no client policy: acg_pack_seen is build-service only.
