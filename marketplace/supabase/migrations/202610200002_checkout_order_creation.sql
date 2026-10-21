-- Install the checkout RPC expected by the create-order Edge Function.
-- Requires the base marketplace schema and create_market_order() from migration 001.
-- This migration is additive and does not alter existing order, product, or payment rows.

do $$
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.order_items') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Checkout prerequisites are missing: apply and verify the marketplace foundation first';
  end if;
  if to_regprocedure('public.create_market_order(jsonb,jsonb,text)') is null then
    raise exception 'Checkout prerequisite create_market_order(jsonb,jsonb,text) is missing';
  end if;
end;
$$;

alter table public.orders
  add column if not exists negotiation_status text not null default 'not_requested';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_negotiation_status_values_check'
  ) then
    alter table public.orders
      add constraint orders_negotiation_status_values_check
      check (negotiation_status in ('not_requested','awaiting_agreement','confirmed','declined'));
  end if;
end;
$$;

create table if not exists public.checkout_idempotency (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_key)
);
alter table public.checkout_idempotency enable row level security;
revoke all on table public.checkout_idempotency from public, anon, authenticated;
grant all on table public.checkout_idempotency to service_role;

create or replace function public.create_market_order_once(
  p_items jsonb,
  p_delivery jsonb,
  p_coupon_code text,
  p_request_key uuid,
  p_request_negotiation boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_request_key is null then raise exception 'Checkout request key required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_request_key::text, 0));
  select result into v_result
  from public.checkout_idempotency
  where user_id = v_user and request_key = p_request_key;
  if found then return v_result; end if;

  v_result := public.create_market_order(p_items, p_delivery, p_coupon_code);
  v_result := v_result || jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', i.product_name,
        'sku', i.sku,
        'variant', i.variant,
        'quantity', i.quantity,
        'unit_price', i.unit_price,
        'line_total', i.line_total
      ) order by i.id)
      from public.order_items i
      where i.order_id = (v_result->>'order_id')::uuid
    ), '[]'::jsonb)
  );

  if p_request_negotiation then
    update public.orders
    set negotiation_status = 'awaiting_agreement', updated_at = now()
    where id = (v_result->>'order_id')::uuid and user_id = v_user;
    v_result := v_result || jsonb_build_object('negotiation_status', 'awaiting_agreement');
  else
    v_result := v_result || jsonb_build_object('negotiation_status', 'not_requested');
  end if;

  insert into public.checkout_idempotency(user_id, request_key, result)
  values (v_user, p_request_key, v_result);
  return v_result;
end;
$$;

revoke all on function public.create_market_order_once(jsonb,jsonb,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.create_market_order_once(jsonb,jsonb,text,uuid,boolean) to authenticated;
