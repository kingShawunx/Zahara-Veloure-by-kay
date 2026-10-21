-- Zahara Market foundation for Supabase/Postgres.
-- Apply with the Supabase CLI after configuring a project. Do not run against production without review.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  role text not null default 'customer' check (role in ('customer','admin')),
  account_status text not null default 'active' check (account_status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  name text not null,
  slug text not null unique,
  description text,
  image_url text,
  active boolean not null default true,
  nav_visible boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
insert into public.categories(name,slug,active,nav_visible,featured,sort_order) values
  ('Clothing and Fashion','clothing-and-fashion',true,true,false,10),
  ('Perfumes and Fragrances','perfumes-and-fragrances',true,true,false,20),
  ('Shoes and Footwear','shoes-and-footwear',true,true,false,30),
  ('Bags and Accessories','bags-and-accessories',true,true,false,40),
  ('Beauty and Personal Care','beauty-and-personal-care',true,true,false,50),
  ('Home and Living','home-and-living',true,true,false,60),
  ('Gadgets and Electronics','gadgets-and-electronics',true,true,false,70),
  ('Gifts and Special Offers','gifts-and-special-offers',true,true,false,80)
on conflict (slug) do nothing;
with children(parent_slug,name,slug,sort_order) as (values
  ('clothing-and-fashion','Men''s Clothing','mens-clothing',10),('clothing-and-fashion','Women''s Clothing','womens-clothing',20),('clothing-and-fashion','Dresses','dresses',30),('clothing-and-fashion','Tops and Shirts','tops-and-shirts',40),('clothing-and-fashion','Trousers and Jeans','trousers-and-jeans',50),('clothing-and-fashion','Jackets and Outerwear','jackets-and-outerwear',60),('clothing-and-fashion','Traditional Wear','traditional-wear',70),('clothing-and-fashion','Abayas','abayas',80),('clothing-and-fashion','Fashion Accessories','fashion-accessories',90),
  ('perfumes-and-fragrances','Men''s Perfumes','mens-perfumes',10),('perfumes-and-fragrances','Women''s Perfumes','womens-perfumes',20),('perfumes-and-fragrances','Unisex Fragrances','unisex-fragrances',30),('perfumes-and-fragrances','Eau de Parfum','eau-de-parfum',40),('perfumes-and-fragrances','Eau de Toilette','eau-de-toilette',50),('perfumes-and-fragrances','Perfume Oils','perfume-oils',60),('perfumes-and-fragrances','Body Mists','body-mists',70),('perfumes-and-fragrances','Gift Sets','fragrance-gift-sets',80),
  ('shoes-and-footwear','Sneakers','sneakers',10),('shoes-and-footwear','Casual Shoes','casual-shoes',20),('shoes-and-footwear','Formal Shoes','formal-shoes',30),('shoes-and-footwear','Sandals','sandals',40),('shoes-and-footwear','Heels','heels',50),
  ('bags-and-accessories','Handbags','handbags',10),('bags-and-accessories','Backpacks','backpacks',20),('bags-and-accessories','Wallets','wallets',30),('bags-and-accessories','Watches','watches',40),('bags-and-accessories','Jewellery','jewellery',50),('bags-and-accessories','Sunglasses','sunglasses',60),
  ('beauty-and-personal-care','Skincare','skincare',10),('beauty-and-personal-care','Makeup','makeup',20),('beauty-and-personal-care','Body Care','body-care',30),('beauty-and-personal-care','Hair Care','hair-care',40),
  ('home-and-living','Home Decor','home-decor',10),('home-and-living','Kitchen Essentials','kitchen-essentials',20),('home-and-living','Storage','home-storage',30),('home-and-living','Bedding','bedding',40),
  ('gadgets-and-electronics','Phone Accessories','phone-accessories',10),('gadgets-and-electronics','Audio Accessories','audio-accessories',20),('gadgets-and-electronics','Computer Accessories','computer-accessories',30),('gadgets-and-electronics','Everyday Gadgets','everyday-gadgets',40),
  ('gifts-and-special-offers','Gift Sets','special-gift-sets',10),('gifts-and-special-offers','Bundle Offers','bundle-offers',20)
)
insert into public.categories(parent_id,name,slug,active,nav_visible,featured,sort_order)
select parent.id,children.name,children.slug,true,false,false,children.sort_order
from children join public.categories parent on parent.slug=children.parent_slug
on conflict (slug) do nothing;
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text not null default '',
  sku text not null unique,
  price numeric(12,2) not null check (price >= 0),
  compare_at_price numeric(12,2) check (compare_at_price is null or compare_at_price >= price),
  currency char(3) not null default 'NGN',
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array'),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  featured boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  alt_text text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(product_id, storage_path)
);
create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant jsonb not null default '{}'::jsonb,
  quantity integer not null check (quantity between 1 and 25),
  updated_at timestamptz not null default now(),
  unique(cart_id, product_id, variant)
);
create table if not exists public.wishlists (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, product_id)
);
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_amount numeric(12,2) not null check (discount_amount > 0),
  minimum_order numeric(12,2) not null default 0 check (minimum_order >= 0),
  usage_limit integer check (usage_limit is null or usage_limit >= 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_amount <= 100),
  check (expires_at is null or starts_at is null or expires_at > starts_at)
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references public.profiles(id),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  delivery_address jsonb not null,
  currency char(3) not null default 'NGN',
  subtotal numeric(12,2) not null check (subtotal >= 0),
  shipping_fee numeric(12,2) not null default 0 check (shipping_fee >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  total numeric(12,2) not null check (total >= 0),
  coupon_id uuid references public.coupons(id) on delete set null,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded','partially_refunded')),
  fulfillment_status text not null default 'pending' check (fulfillment_status in ('pending','processing','shipped','delivered','cancelled')),
  tracking_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text not null,
  variant jsonb not null default '{}'::jsonb,
  quantity integer not null check (quantity between 1 and 25),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null check (provider in ('paystack','flutterwave')),
  provider_reference text not null unique,
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null default 'NGN',
  status text not null default 'initialized' check (status in ('initialized','verified','failed','refunded')),
  provider_payload jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  title text,
  body text not null,
  moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  unique(product_id, user_id, order_id)
);
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  order_id uuid references public.orders(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  payment_status text check (payment_status is null or payment_status in ('pending','paid','failed','refunded','partially_refunded')),
  fulfillment_status text check (fulfillment_status is null or fulfillment_status in ('pending','processing','shipped','delivered','cancelled')),
  note text,
  created_at timestamptz not null default now()
);
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.store_settings (
  key text primary key,
  value jsonb not null,
  public_read boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.homepage_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  image_path text,
  destination_url text,
  active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.prevent_category_loss()
returns trigger language plpgsql set search_path = public
as $$
begin
  if exists(select 1 from public.products where category_id=old.id) then
    raise exception 'Reassign products before deleting this category';
  end if;
  return old;
end $$;
drop trigger if exists categories_prevent_product_loss on public.categories;
create trigger categories_prevent_product_loss before delete on public.categories for each row execute function public.prevent_category_loss();

create or replace function public.prevent_category_nesting()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.parent_id is not null and (new.parent_id = new.id or exists(select 1 from public.categories where id=new.parent_id and parent_id is not null)) then
    raise exception 'Subcategories can only be one level deep';
  end if;
  return new;
end $$;
drop trigger if exists categories_parent_guard on public.categories;
create trigger categories_parent_guard before insert or update of parent_id on public.categories for each row execute function public.prevent_category_nesting();

create index if not exists products_status_category_idx on public.products(status, category_id);
create index if not exists categories_parent_sort_idx on public.categories(parent_id, sort_order);
create index if not exists products_created_idx on public.products(created_at desc);
create index if not exists orders_user_created_idx on public.orders(user_id, created_at desc);
create index if not exists orders_status_created_idx on public.orders(payment_status, fulfillment_status, created_at desc);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists reviews_product_approved_idx on public.reviews(product_id, moderation_status, created_at desc);
create index if not exists inventory_product_date_idx on public.inventory_movements(product_id, created_at desc);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.account_status = 'active') $$;

