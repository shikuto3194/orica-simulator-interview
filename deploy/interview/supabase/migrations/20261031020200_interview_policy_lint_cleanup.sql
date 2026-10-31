drop policy interview_snapshots_select on public.snapshots;
create policy interview_snapshots_select on public.snapshots for select to authenticated
using((select private.can_access_interview(interview_id)) and (owner_user_id=(select auth.uid()) or is_public or (select private.is_interview_admin())));
create policy interview_acg_pack_seen_service on public.acg_pack_seen for all to service_role using(true) with check(true);
grant usage,select on sequence public.replay_events_id_seq to service_role;
