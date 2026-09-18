-- ============================================================
-- Datify — Row Level Security policies
--
-- This mirrors the policies that are LIVE on the Supabase project
-- (ref uujbonptqglzndzlovmp), dumped from pg_policies on 18 Sep 2026.
-- It exists as disaster recovery and as a readable record of the rules.
--
-- Safe to re-run: every DROP below names the policy that is actually
-- live, so re-running replaces each policy instead of adding a second
-- one next to it. That matters because Postgres combines PERMISSIVE
-- policies for the same command with OR — a stray extra SELECT policy
-- using (true) would silently defeat every check in here.
--
-- If you change a policy in the Supabase dashboard, re-dump this file.
-- A stale copy is worse than no copy.
-- ============================================================


-- ------------------------------------------------------------
-- supplier_whitelist — a signed-in user may only check whether
-- THEIR OWN email is on it, which is all the app ever needs.
-- No insert/update/delete policy on purpose: with RLS on and no
-- matching policy those are denied, so the table is managed by
-- hand from the dashboard's Table Editor.
-- ------------------------------------------------------------
alter table supplier_whitelist enable row level security;

drop policy if exists whitelist_select on supplier_whitelist;
create policy whitelist_select
  on supplier_whitelist for select
  to authenticated
  using (email = (select auth.email()));


-- ------------------------------------------------------------
-- categories — public read, owner-only write, admin override.
-- ------------------------------------------------------------
alter table categories enable row level security;

drop policy if exists categories_public_read on categories;
create policy categories_public_read
  on categories for select
  to anon, authenticated
  using (true);

drop policy if exists categories_insert on categories;
create policy categories_insert
  on categories for insert
  to authenticated
  with check (
    supplier_id = (select auth.uid())
    and exists (
      select 1 from supplier_whitelist w
      where w.email = (select auth.jwt() ->> 'email')
    )
  );

drop policy if exists categories_update on categories;
create policy categories_update
  on categories for update
  to authenticated
  using (supplier_id = (select auth.uid()))
  with check (supplier_id = (select auth.uid()));

drop policy if exists categories_delete on categories;
create policy categories_delete
  on categories for delete
  to authenticated
  using (supplier_id = (select auth.uid()));

drop policy if exists categories_admin_all on categories;
create policy categories_admin_all
  on categories for all
  to authenticated
  using      ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com');


-- ------------------------------------------------------------
-- deals — the public only ever sees approved deals that are inside
-- their date window, in Singapore time. There is no "is this live"
-- flag; the phase is always derived from the dates, so the policy
-- and the UI cannot disagree.
--
-- Do NOT add a broader SELECT policy here (e.g. `using (true)`).
-- Permissive policies are OR'd, so one would expose every pending,
-- rejected and not-yet-started deal to anonymous visitors.
-- ------------------------------------------------------------
alter table deals enable row level security;

drop policy if exists deals_public_read on deals;
create policy deals_public_read
  on deals for select
  to anon
  using (
    status = 'approved'
    and (start_date is null or start_date <= (now() at time zone 'Asia/Singapore')::date)
    and (ongoing = true or end_date is null or end_date >= (now() at time zone 'Asia/Singapore')::date)
  );

-- Covers anon AND authenticated visitors. Don't narrow this back to an
-- anon-only policy: that is what made logged-in users see zero deals.
-- The extra OR is what lets a supplier see their own pending/scheduled rows.
drop policy if exists deals_select_authenticated on deals;
create policy deals_select_authenticated
  on deals for select
  to authenticated
  using (
    (
      status = 'approved'
      and (start_date is null or start_date <= (now() at time zone 'Asia/Singapore')::date)
      and (ongoing = true or end_date is null or end_date >= (now() at time zone 'Asia/Singapore')::date)
    )
    or supplier_id = (select auth.uid())
  );

-- Without this the admin queue shows nothing: the admin update/delete
-- policies existed but there was no admin SELECT, so pending deals were
-- invisible to the only account allowed to approve them.
drop policy if exists deals_admin_select on deals;
create policy deals_admin_select
  on deals for select
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com');

drop policy if exists deals_insert on deals;
create policy deals_insert
  on deals for insert
  to authenticated
  with check (
    supplier_id = (select auth.uid())
    and exists (
      select 1 from supplier_whitelist w
      where w.email = (select auth.jwt() ->> 'email')
    )
  );

drop policy if exists deals_update on deals;
create policy deals_update
  on deals for update
  to authenticated
  using (supplier_id = (select auth.uid()))
  with check (supplier_id = (select auth.uid()));