create or replace function public.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role and coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception 'Only the service role can change account roles';
  end if;
  if tg_op = 'UPDATE' and new.email is distinct from old.email and coalesce(current_setting('zv.profile_sync',true),'') <> 'true' and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Customer email must be changed through account authentication';
  end if;
  if tg_op = 'UPDATE' and new.account_status is distinct from old.account_status and not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorized to change account status';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges before update on public.profiles for each row execute function public.guard_profile_privileges();

create or replace function public.guard_order_and_inventory_changes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name='orders' and tg_op='UPDATE' then
    if new.payment_status is distinct from old.payment_status and coalesce(auth.role(),'') <> 'service_role' then
      raise exception 'Payment status can only change through verified payment workflows';
    end if;
    if new.fulfillment_status is distinct from old.fulfillment_status then
      if new.fulfillment_status <> 'cancelled' and new.payment_status <> 'paid' then raise exception 'Only verified paid orders can enter fulfillment'; end if;
      if old.fulfillment_status='pending' and new.fulfillment_status not in ('processing','cancelled') then raise exception 'Orders must move from pending to processing first'; end if;
      if old.fulfillment_status='processing' and new.fulfillment_status not in ('shipped','cancelled') then raise exception 'Orders must move from processing to shipped or cancelled'; end if;
      if old.fulfillment_status='shipped' and new.fulfillment_status <> 'delivered' then raise exception 'Shipped orders can only be marked delivered'; end if;
      if old.fulfillment_status in ('delivered','cancelled') then raise exception 'This order is already complete'; end if;
      if new.fulfillment_status='cancelled' and old.payment_status <> 'pending' then raise exception 'Paid orders require a verified refund workflow before cancellation'; end if;
      if new.fulfillment_status='cancelled' and exists(select 1 from public.payments where order_id=old.id and status='initialized') then raise exception 'Resolve the active payment attempt before cancellation'; end if;
    end if;
    if new.order_number is distinct from old.order_number or new.user_id is distinct from old.user_id or new.subtotal is distinct from old.subtotal or new.shipping_fee is distinct from old.shipping_fee or new.discount_total is distinct from old.discount_total or new.total is distinct from old.total or new.currency is distinct from old.currency or new.coupon_id is distinct from old.coupon_id then
      raise exception 'Order totals and ownership cannot be edited';
    end if;
  elsif tg_table_name='products' and tg_op='UPDATE' then
    if new.stock_quantity is distinct from old.stock_quantity and coalesce(current_setting('zv.inventory_context',true),'') not in ('order','admin') then
      raise exception 'Use the inventory adjustment workflow to change stock';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_guard_payment_status on public.orders;
