-- Record explicit customer acceptance of the current terms during account creation.
create table if not exists public.customer_terms_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  terms_version text not null check (length(btrim(terms_version)) between 1 and 32),
  accepted_at timestamptz not null default now()
);

alter table public.customer_terms_consents enable row level security;
revoke all on table public.customer_terms_consents from public, anon, authenticated;
grant select on table public.customer_terms_consents to authenticated;
grant all on table public.customer_terms_consents to service_role;

drop policy if exists "customers read own terms consent" on public.customer_terms_consents;
create policy "customers read own terms consent" on public.customer_terms_consents
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.require_customer_terms_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_new_customer boolean;
begin
  v_is_new_customer := false;
  if tg_op = 'INSERT' then
    v_is_new_customer := true;
  elsif tg_op = 'UPDATE' and old.is_anonymous and not new.is_anonymous then
    v_is_new_customer := true;
  end if;

  if not v_is_new_customer or new.is_anonymous then
    return new;
  end if;

  if new.raw_user_meta_data ->> 'terms_accepted' is distinct from 'true'
     or new.raw_user_meta_data ->> 'terms_version' is distinct from '2026-10-17' then
    raise exception 'Explicit acceptance of the current terms is required to create a customer account';
  end if;

  return new;
end;
$$;

create or replace function public.capture_customer_terms_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_new_customer boolean;
begin
  v_is_new_customer := false;
  if tg_op = 'INSERT' then
    v_is_new_customer := true;
  elsif tg_op = 'UPDATE' and old.is_anonymous and not new.is_anonymous then
    v_is_new_customer := true;
  end if;

  if v_is_new_customer and not new.is_anonymous then
    insert into public.customer_terms_consents(user_id, terms_version)
    values (new.id, new.raw_user_meta_data ->> 'terms_version')
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.require_customer_terms_consent() from public, anon, authenticated;
revoke all on function public.capture_customer_terms_consent() from public, anon, authenticated;

drop trigger if exists auth_customer_terms_consent_required on auth.users;
create trigger auth_customer_terms_consent_required
  before insert or update of is_anonymous, raw_user_meta_data on auth.users
  for each row execute function public.require_customer_terms_consent();

drop trigger if exists auth_customer_terms_consent_record on auth.users;
create trigger auth_customer_terms_consent_record
  after insert or update of is_anonymous, raw_user_meta_data on auth.users
  for each row execute function public.capture_customer_terms_consent();
