-- Trusted API processes use this RPC after validating a Supabase JWT.
-- Browser roles cannot execute it; it exposes only an active/inactive result.
create or replace function public.service_has_active_interview_membership(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from private.interview_memberships as m
      join private.interviews as i on i.id = m.interview_id
      where m.user_id = p_user_id
        and m.state = 'active'
        and i.state = 'active'
        and not i.is_seed
    );
$$;

revoke all on function public.service_has_active_interview_membership(uuid)
  from public, anon, authenticated;
grant execute on function public.service_has_active_interview_membership(uuid)
  to service_role;
