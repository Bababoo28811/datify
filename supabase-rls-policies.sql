-- ============================================================
-- Datify — Row Level Security policies
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run
-- Safe to re-run: DROP POLICY IF EXISTS guards against duplicate-name errors.
-- ============================================================

-- ------------------------------------------------------------
-- supplier_whitelist — fully locked down.
-- A signed-in user may only check whether THEIR OWN email is on
-- it (which is all the app ever needs). No client can insert,
-- update, or delete rows — manage this table yourself from the
-- Supabase dashboard's Table Editor.
-- ------------------------------------------------------------
alter table supplier_whitelist enable row level security;

drop policy if exists "read own whitelist row" on supplier_whitelist;
create policy "read own whitelist row"
  on supplier_whitelist for select
  to authenticated
  using (email = auth.jwt() ->> 'email');

-- (No insert/update/delete policy is added on purpose — with RLS
-- enabled and no matching policy, those actions are denied by
-- default for anon/authenticated clients.)


-- ------------------------------------------------------------
-- categories — public read, owner-only write.
-- ------------------------------------------------------------
alter table categories enable row level security;

drop policy if exists "anyone can read categories" on categories;
create policy "anyone can read categories"
  on categories for select
  to anon, authenticated
  using (true);

drop policy if exists "suppliers can create their own categories" on categories;
create policy "suppliers can create their own categories"
  on categories for insert
  to authenticated
  with check (
    auth.uid() = supplier_id
    and exists (
      select 1 from supplier_whitelist w
      where w.email = auth.jwt() ->> 'email'
    )
  );

drop policy if exists "suppliers can update their own categories" on categories;
create policy "suppliers can update their own categories"
  on categories for update
  to authenticated
  using (auth.uid() = supplier_id)
  with check (auth.uid() = supplier_id);

drop policy if exists "suppliers can delete their own categories" on categories;
create policy "suppliers can delete their own categories"
  on categories for delete
  to authenticated
  using (auth.uid() = supplier_id);


-- ------------------------------------------------------------
-- deals — public read, owner-only write.
-- ------------------------------------------------------------
alter table deals enable row level security;

drop policy if exists "anyone can read deals" on deals;
create policy "anyone can read deals"
  on deals for select
  to anon, authenticated
  using (true);

drop policy if exists "suppliers can create their own deals" on deals;
create policy "suppliers can create their own deals"
  on deals for insert
  to authenticated
  with check (
    auth.uid() = supplier_id
    and exists (
      select 1 from supplier_whitelist w
      where w.email = auth.jwt() ->> 'email'
    )
  );

drop policy if exists "suppliers can update their own deals" on deals;
create policy "suppliers can update their own deals"
  on deals for update
  to authenticated
  using (auth.uid() = supplier_id)
  with check (auth.uid() = supplier_id);

drop policy if exists "suppliers can delete their own deals" on deals;
create policy "suppliers can delete their own deals"
  on deals for delete
  to authenticated
  using (auth.uid() = supplier_id);


-- ------------------------------------------------------------
-- Storage bucket "deal-images" — public read, owner-scoped write.
-- Assumes uploads always go to "<supplier_uid>/<filename>", which
-- is exactly what supplier.js's uploadImage() already does.
-- ------------------------------------------------------------
drop policy if exists "anyone can view deal images" on storage.objects;
create policy "anyone can view deal images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'deal-images');

drop policy if exists "suppliers can upload their own deal images" on storage.objects;
create policy "suppliers can upload their own deal images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'deal-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "suppliers can update their own deal images" on storage.objects;
create policy "suppliers can update their own deal images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'deal-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "suppliers can delete their own deal images" on storage.objects;
create policy "suppliers can delete their own deal images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'deal-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
