-- The control plane is private to server-managed roles. These policies make
-- that boundary explicit while leaving browser roles without table grants.
create policy interviews_service_role_access
  on private.interviews
  for all
  to service_role
  using (true)
  with check (true);

create policy interview_memberships_service_role_access
  on private.interview_memberships
  for all
  to service_role
  using (true)
  with check (true);