create trigger orders_guard_payment_status before update on public.orders for each row execute function public.guard_order_and_inventory_changes();
drop trigger if exists products_guard_stock on public.products;
create trigger products_guard_stock before update on public.products for each row execute function public.guard_order_and_inventory_changes();

create or replace function public.record_order_admin_changes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.fulfillment_status='cancelled' and old.fulfillment_status <> 'cancelled' then
    perform set_config('zv.inventory_context','order',true);
    update public.products p set stock_quantity=p.stock_quantity+reserved.quantity,updated_at=now()
    from (select product_id,sum(quantity)::integer as quantity from public.order_items where order_id=new.id and product_id is not null group by product_id) reserved
    where reserved.product_id=p.id;
    insert into public.inventory_movements(product_id,order_id,actor_id,quantity_delta,reason)
    select i.product_id,new.id,auth.uid(),i.quantity,'cancelled order stock release' from public.order_items i where i.order_id=new.id and i.product_id is not null;
    if new.coupon_id is not null then update public.coupons set usage_count=greatest(usage_count-1,0) where id=new.coupon_id; end if;
  end if;
  if new.fulfillment_status is distinct from old.fulfillment_status or new.tracking_number is distinct from old.tracking_number then
    insert into public.order_status_history(order_id,actor_id,fulfillment_status,note)
    values(new.id,auth.uid(),new.fulfillment_status,case when new.tracking_number is distinct from old.tracking_number then 'Tracking information updated' else 'Fulfillment status updated' end);
    insert into public.admin_audit_logs(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'order.fulfillment_update','order',new.id::text,jsonb_build_object('from',old.fulfillment_status,'to',new.fulfillment_status,'tracking_number',new.tracking_number));
  end if;
  return new;
end $$;
drop trigger if exists orders_record_admin_changes on public.orders;
create trigger orders_record_admin_changes after update on public.orders for each row execute function public.record_order_admin_changes();

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  perform set_config('zv.profile_sync','true',true);
  insert into public.profiles(id, full_name, email) values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email)
  on conflict (id) do update set email=excluded.email, full_name=coalesce(nullif(excluded.full_name,''),profiles.full_name);
  return new;
