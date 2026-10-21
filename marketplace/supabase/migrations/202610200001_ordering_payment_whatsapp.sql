-- Add retry-safe checkout, negotiation pricing, and private manual-transfer proofs.
-- Review this migration against the live schema before applying it.

do $$
begin
  if exists (
    select 1 from storage.buckets
    where id='payment-proofs' and public
  ) then
    raise exception 'The payment-proofs bucket already exists and is public; review its contents and access before applying this migration';
  end if;
  if to_regclass('public.payments') is not null and exists (
    select 1 from public.payments
    where provider not in ('paystack','flutterwave','manual_transfer')
       or status not in ('initialized','pending_verification','verified','rejected','failed','refunded')
  ) then
    raise exception 'Existing payment rows use values not covered by the reviewed payment constraints';
  end if;
  if to_regclass('public.payments') is not null and exists (
    select 1 from public.payments
    where provider='paystack' and status='initialized'
    group by order_id having count(*) > 1
  ) then
    raise exception 'An order already has multiple active Paystack sessions; review them before applying this migration';
  end if;
end;
$$;

alter table public.orders
  add column if not exists negotiation_status text not null default 'not_requested'
    check (negotiation_status in ('not_requested','awaiting_agreement','confirmed','declined')),
  add column if not exists agreed_total numeric(12,2)
    check (agreed_total is null or agreed_total >= 0),
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('paystack','manual_transfer'));

alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider in ('paystack','flutterwave','manual_transfer'));
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('initialized','pending_verification','verified','rejected','failed','refunded'));
alter table public.payments
  add column if not exists proof_path text,
  add column if not exists rejection_reason text,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists authorization_url text;

create index if not exists payments_order_created_idx on public.payments(order_id, created_at desc);
create unique index if not exists payments_one_pending_transfer_per_order_idx
  on public.payments(order_id)
  where provider = 'manual_transfer' and status = 'pending_verification';
create unique index if not exists payments_one_initialized_paystack_per_order_idx
  on public.payments(order_id)
  where provider = 'paystack' and status = 'initialized';

create or replace function public.prevent_cancel_during_manual_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfillment_status='cancelled' and old.fulfillment_status is distinct from 'cancelled'
     and (
       old.payment_method is not null
       or exists(select 1 from public.payments where order_id=old.id and status in ('initialized','pending_verification','verified'))
     ) then
    raise exception 'Resolve the active payment attempt before cancelling this order';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_cancel_during_manual_review() from public, anon, authenticated;
drop trigger if exists orders_prevent_cancel_during_manual_review on public.orders;
create trigger orders_prevent_cancel_during_manual_review
  before update of fulfillment_status on public.orders
  for each row execute function public.prevent_cancel_during_manual_review();

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
        'product_name',i.product_name,
        'sku',i.sku,
        'variant',i.variant,
        'quantity',i.quantity,
        'unit_price',i.unit_price,
        'line_total',i.line_total
      ) order by i.id)
      from public.order_items i
      where i.order_id=(v_result->>'order_id')::uuid
    ),'[]'::jsonb)
  );
  if p_request_negotiation then
    update public.orders
    set negotiation_status = 'awaiting_agreement', updated_at = now()
    where id = (v_result->>'order_id')::uuid and user_id = v_user;
    v_result := v_result || jsonb_build_object('negotiation_status','awaiting_agreement');
  else
    v_result := v_result || jsonb_build_object('negotiation_status','not_requested');
  end if;
  insert into public.checkout_idempotency(user_id, request_key, result)
  values (v_user, p_request_key, v_result);
  return v_result;
end;
$$;
revoke all on function public.create_market_order_once(jsonb,jsonb,text,uuid,boolean) from public, anon;
grant execute on function public.create_market_order_once(jsonb,jsonb,text,uuid,boolean) to authenticated;

