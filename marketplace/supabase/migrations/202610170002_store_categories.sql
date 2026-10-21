-- One-level category taxonomy for Clothing, Fragrance, and future catalog sections.
alter table public.categories
  add column if not exists parent_id uuid references public.categories(id) on delete restrict,
  add column if not exists nav_visible boolean not null default true,
  add column if not exists featured boolean not null default false;
create index if not exists categories_parent_sort_idx on public.categories(parent_id, sort_order);

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

drop policy if exists "products public active" on public.products;
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
