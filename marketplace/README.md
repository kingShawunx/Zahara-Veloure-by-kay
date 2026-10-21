# Zahara Veloure Marketplace

This is a dependency-light storefront built alongside the existing static brand website. It uses a warm ivory and champagne palette with product discovery inspired by the supplied reference, while keeping the Zahara Veloure identity. The store name is configured in `catalog.js` and `manifest.webmanifest`.

## Current behavior

- Storefront home, collection/search/category/deals, product details, wishlist, cart, WhatsApp checkout, account/order pages, support, shipping, privacy and terms views.
- Live debounced search, category and price filters, price/newest/name sorting, responsive product cards and mobile navigation.
- Parent/subcategory catalog taxonomy with initial Clothing, Perfume, Footwear, Accessories, Beauty, Home, Gadgets, and Gifts categories. Admins can edit names, parent, visibility, featured placement, and sort order; storefront category links and filters use active catalog data.
- Cart and wishlist persist in browser storage. `catalog.js` contains development seed examples only; the storefront does not display them and requires a successful live Supabase catalog query before showing products or enabling cart/checkout. After catalog data loads, checkout uses the selected local cart/order-now items and does not call Supabase.
- Product reviews are only shown when approved in the database. No sample reviews or sales figures are fabricated.
- Checkout displays configured bank-transfer details and prepares one of two WhatsApp messages: payment proof or discuss/negotiate. It does not create or save an order, verify payment, calculate delivery charges, or clear the cart when WhatsApp opens. The store must confirm availability and the final amount directly.
- Supabase SQL foundation includes customer/admin roles, row-level policies, inventory constraints, verified-order review rules, audit logs, atomic stock/order creation, payment-status protections, and immutable records of customer terms acceptance.
- Separate administrator sign-in at `/admin/login/` and dashboard at `/admin/dashboard/`; login checks the active administrator role and database policies also enforce authorization. The dashboard manages products, categories, orders, customers, inventory, coupons, homepage banners, reviews, reports, and store contact details. There is no public admin sign-up flow.
- Customer sign-in, registration, and account routes at `/login/`, `/signup/`, and `/account/`. Supabase Auth handles credentials, email confirmation and recovery. Customer profiles, saved delivery addresses, wishlists, and orders are protected by row-level policies.
- Existing order and payment database objects and Edge Functions remain in the project for historical records and supported administration workflows. They are not called by the current customer checkout; do not remove them as part of checkout changes.
- The storefront includes an installable PWA manifest, Android/iOS app icons, an install prompt, Safari installation help, and a conservative offline shell. Its service worker caches only the public app shell and never caches account, checkout, admin, or backend responses.

## Local preview

Open `index.html` from a local static web server or deploy the `marketplace/` directory as a static site. Product browsing, cart, and checkout require a successful live catalog response. If the Supabase client, connection, or catalog query fails, the storefront shows an error state and does not display seed data. Once catalog data is available, the checkout buttons prepare WhatsApp messages locally; they do not call Supabase. Because scripts load the official Supabase client from jsDelivr, authentication and live database features also require network access to that CDN.

Node.js is available at `C:\Program Files\nodejs\node.exe` in the current development environment. Supabase CLI, database connection, Edge Function credentials, payment credentials, and a browser test runner are not available here. The configured project URL is not itself database access; live database, function, and browser/device checks require separate access.

## Install the mobile app

Deploy over HTTPS (or use `localhost` for development), then open the storefront in a supported browser.

- **Android:** Open the storefront in Chrome. Use the in-page **Install the app** button when it appears, or Chrome's **Install app** menu item.
- **iPhone/iPad:** Open the storefront in Safari, tap **Share**, choose **Add to Home Screen**, then confirm. The storefront includes these instructions in its install dialog.
- **Offline:** The public app shell and offline notice can reopen, and cart/wishlist data remains stored on the device. Live catalog items may not render while offline; current prices and stock, account access, checkout, and payment require a connection. The worker deliberately does not cache private pages or API responses.

The project does not include a native Android APK/AAB or iOS app. If native store distribution is needed later, Capacitor can wrap this existing web app while keeping Supabase account/catalog services. Native builds still require the respective Android Studio or macOS/Xcode toolchains and device testing.

## Supabase setup