end $$;
drop trigger if exists auth_user_profile on auth.users;
create trigger auth_user_profile after insert or update of email, raw_user_meta_data on auth.users for each row execute function public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlists enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.reviews enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.order_status_history enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.store_settings enable row level security;
alter table public.homepage_banners enable row level security;

create policy "profiles read own or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles update own or admin" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "categories public active" on public.categories for select to anon, authenticated using (active or public.is_admin());
create policy "categories admin manage" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "products public active" on public.products for select to anon, authenticated using (
  (
    status = 'active'
    and (
      products.category_id is null
      or exists (
        select 1
        from public.categories as c
        where c.id = products.category_id
          and c.active
          and (
            c.parent_id is null
            or exists (
              select 1
              from public.categories as parent
              where parent.id = c.parent_id
                and parent.active
            )
          )
      )
    )
  )
  or public.is_admin()
);
create policy "products admin manage" on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "product images public active" on public.product_images for select to anon, authenticated using (exists(select 1 from public.products p where p.id = product_id and (p.status = 'active' or public.is_admin())));
create policy "product images admin manage" on public.product_images for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "carts own or admin" on public.carts for all to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "cart items own or admin" on public.cart_items for all to authenticated using (exists(select 1 from public.carts c where c.id = cart_id and (c.user_id = auth.uid() or public.is_admin()))) with check (exists(select 1 from public.carts c where c.id = cart_id and (c.user_id = auth.uid() or public.is_admin())));
create policy "wishlists own or admin" on public.wishlists for all to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "coupons admin manage" on public.coupons for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "orders own or admin read" on public.orders for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "orders admin manage" on public.orders for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "order items own or admin read" on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
create policy "order items admin manage" on public.order_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "payments own or admin read" on public.payments for select to authenticated using (exists(select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
create policy "payments admin read" on public.payments for select to authenticated using (public.is_admin());
create policy "reviews approved public" on public.reviews for select to anon, authenticated using (moderation_status = 'approved' or user_id = auth.uid() or public.is_admin());
create policy "reviews verified customer create" on public.reviews for insert to authenticated with check (user_id = auth.uid() and exists(select 1 from public.orders o join public.order_items i on i.order_id=o.id where o.id=reviews.order_id and o.user_id=auth.uid() and o.fulfillment_status='delivered' and i.product_id=reviews.product_id));
create policy "reviews admin moderate" on public.reviews for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "inventory admin only" on public.inventory_movements for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "order history own or admin read" on public.order_status_history for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and (o.user_id=auth.uid() or public.is_admin())));
create policy "order history admin insert" on public.order_status_history for insert to authenticated with check (public.is_admin());
create policy "audit admin only" on public.admin_audit_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public settings read" on public.store_settings for select to anon, authenticated using (public_read or public.is_admin());
create policy "settings admin manage" on public.store_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "active banners public" on public.homepage_banners for select to anon, authenticated using (active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) or public.is_admin());
create policy "banners admin manage" on public.homepage_banners for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Orders are created through the authenticated RPC only. Prices and stock are loaded from Postgres.
create or replace function public.create_market_order(p_items jsonb, p_delivery jsonb, p_coupon_code text default null)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid(); v_email text; v_name text; v_phone text;
  v_line jsonb; v_product public.products%rowtype; v_qty integer; v_variant jsonb;
  v_subtotal numeric(12,2) := 0; v_discount numeric(12,2) := 0; v_shipping numeric(12,2) := 0; v_total numeric(12,2);
  v_coupon public.coupons%rowtype; v_coupon_id uuid; v_order_id uuid; v_order_number text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles where id=v_user and account_status='active') then raise exception 'Active customer account required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then raise exception 'Invalid order items'; end if;
  if jsonb_typeof(p_delivery) <> 'object' then raise exception 'Invalid delivery details'; end if;
  if coalesce(p_delivery->>'country','') <> 'Nigeria' or coalesce(p_delivery->>'delivery_method','') <> 'standard' then raise exception 'Unavailable delivery option'; end if;
  v_name := nullif(btrim(p_delivery->>'name'),''); v_phone := nullif(btrim(p_delivery->>'phone'),'');
  if v_name is null or length(v_name) > 120 or v_phone is null or length(v_phone) > 40 then raise exception 'Name and phone are required'; end if;
  if length(coalesce(p_delivery->>'address','')) not between 5 and 250 or length(coalesce(p_delivery->>'city','')) not between 2 and 100 or length(coalesce(p_delivery->>'state','')) not between 2 and 100 then raise exception 'Complete delivery address required'; end if;
  if length(coalesce(p_delivery->>'note','')) > 500 then raise exception 'Delivery note is too long'; end if;
  select coalesce(nullif(btrim(p_delivery->>'email'),''),email) into v_email from auth.users where id=v_user;
  if v_email is null then v_email := nullif(btrim(p_delivery->>'email'),''); end if;
  if v_email is null then raise exception 'Valid customer email required'; end if;
  if length(v_email)>254 or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Valid customer email required'; end if;
  for v_line in select value from jsonb_array_elements(p_items) as items(value) order by value->>'product_id' loop
    if (v_line->>'product_id') !~* '^[0-9a-f-]{36}$' then raise exception 'Invalid product'; end if;
    v_qty := (v_line->>'quantity')::integer;
    if v_qty < 1 or v_qty > 25 then raise exception 'Invalid quantity'; end if;
    v_variant := coalesce(v_line->'variant','{}'::jsonb);
    select * into v_product from public.products where id=(v_line->>'product_id')::uuid and status='active' for update;
    if not found then raise exception 'Product is unavailable'; end if;
    if v_product.stock_quantity < v_qty then raise exception 'Insufficient stock for %', v_product.name; end if;
    if v_variant <> '{}'::jsonb and not exists(select 1 from jsonb_array_elements(v_product.variants) as variants(value) where value = v_variant) then raise exception 'Invalid product variant'; end if;
    v_subtotal := v_subtotal + v_product.price * v_qty;
    perform set_config('zv.inventory_context','order',true);
    update public.products set stock_quantity=stock_quantity-v_qty, updated_at=now() where id=v_product.id;
  end loop;
  if p_coupon_code is not null and btrim(p_coupon_code) <> '' then
    select * into v_coupon from public.coupons where upper(code)=upper(btrim(p_coupon_code)) and enabled and (starts_at is null or starts_at <= now()) and (expires_at is null or expires_at > now()) and (usage_limit is null or usage_count < usage_limit) for update;
    if not found or v_subtotal < v_coupon.minimum_order then raise exception 'Coupon is invalid or not eligible'; end if;
    v_coupon_id := v_coupon.id;
    v_discount := case when v_coupon.discount_type='percent' then round(v_subtotal*v_coupon.discount_amount/100,2) else least(v_subtotal,v_coupon.discount_amount) end;
  end if;
  select coalesce((value->>'shipping_fee')::numeric,0) into v_shipping from public.store_settings where key='checkout';
  v_shipping := coalesce(v_shipping,0);
  v_total := greatest(0,v_subtotal+v_shipping-v_discount);
  v_order_number := 'ZV-' || upper(substr(encode(gen_random_bytes(8),'hex'),1,12));
  insert into public.orders(order_number,user_id,customer_name,customer_email,customer_phone,delivery_address,subtotal,shipping_fee,discount_total,total,coupon_id)
  values(v_order_number,v_user,v_name,v_email,v_phone,p_delivery,v_subtotal,v_shipping,v_discount,v_total,v_coupon_id) returning id into v_order_id;
  for v_line in select value from jsonb_array_elements(p_items) as items(value) order by value->>'product_id' loop
    v_qty := (v_line->>'quantity')::integer; v_variant := coalesce(v_line->'variant','{}'::jsonb);
    select * into v_product from public.products where id=(v_line->>'product_id')::uuid;
    insert into public.order_items(order_id,product_id,product_name,sku,variant,quantity,unit_price,line_total)
    values(v_order_id,v_product.id,v_product.name,v_product.sku,v_variant,v_qty,v_product.price,v_product.price*v_qty);
    insert into public.inventory_movements(product_id,order_id,actor_id,quantity_delta,reason)
    values(v_product.id,v_order_id,v_user,-v_qty,'order reservation');
  end loop;
  if v_coupon_id is not null then update public.coupons set usage_count=usage_count+1 where id=v_coupon_id; end if;
  insert into public.order_status_history(order_id,actor_id,payment_status,fulfillment_status,note)
  values(v_order_id,v_user,'pending','pending','Order created; payment not yet verified');
  return jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,'currency','NGN','subtotal',v_subtotal,'shipping_fee',v_shipping,'discount',v_discount,'total',v_total,'payment_status','pending');
