-- Customer profile and saved-address support. Apply after the two marketplace migrations.
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Home' check (length(btrim(label)) between 1 and 40),
  recipient_name text not null check (length(btrim(recipient_name)) between 1 and 120),
  phone text not null check (length(btrim(phone)) between 3 and 40),
  address_line1 text not null check (length(btrim(address_line1)) between 5 and 250),
  address_line2 text not null default '',
  city text not null check (length(btrim(city)) between 2 and 100),
  state text not null check (length(btrim(state)) between 2 and 100),
  postal_code text not null default '',
  country text not null default 'Nigeria',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_addresses_user_idx on public.customer_addresses(user_id, created_at desc);
create unique index if not exists customer_addresses_single_default_idx on public.customer_addresses(user_id) where is_default;
alter table public.customer_addresses enable row level security;
drop policy if exists "customer addresses own or admin" on public.customer_addresses;
create policy "customer addresses own or admin" on public.customer_addresses for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
revoke all on table public.customer_addresses from anon, authenticated;
grant select, insert, update, delete on public.customer_addresses to authenticated;
grant all on public.customer_addresses to service_role;

-- Keep the profile phone in sync with registration and profile updates through Supabase Auth.
create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  perform set_config('zv.profile_sync','true',true);
  insert into public.profiles(id, full_name, email, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email, coalesce(new.raw_user_meta_data->>'phone',''))
  on conflict (id) do update set
    email=excluded.email,
    full_name=coalesce(nullif(excluded.full_name,''),profiles.full_name),
    phone=coalesce(nullif(excluded.phone,''),profiles.phone);
  return new;
end $$;

create or replace function public.set_customer_address_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists customer_addresses_updated_at on public.customer_addresses;
create trigger customer_addresses_updated_at before update on public.customer_addresses
  for each row execute function public.set_customer_address_updated_at();