1. Enable the authentication methods the store actually uses (email/password, plus anonymous sign-in only if the owner intentionally supports anonymous customer sessions elsewhere). Configure the deployed and local callback URLs in Supabase Auth, including the account and password-reset routes.
2. Inspect the existing database before applying migrations; see [Existing Supabase project migration checks](#existing-supabase-project-migration-checks) below. Apply only reviewed migrations that are needed for the account, catalog, and existing administrative features. The ordering/payment migrations and `create-order` RPC are not prerequisites for the current WhatsApp checkout. Never rerun foundation or ordering migrations blindly against an existing project.
3. Create a public Storage bucket named `product-images` if the migration did not create it. The migration limits uploads to JPEG, PNG, and WebP at 5 MB and restricts writes to admins.
4. Set `window.SUPABASE_CONFIG.url` and `window.SUPABASE_CONFIG.anonKey` in `config.js` to the Supabase project URL and public anon/publishable key. The `.env.example` file is documentation for deployment and is not automatically loaded by this static site. These two values are browser-visible; row-level policies must remain enabled. Never put a service-role key or payment secret in this file.
5. Sign up the store owner through Supabase Auth. In the Supabase SQL editor, promote only that known account:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (select id from auth.users where lower(email) = lower('owner@example.com'))
     and role = 'customer';
   ```

   Confirm exactly one row changed. Do not expose this SQL as a public endpoint. The profile trigger prevents users from promoting themselves.
6. Review the seeded category tree, then add real product records through `/admin/`. Assign each item to the correct category or subcategory, upload real images, and set actual prices, stock, variants, and publication status. `catalog.js` retains development seed examples, but the storefront only displays products after an active database catalog loads.
7. The payment/order Edge Functions are retained for existing order records and legacy workflows. They are not needed to open either current WhatsApp checkout option. Deploy or update them only when intentionally supporting those separate workflows; never add server-only secrets to frontend configuration.
8. Configure bank and WhatsApp details in `config.js` (`STORE_CHECKOUT_CONFIG`) and verify them with the store owner before publishing. This object is browser-visible and must contain only public business contact/payment details, never credentials.
9. Test customer account and admin permissions in a staging project. Do not place real orders, initiate payments, or change live records during checkout QA.

## Existing Supabase project migration checks

The storefront uses `public.profiles`, `public.wishlists`, and `public.orders`; it does not use tables named `customer_profiles`, `customer_wishlists`, or `customer_orders`. Migration `202610170001_marketplace.sql` creates those base tables and their RLS policies. Migration `202610170003_customer_accounts.sql` adds `public.customer_addresses` and updates the auth-to-profile trigger. Migration `202610170004_terms_consent.sql` adds `public.customer_terms_consents`. The account page reads addresses from `customer_addresses`, but its error message can also be caused by grants, RLS, API exposure, or connectivity, so a failed page query alone does not prove the table is absent.

The reported read-only query returning no rows for the customer-prefixed names does not show whether `profiles`, `wishlists`, or `orders` exist. A zero-row result for `customer_addresses` does indicate that exact table is not visible in the schema queried. First select the correct Supabase project and run these read-only checks in its SQL Editor:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles', 'wishlists', 'orders', 'order_items',
    'customer_addresses', 'customer_terms_consents'
  )
order by table_name;
```

Check the required columns before applying a migration, since `create table if not exists` does not repair an existing table with a different shape:

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'wishlists', 'orders', 'customer_addresses', 'customer_terms_consents')
order by table_name, ordinal_position;
```

Check RLS and installed policies on the customer tables:

```sql
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'wishlists', 'orders', 'customer_addresses', 'customer_terms_consents')
order by c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'wishlists', 'orders', 'customer_addresses', 'customer_terms_consents')
order by tablename, policyname;
```

Also inspect address constraints, indexes, and the profile/address/consent triggers before deciding whether a migration is missing or partially installed:

```sql
select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  to_regclass('public.profiles'), to_regclass('public.customer_addresses'),
  to_regclass('public.customer_terms_consents')
)
order by conrelid::regclass::text, conname;

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('orders', 'customer_addresses', 'customer_terms_consents')
order by tablename, indexname;

select event_object_schema, event_object_table, trigger_name, action_timing,
       event_manipulation, action_statement
from information_schema.triggers
where (event_object_schema = 'public' and event_object_table in ('profiles', 'customer_addresses'))
   or (event_object_schema = 'auth' and event_object_table = 'users')