end $$;
revoke all on function public.create_market_order(jsonb,jsonb,text) from public, anon;
grant execute on function public.create_market_order(jsonb,jsonb,text) to authenticated;

create or replace function public.adjust_product_stock(p_product_id uuid, p_delta integer, p_reason text)
returns integer language plpgsql security definer set search_path = public
as $$
declare v_stock integer;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_delta=0 or abs(p_delta)>100000 or length(btrim(coalesce(p_reason,''))) not between 3 and 240 then raise exception 'Invalid inventory adjustment'; end if;
  perform set_config('zv.inventory_context','admin',true);
  update public.products set stock_quantity=stock_quantity+p_delta,updated_at=now() where id=p_product_id and stock_quantity+p_delta>=0 returning stock_quantity into v_stock;
  if not found then raise exception 'Product not found or stock would become negative'; end if;
  insert into public.inventory_movements(product_id,actor_id,quantity_delta,reason) values(p_product_id,auth.uid(),p_delta,btrim(p_reason));
  insert into public.admin_audit_logs(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'inventory.adjust','product',p_product_id::text,jsonb_build_object('delta',p_delta,'reason',btrim(p_reason)));
  return v_stock;
end $$;
revoke all on function public.adjust_product_stock(uuid,integer,text) from public, anon;
grant execute on function public.adjust_product_stock(uuid,integer,text) to authenticated;

