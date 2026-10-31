-- Copy anonymized immutable seed content into a fresh interview tenant.
-- Service-role only; refuses to overwrite a non-empty interview.
create or replace function public.clone_interview_seed(p_target uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare seed_id uuid; v_profiles integer; v_decks integer; v_events integer; v_participants integer; v_rounds integer; v_matches integer;
begin
 if auth.uid() is not null then raise exception 'service access required' using errcode='42501'; end if;
 select id into seed_id from private.interviews where is_seed and state='active';
 if seed_id is null then raise exception 'active seed unavailable'; end if;
 if not exists(select 1 from private.interviews where id=p_target and not is_seed and state='active') then raise exception 'active interview target required'; end if;
 if exists(select 1 from public.events where interview_id=p_target) or exists(select 1 from public.profiles where interview_id=p_target) then raise exception 'target already has data'; end if;
 create temporary table pg_temp.interview_seed_event_map(old_id uuid primary key,new_id uuid not null) on commit drop;
 create temporary table pg_temp.interview_seed_round_map(old_id uuid primary key,new_id uuid not null) on commit drop;
 insert into pg_temp.interview_seed_event_map select id,gen_random_uuid() from public.events where interview_id=seed_id;
 insert into pg_temp.interview_seed_round_map select id,gen_random_uuid() from public.event_rounds where interview_id=seed_id;
 insert into public.profiles(interview_id,id,created_at,user_id,display_name,role,avatar_id)
 select p_target,gen_random_uuid(),created_at,user_id,display_name,'user',avatar_id from public.profiles where interview_id=seed_id;
 get diagnostics v_profiles=row_count;
 insert into public.decks(interview_id,id,created_at,user_id,name,cards,token_deck,thumbnail_card_id,updated_at,game,side_deck,is_public,description,tags,posted_at,content_updated_at)
 select p_target,gen_random_uuid(),created_at,user_id,name,cards,token_deck,thumbnail_card_id,updated_at,game,side_deck,is_public,description,tags,posted_at,content_updated_at from public.decks where interview_id=seed_id;
 get diagnostics v_decks=row_count;
 insert into public.events(interview_id,id,name,date,status,format,match_type,max_rounds,current_round,created_by,created_at,deck_count,game)
 select p_target,m.new_id,e.name,e.date,e.status,e.format,e.match_type,e.max_rounds,e.current_round,e.created_by,e.created_at,e.deck_count,e.game
 from public.events e join pg_temp.interview_seed_event_map m on m.old_id=e.id where e.interview_id=seed_id;
 get diagnostics v_events=row_count;
 insert into public.event_participants(interview_id,id,event_id,user_id,deck_name,deck_data,token_deck,registered_at,deck_name_2,deck_data_2,token_deck_2)
 select p_target,gen_random_uuid(),em.new_id,p.user_id,p.deck_name,p.deck_data,p.token_deck,p.registered_at,p.deck_name_2,p.deck_data_2,p.token_deck_2
 from public.event_participants p join pg_temp.interview_seed_event_map em on em.old_id=p.event_id where p.interview_id=seed_id;
 get diagnostics v_participants=row_count;
 insert into public.event_rounds(interview_id,id,event_id,round_number,status,created_at)
 select p_target,rm.new_id,em.new_id,r.round_number,r.status,r.created_at from public.event_rounds r
 join pg_temp.interview_seed_round_map rm on rm.old_id=r.id join pg_temp.interview_seed_event_map em on em.old_id=r.event_id where r.interview_id=seed_id;
 get diagnostics v_rounds=row_count;
 insert into public.round_matches(interview_id,id,round_id,event_id,player1_id,player2_id,winner_id,is_draw,player1_reported,player2_reported,status,created_at,games,table_number)
 select p_target,gen_random_uuid(),rm.new_id,em.new_id,m.player1_id,m.player2_id,m.winner_id,m.is_draw,m.player1_reported,m.player2_reported,m.status,m.created_at,m.games,m.table_number
 from public.round_matches m join pg_temp.interview_seed_round_map rm on rm.old_id=m.round_id
 join pg_temp.interview_seed_event_map em on em.old_id=m.event_id where m.interview_id=seed_id;
 get diagnostics v_matches=row_count;
 return jsonb_build_object('profiles',v_profiles,'decks',v_decks,'events',v_events,'participants',v_participants,'rounds',v_rounds,'matches',v_matches);
end;
$$;
revoke all on function public.clone_interview_seed(uuid) from public,anon,authenticated;
grant execute on function public.clone_interview_seed(uuid) to service_role;