order by event_object_schema, event_object_table, trigger_name;
```

Use the results to choose the safe action:

- If the expected base tables and policies exist and `customer_addresses` is absent, first confirm `profiles` has the `id` UUID primary key referencing `auth.users(id)`. Then run the complete contents of `supabase/migrations/202610170003_customer_accounts.sql` once in SQL Editor. It depends on `profiles` and `public.is_admin()` from migration `001`.
- If `customer_addresses` already exists with the expected columns, foreign key, index, RLS, and owner/admin policy, do not rerun migration `003`; investigate the Supabase API error, grants, schema exposure, and active user session instead. If it exists with a different or partial shape, stop and review that table before applying anything; the migration will not reconcile it.
- If base tables from `001` are absent, do not run `001` over an existing project with unknown data or partial objects. Stop, compare the pre-check output with the full migration, and plan a reviewed forward-only migration for the specific missing objects. Never drop or reset existing data to make this migration fit.
- Migration `004` has no SQL dependency on `003`: it references Supabase `auth.users`, not `customer_addresses` or `profiles`. Keep the numbered order `001` → `002` → `003` → `004` for a fresh setup. In an existing project, check for the consent table, policies, and auth triggers before applying `004`; don't infer migration state from table names alone. It does not backfill historic consent for existing accounts, so do not create acceptance records for users without verified evidence of acceptance.

After applying `003`, rerun the table, column, RLS, policy, index, and trigger checks. Confirm `customer_addresses` has a foreign key to `profiles(id)`, the `(user_id, created_at)` index, the unique partial index for one default address per customer, enabled RLS, and the `customer addresses own or admin` policy. Then sign in with two separate customer accounts in staging: each should only list, add, edit, and delete its own addresses. Verify the admin flow with a known active administrator. Do not test by disabling RLS or using the service-role key in the browser.

Customer recovery messages use Supabase Auth email templates and the configured SMTP provider. Configure production SMTP, the site URL, and all callback URLs before launch. Review Supabase Auth's email rate limits and enable its available abuse protections before production. Password recovery responses are generic so the page does not reveal whether an email is registered.

Customer signup requires a password of at least 10 characters with at least one number or symbol, matching confirmation, and explicit acceptance of the Terms and Privacy Policy. The signup and guest-account upgrade flows send the accepted terms version (`2026-10-17`) in Supabase Auth metadata. Migration `202610170004_terms_consent.sql` validates that version in a database trigger and inserts one consent row with a database-generated timestamp in the same Auth transaction. The consent table allows customers to read only their own record; browser roles cannot insert, update, or delete consent rows. Anonymous guest sessions do not create a consent record until they are upgraded to a customer account.

To verify in a staging project after applying all four migrations:

1. On `/signup/`, try a password shorter than 10 characters and a 10-character password with no number or symbol. Both should be rejected with a clear message; mismatched confirmation and an unchecked terms box must also block submission.
2. Register with a valid password and checked consent. With email confirmation enabled, complete the emailed confirmation. In the Supabase SQL editor, verify the row and server timestamp:

   ```sql
   select c.user_id, c.terms_version, c.accepted_at
   from public.customer_terms_consents c
   join auth.users u on u.id = c.user_id
   where lower(u.email) = lower('test-customer@example.com');
   ```

   Expect one row with version `2026-10-17` and a populated `accepted_at`. A failed signup must not show the confirmation/success message.
3. Sign in as that customer and try selecting another customer's consent row and inserting, updating, or deleting a consent row through the browser client. The other customer's select should return no rows; all mutations should be denied by table grants/RLS.
4. If testing guest upgrade, create an anonymous guest session, open its account page, explicitly accept the terms, and upgrade it. Verify one consent row appears for that same user ID. Do not set terms metadata manually to simulate consent.

The terms version is tied to the content shown by the Terms page. When that content changes, update the version in the signup client and migration validation together, then apply the new migration to the target project before accepting the revised terms.

The SQL and Edge Function sources below retain the prior order/payment architecture, including `create-order`, Paystack functions, request-key idempotency, payment review, and private receipt storage. The current storefront checkout does not invoke that architecture. Do not interpret these legacy capabilities or order-history pages as evidence that a new WhatsApp enquiry is stored as an order. Preserve existing tables, functions, and records unless a separate reviewed maintenance task establishes they are no longer needed.

Negotiated orders remain unpaid with `negotiation_status = 'awaiting_agreement'` until an admin records the agreed amount and marks the agreement confirmed. The payment Edge Functions use that amount; neither WhatsApp messages nor browser redirects can change an order price or payment state.

## Hosting

The static files can be deployed to Vercel or another static host with `marketplace/` as the output directory. Keep Supabase Edge Functions deployed to Supabase; static hosting must not receive the Supabase service-role key or Paystack secret. For the existing site, `../images/` and `../contact.html` are referenced by the storefront, so deploy the repository root or copy those assets/pages into the host output alongside `marketplace/`.

## Before production

The live catalog and account features depend on the configured Supabase project. The store owner should confirm catalog accuracy, WhatsApp and bank details, delivery arrangements, privacy and returns information, and support contacts before launch. Checkout displays the catalog subtotal and asks customers to confirm availability and the final amount with the store. This workspace has Node.js, but no Supabase CLI, database connection, or browser test runner; live backend checks and visual browser/device QA require those tools and access.
