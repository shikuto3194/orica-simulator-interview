create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.profiles(user_id uuid primary key, role text default 'user', display_name text);
      create table public.decks(id uuid primary key default gen_random_uuid(), user_id uuid, game text default 'bs', name text,
        cards jsonb default '[]', token_deck jsonb default '[]', thumbnail_card_id bigint,
        side_deck jsonb default '[]', is_public boolean default false, description text, tags text[] default '{}',
        created_at timestamptz default now(), updated_at timestamptz default now(), posted_at timestamptz, content_updated_at timestamptz);
      grant select, insert, update, delete on public.decks, public.profiles to authenticated;
      alter table public.decks enable row level security;
      create policy own_decks on public.decks for all to authenticated using(auth.uid() = user_id) with check(auth.uid() = user_id);
      insert into auth.users values ('00000000-0000-4000-8000-000000000001', 'main@example.test'), ('00000000-0000-4000-8000-000000000002', 'sub@example.test'), ('00000000-0000-4000-8000-000000000003', 'other@example.test');
      insert into public.profiles values ('00000000-0000-4000-8000-000000000001', 'admin', 'Main'), ('00000000-0000-4000-8000-000000000002', 'user', 'Sub'), ('00000000-0000-4000-8000-000000000003', 'user', 'Other');