create or replace function public.begin_order_payment(p_order_id uuid, p_method text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null or p_method not in ('paystack','manual_transfer') then raise exception 'Invalid payment request'; end if;
  select * into v_order from public.orders where id=p_order_id and user_id=auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.payment_status <> 'pending' or v_order.fulfillment_status='cancelled' or
     v_order.negotiation_status in ('awaiting_agreement','declined') or
     (v_order.negotiation_status='confirmed' and v_order.agreed_total is null) or
     (case when v_order.negotiation_status='confirmed' then v_order.agreed_total else v_order.total end) <= 0 then
    raise exception 'Order is not ready for payment';
  end if;
  if v_order.payment_method is null then
    update public.orders set payment_method=p_method,updated_at=now() where id=p_order_id;
  elsif v_order.payment_method is distinct from p_method then
    if not exists(select 1 from public.payments where order_id=p_order_id and provider=v_order.payment_method)
       or exists(select 1 from public.payments where order_id=p_order_id and status in ('initialized','pending_verification','verified')) then
      raise exception 'Another payment method is already active for this order';
    end if;
    update public.orders set payment_method=p_method,updated_at=now() where id=p_order_id;
  end if;
  return true;
end;
$$;
revoke all on function public.begin_order_payment(uuid,text) from public, anon;
grant execute on function public.begin_order_payment(uuid,text) to authenticated;

create or replace function public.review_manual_payment(
  p_payment_id uuid,
  p_approve boolean,
  p_reason text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Server authorization required'; end if;
  if p_approve is null or (not p_approve and length(btrim(coalesce(p_reason,''))) not between 3 and 500) then
    raise exception 'A rejection reason is required';
  end if;
  select * into v_payment from public.payments where id=p_payment_id and provider='manual_transfer' for update;
  if not found then raise exception 'Manual payment not found'; end if;
  select * into v_order from public.orders where id=v_payment.order_id for update;
  if v_payment.status <> 'pending_verification' or v_order.payment_status <> 'pending' or v_order.fulfillment_status='cancelled' then
    raise exception 'This manual payment is no longer awaiting review';
  end if;
  if v_order.negotiation_status='awaiting_agreement' or
     (v_order.negotiation_status='confirmed' and v_order.agreed_total is distinct from v_payment.amount) then
    raise exception 'The final agreed price must match the submitted payment amount';
  end if;
  update public.payments set
    status=case when p_approve then 'verified' else 'rejected' end,
    rejection_reason=case when p_approve then null else btrim(p_reason) end,
    reviewed_at=now(), reviewed_by=p_actor_id, verified_at=case when p_approve then now() else null end
  where id=v_payment.id;
  if p_approve then
    update public.orders set payment_status='paid', updated_at=now() where id=v_order.id;
  else
    update public.orders set payment_method=null, updated_at=now() where id=v_order.id;
  end if;
  insert into public.order_status_history(order_id,actor_id,payment_status,note)
  values(v_order.id,p_actor_id,case when p_approve then 'paid' else 'pending' end,
    case when p_approve then 'Manual transfer verified by administrator' else 'Manual transfer rejected: ' || btrim(p_reason) end);
  insert into public.admin_audit_logs(actor_id,action,entity_type,entity_id,details)
  values(p_actor_id,case when p_approve then 'payment.manual_verified' else 'payment.manual_rejected' end,
    'payment',v_payment.id::text,jsonb_build_object('order_id',v_order.id,'reason',nullif(btrim(p_reason),'')));
  return v_order.id;
end;
$$;
revoke all on function public.review_manual_payment(uuid,boolean,text,uuid) from public, anon, authenticated;
grant execute on function public.review_manual_payment(uuid,boolean,text,uuid) to service_role;

-- The bucket is private. Customer paths must be prefixed by their Auth user UUID.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set
  name=excluded.name,
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "payment proofs owner or admin read" on storage.objects;
create policy "payment proofs owner or admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));
drop policy if exists "payment proofs owner upload" on storage.objects;
create policy "payment proofs owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "payment proofs owner delete or admin" on storage.objects;
create policy "payment proofs owner delete or admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-proofs' and (public.is_admin() or (
    (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (select 1 from public.payments p where p.proof_path = storage.objects.name)
  )));

-- Bank transfer instructions are intentionally customer-readable after an admin publishes them.
-- The dashboard is the only client path for editing this setting; RLS keeps writes admin-only.