drop policy if exists deals_delete on deals;
create policy deals_delete
  on deals for delete
  to authenticated
  using (supplier_id = (select auth.uid()));

drop policy if exists deals_admin_insert on deals;
create policy deals_admin_insert
  on deals for insert
  to authenticated
  with check ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com');

drop policy if exists deals_admin_update on deals;
create policy deals_admin_update
  on deals for update
  to authenticated
  using      ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com');

drop policy if exists deals_admin_delete on deals;
create policy deals_admin_delete
  on deals for delete
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com');


-- ------------------------------------------------------------
-- free_activities — the planner's free filler. Only active rows
-- are public.
-- ------------------------------------------------------------
alter table free_activities enable row level security;

drop policy if exists free_activities_public_read on free_activities;
create policy free_activities_public_read
  on free_activities for select
  to anon, authenticated
  using (active = true);

drop policy if exists free_activities_admin_all on free_activities;
create policy free_activities_admin_all
  on free_activities for all
  to authenticated
  using      ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com');


-- ------------------------------------------------------------
-- public_holidays — read by both the site and the supplier form.
-- ------------------------------------------------------------
alter table public_holidays enable row level security;

drop policy if exists public_holidays_read on public_holidays;
create policy public_holidays_read
  on public_holidays for select
  to anon, authenticated
  using (true);

drop policy if exists public_holidays_admin_write on public_holidays;
create policy public_holidays_admin_write
  on public_holidays for all
  to authenticated
  using      ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com');


-- ------------------------------------------------------------
-- saved_deals / saved_plans — a user only ever touches their own rows.
-- Guests keep theirs in localStorage and they merge in on sign-in.
-- ------------------------------------------------------------
alter table saved_deals enable row level security;

drop policy if exists saved_deals_select_own on saved_deals;
create policy saved_deals_select_own
  on saved_deals for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists saved_deals_insert_own on saved_deals;
create policy saved_deals_insert_own
  on saved_deals for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists saved_deals_delete_own on saved_deals;
create policy saved_deals_delete_own
  on saved_deals for delete
  to authenticated
  using (user_id = (select auth.uid()));

alter table saved_plans enable row level security;

drop policy if exists saved_plans_select_own on saved_plans;
create policy saved_plans_select_own
  on saved_plans for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists saved_plans_insert_own on saved_plans;
create policy saved_plans_insert_own
  on saved_plans for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists saved_plans_delete_own on saved_plans;
create policy saved_plans_delete_own
  on saved_plans for delete
  to authenticated
  using (user_id = (select auth.uid()));


-- ------------------------------------------------------------
-- contact_messages — anyone may write in; only the founder reads.
-- ------------------------------------------------------------
alter table contact_messages enable row level security;

drop policy if exists contact_messages_public_insert on contact_messages;
create policy contact_messages_public_insert
  on contact_messages for insert
  to anon, authenticated
  with check (true);

drop policy if exists contact_messages_admin_select on contact_messages;
create policy contact_messages_admin_select
  on contact_messages for select
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com');


-- ------------------------------------------------------------
-- profiles — own row, plus admin read so the approval queue can
-- show which supplier submitted a deal.
-- ------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists "Users can view own profile" on profiles;
create policy "Users can view own profile"
  on profiles for select
  using ((select auth.uid()) = id);

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile"
  on profiles for update
  using      ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists profiles_admin_select_all on profiles;
create policy profiles_admin_select_all
  on profiles for select
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'elisazhu.ys@gmail.com');


-- ------------------------------------------------------------
-- onemap_token / travel_times — RLS is ON with NO policies, on
-- purpose. That denies every anon/authenticated client and leaves
-- them reachable only by the service role, i.e. the travel-time
-- edge function. get_advisors() reports this as rls_enabled_no_policy
-- (INFO); that finding is expected, don't "fix" it by adding a policy.
-- ------------------------------------------------------------
alter table onemap_token enable row level security;
alter table travel_times enable row level security;


-- ------------------------------------------------------------
-- Storage bucket "deal-images" — public read, owner-scoped upload.
-- Uploads go to "<supplier_uid>/<filename>", which is what
-- uploadImage() in js/supplier.js writes.
--
-- There is deliberately no update/delete policy: images are only
-- ever added, never replaced in place (uploadImage uses a fresh
-- timestamped path each time, with upsert: false).
-- ------------------------------------------------------------
drop policy if exists public_read_deal_images on storage.objects;
create policy public_read_deal_images
  on storage.objects for select
  using (bucket_id = 'deal-images');

drop policy if exists suppliers_upload_deal_images on storage.objects;
create policy suppliers_upload_deal_images
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'deal-images'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
