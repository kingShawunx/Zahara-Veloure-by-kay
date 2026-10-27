-- Allow archiving products while preserving inventory and order history.
-- inventory_movements.product_id previously blocked product deletion because it
-- had no ON DELETE behaviour. Set it to SET NULL so historical stock adjustments
-- survive a product removal, and add a safe archive RPC for the admin dashboard.

do $$
begin
  if to_regclass('public.inventory_movements') is null then
    raise exception 'inventory_movements table is missing; apply the marketplace foundation migration first';
  end if;
  if to_regclass('public.products') is null then
    raise exception 'products table is missing; apply the marketplace foundation migration first';
  end if;
end;
$$;

-- 1. Detach the inventory history from the product row so deletion no longer fails.
--    Drop NOT NULL so the FK can SET NULL when a product is removed.
alter table public.inventory_movements
  alter column product_id drop not null;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_product_id_fkey;

-- Re-create the FK with SET NULL so old stock adjustments remain as historical records.
alter table public.inventory_movements
  add constraint inventory_movements_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

-- 2. Server-side archive helper used by the admin dashboard. It keeps the row,
--    hides it from the public catalog, and records an audit entry.
create or replace function public.archive_product(p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_name text;
  v_has_dependents boolean;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select name into v_name from public.products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;

  -- A product that still appears in active carts, wishlists, open orders,
  -- reviews, or inventory history should be archived, not hard-deleted,
  -- so customer data stays intact.
  select exists(
    select 1 from public.cart_items ci join public.carts c on c.id = ci.cart_id
    where ci.product_id = p_product_id
  ) or exists(
    select 1 from public.wishlists w where w.product_id = p_product_id
  ) or exists(
    select 1 from public.order_items oi where oi.product_id = p_product_id
  ) or exists(
    select 1 from public.reviews r where r.product_id = p_product_id
  ) or exists(
    select 1 from public.inventory_movements im where im.product_id = p_product_id
  ) into v_has_dependents;

  update public.products
     set status = 'archived',
         featured = false,
         published_at = null,
         updated_at = now()
  where id = p_product_id;

  insert into public.admin_audit_logs(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'product.archive', 'product', p_product_id::text,
          jsonb_build_object('name', v_name, 'had_dependent_records', v_has_dependents));

  return true;
end;
$$;

revoke all on function public.archive_product(uuid) from public, anon, authenticated;
grant execute on function public.archive_product(uuid) to authenticated;

-- Force PostgREST to reload its schema cache so the new function is visible.
notify pgrst, 'reload schema';