-- Performance and lint follow-up for interview_application_tenants.
create index operation_notice_reads_interview_day_idx on public.operation_notice_reads(interview_id,notice_day);
create index operation_notice_reads_user_idx on public.operation_notice_reads(user_id);
create index room_invitations_recipient_user_idx on public.room_invitations(recipient_id);
create index room_invitations_sender_user_idx on public.room_invitations(sender_id);
create index room_push_subscriptions_user_idx on public.room_push_subscriptions(user_id);
create index round_matches_interview_round_idx on public.round_matches(interview_id,round_id);

create or replace function public.is_admin() returns boolean
language sql stable security invoker set search_path = '' as $$ select private.is_interview_admin(); $$;

-- Keep auth.uid() and membership helper evaluation statement-scoped in RLS.
drop policy interview_profiles_insert on public.profiles;
drop policy interview_profiles_update on public.profiles;
create policy interview_profiles_insert on public.profiles for insert to authenticated
with check((select private.can_write_interview(interview_id)) and user_id=(select auth.uid()));
create policy interview_profiles_update on public.profiles for update to authenticated
using((select private.can_write_interview(interview_id)) and user_id=(select auth.uid()))
with check((select private.can_write_interview(interview_id)) and user_id=(select auth.uid()));

drop policy interview_decks_select on public.decks;
drop policy interview_decks_insert on public.decks;
drop policy interview_decks_update on public.decks;
drop policy interview_decks_delete on public.decks;
create policy interview_decks_select on public.decks for select to authenticated
using((select private.can_access_interview(interview_id)) and (user_id=(select auth.uid()) or is_public or (select private.is_interview_admin())));
create policy interview_decks_insert on public.decks for insert to authenticated
with check((select private.can_write_interview(interview_id)) and user_id=(select auth.uid()));
create policy interview_decks_update on public.decks for update to authenticated
using((select private.can_write_interview(interview_id)) and user_id=(select auth.uid()))
with check((select private.can_write_interview(interview_id)) and user_id=(select auth.uid()));
create policy interview_decks_delete on public.decks for delete to authenticated
using((select private.can_write_interview(interview_id)) and user_id=(select auth.uid()));

drop policy interview_events_admin_insert on public.events;
create policy interview_events_admin_insert on public.events for insert to authenticated
with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()) and created_by=(select auth.uid()));

drop policy interview_participants_insert on public.event_participants;
drop policy interview_participants_update on public.event_participants;
drop policy interview_participants_delete on public.event_participants;
create policy interview_participants_insert on public.event_participants for insert to authenticated
with check((select private.can_write_interview(interview_id)) and (user_id=(select auth.uid()) or (select private.is_interview_admin())));
create policy interview_participants_update on public.event_participants for update to authenticated
using((select private.can_write_interview(interview_id)) and (user_id=(select auth.uid()) or (select private.is_interview_admin())))
with check((select private.can_write_interview(interview_id)) and (user_id=(select auth.uid()) or (select private.is_interview_admin())));
create policy interview_participants_delete on public.event_participants for delete to authenticated
using((select private.can_write_interview(interview_id)) and (user_id=(select auth.uid()) or (select private.is_interview_admin())));

drop policy interview_rounds_admin_all on public.event_rounds;
create policy interview_rounds_admin_insert on public.event_rounds for insert to authenticated
with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_rounds_admin_update on public.event_rounds for update to authenticated
using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()))
with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_rounds_admin_delete on public.event_rounds for delete to authenticated
using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));

drop policy interview_matches_update on public.round_matches;
create policy interview_matches_update on public.round_matches for update to authenticated
using((select private.can_write_interview(interview_id)) and (player1_id=(select auth.uid()) or player2_id=(select auth.uid()) or (select private.is_interview_admin())))
with check((select private.can_write_interview(interview_id)) and (player1_id=(select auth.uid()) or player2_id=(select auth.uid()) or (select private.is_interview_admin())));

drop policy interview_preview_admin_all on public.preview_cards;
create policy interview_preview_admin_insert on public.preview_cards for insert to authenticated
with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_preview_admin_update on public.preview_cards for update to authenticated
using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()))
with check((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));
create policy interview_preview_admin_delete on public.preview_cards for delete to authenticated
using((select private.can_write_interview(interview_id)) and (select private.is_interview_admin()));

drop policy interview_snapshots_insert on public.snapshots;
drop policy interview_snapshots_update on public.snapshots;
drop policy interview_snapshots_delete on public.snapshots;
create policy interview_snapshots_insert on public.snapshots for insert to authenticated
with check((select private.can_write_interview(interview_id)) and (owner_user_id=(select auth.uid()) or (select private.is_interview_admin())));
create policy interview_snapshots_update on public.snapshots for update to authenticated
using((select private.can_write_interview(interview_id)) and owner_user_id=(select auth.uid()))
with check((select private.can_write_interview(interview_id)) and owner_user_id=(select auth.uid()));
create policy interview_snapshots_delete on public.snapshots for delete to authenticated
using((select private.can_write_interview(interview_id)) and (owner_user_id=(select auth.uid()) or (select private.is_interview_admin())));

drop policy interview_notice_reads_all on public.operation_notice_reads;
create policy interview_notice_reads_select on public.operation_notice_reads for select to authenticated
using((select private.can_access_interview(interview_id)) and user_id=(select auth.uid()));
create policy interview_notice_reads_insert on public.operation_notice_reads for insert to authenticated
with check((select private.can_write_interview(interview_id)) and user_id=(select auth.uid()));
create policy interview_notice_reads_delete on public.operation_notice_reads for delete to authenticated
using((select private.can_write_interview(interview_id)) and user_id=(select auth.uid()));