-- Only the server-side payment verifier can record a successful provider transaction.
create or replace function public.confirm_paystack_payment(p_reference text, p_amount_kobo bigint, p_currency text, p_provider_payload jsonb)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Server authorization required'; end if;
  select * into v_payment from public.payments where provider='paystack' and provider_reference=p_reference for update;
  if not found then raise exception 'Payment not found'; end if;
  select * into v_order from public.orders where id=v_payment.order_id for update;
  if v_payment.status='verified' and v_order.payment_status='paid' then return v_order.id; end if;
  if v_payment.status <> 'initialized' or v_order.payment_status <> 'pending' or v_order.fulfillment_status='cancelled' then raise exception 'Order is not payable'; end if;
  if p_amount_kobo <> round(v_payment.amount * 100)::bigint or p_currency <> v_payment.currency then raise exception 'Payment amount mismatch'; end if;
  update public.payments set status='verified',verified_at=now(),provider_payload=p_provider_payload where id=v_payment.id;
  update public.orders set payment_status='paid',updated_at=now() where id=v_order.id;
  insert into public.order_status_history(order_id,payment_status,note) values(v_order.id,'paid','Paystack transaction verified server-side');
  return v_order.id;
end $$;
revoke all on function public.confirm_paystack_payment(text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_paystack_payment(text,bigint,text,jsonb) to service_role;

-- Supabase Data API privileges remain narrow; row-level policies above gate every row.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.categories, public.products, public.product_images, public.reviews, public.homepage_banners to anon, authenticated;
grant select on public.store_settings to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.carts, public.cart_items, public.wishlists,
  public.categories, public.products, public.product_images, public.coupons, public.orders,
  public.order_items, public.payments, public.reviews, public.inventory_movements,
  public.order_status_history, public.admin_audit_logs, public.store_settings, public.homepage_banners to authenticated;
grant all on all tables in schema public to service_role;

-- Product images are publicly readable; upload and deletion require the admin role.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
create policy "product image files public read" on storage.objects for select to anon, authenticated using (bucket_id='product-images');
create policy "product image files admin upload" on storage.objects for insert to authenticated with check (bucket_id='product-images' and public.is_admin());
create policy "product image files admin update" on storage.objects for update to authenticated using (bucket_id='product-images' and public.is_admin()) with check (bucket_id='product-images' and public.is_admin());
create policy "product image files admin delete" on storage.objects for delete to authenticated using (bucket_id='product-images' and public.is_admin());
