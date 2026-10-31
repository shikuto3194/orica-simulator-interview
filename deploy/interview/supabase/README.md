# Shared interview Supabase

All migrations in this directory target only the interview project ref `ouqvnabeiwjysuvehmrq`. Never apply them to production project `nnthvbizvqpufpfkzlho`.

## Current state

- Project `interview-demo-shared`, `ap-northeast-1`, Free plan.
- Email signup is disabled; verified through the Auth settings API (`disable_signup=true`).
- Tenant `interview-001`: `c3e25bc2-0ada-43d9-8d5e-c2140dc1e854`, active, not seed.
- Shared seed: `218e2ff7-89fc-49ee-842b-d6ee31013f70`, active and read-only to interview users.
- Both tenants currently have 18 pseudonymized profiles, 6 public ACG decks and 7 events. The interview tenant also has 32 participants, 19 rounds and 41 matches.
- No Auth user or membership has been provisioned yet. The login cannot succeed until the user supplies the interview account email and it is assigned to this tenant.
- Every public application table has RLS and FORCE RLS. Security advisor lints are empty. `public.room_network_readiness_v2()` returns true. Membership-check and room mutation RPC grants are limited to `service_role`.
- No Storage buckets exist. Production Auth users/sessions and production Storage preview-card media were not copied.

The history rows are pseudonymized. Auth identities remain separate from historical profile rows. The source production project was read-only and unchanged.

## Authorization model

The private control plane uses `private.interviews` and `private.interview_memberships`. Never authorize from `user_metadata` or any user-editable client field. Application REST policies enforce the tenant ID, seed writes are denied, and the Simulator API uses the service key only after checking active membership on each request. SSE streams recheck membership periodically. Keep the service key server-side.

After provisioning the real account, verify browser login on each site and run direct REST read/write tests with two tenant memberships. Check access revocation against existing JWTs and SSE before deleting a tenant. Do not provision synthetic identities in the persistent project without recording and cleaning them up.
