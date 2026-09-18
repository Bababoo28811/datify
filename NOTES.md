# Datify — Handoff

**Last updated:** 19 Sep 2026
**Owner:** Elisa (sole founder)
**Live site:** GetDatify.com (GitHub Pages)
**Repo:** `C:\Users\Rog\dev\datify` → `https://github.com/Bababoo28811/datify.git`, branch `main`
**Supabase project ref:** `uujbonptqglzndzlovmp` (region ap-northeast-1)
**Admin/founder account:** elisazhu.ys@gmail.com

> **New session?** Read this file first, then check `git log` for anything newer than the date above.

---

## 1. What this is

A Singapore date-deals aggregator for budget-conscious couples. Static single-page
app (no framework, no build step) on GitHub Pages, with Supabase for auth,
database, storage and one edge function.

Elisa knows HTML/CSS/JS but not backend. Explain backend/SQL concepts rather than
just handing over code. She prefers working through a problem step by step, but
will ask directly when she's short on time.

### File map

| File | What's in it |
|---|---|
| `index.html` | The whole customer site. Every "page" is a `.page` div toggled by `go(name)`. |
| `js/app.js` | ~100 KB, the main logic: auth, explore, swipe, planner, saved, detail, contact. No IIFE — functions are global, which is why inline `onclick` works. |
| `css/style.css` | ~43 KB. Theming is CSS custom properties on `:root`, flipped by `[data-theme="dark"]`. |
| `js/theme.js` | Dark mode toggle + localStorage. Loaded in `<head>` on every page to avoid a flash. |
| `supplier-dashboard.html` + `js/supplier.js` + `css/supplier.css` | Supplier portal: add/edit deals, categories, image upload. |
| `admin.html` + `js/admin.js` | Founder-only approval queue (shares `css/supplier.css`). |
| `js/supabase-client.js` | Creates the `db` client. Must load before `app.js`. |
| `supabase-rls-policies.sql` | Reference dump of the live RLS policies. See section 2. |

The dead root files (`supplier.js`, `supabase.js`, `Claude outputs/`) were deleted
19 Sep. They're in git history if ever needed.

---

## 2. Database (verified 19 Sep)

| Table | Rows | Notes |
|---|---|---|
| `deals` | 19 | all approved; 12 are in Central |
| `free_activities` | 14 | planner uses these to fill gaps |
| `public_holidays` | 26 | SG gazetted 2026 + 2027, incl. observed Mondays |
| `saved_deals` | 11 | shortlists |
| `saved_plans` | 0 | new 17 Sep |
| `travel_times` | 5 | OneMap route cache |
| `onemap_token` | 1 | auto-renewed |
| `categories` | 4 | Dining 14 / Activities 3 / Outdoor 1 / Drinks 1 |
| `profiles` | 2 | admin queue reads this for supplier emails |
| `contact_messages` | 1 | |
| `supplier_whitelist` | 1 | Elisa only |
| `suppliers` | 0 | **dead, pending drop** — see section 5 |

15 deals have a real price; 4 are percentage-discount offers (`price = 0` +
`discount_label`). All 19 are geocoded and have `time_slots`.

Deal vibes: Fun 6, Foodie 5, Chill 3, Romantic 3, Adventurous 2.

### Columns added this month

- **`deals.time_slots`**, **`free_activities.time_slots`** — `text[]` from
  `morning, midday, afternoon, evening, late` (check constraint). NULL = any time.
  Windows: morning <12pm, midday 11:30–2:30, afternoon 2–6, evening 6–9:30,
  late 9pm+. All 33 rows tagged.
- **`deals.days`** — `text[]` of `mon..sun`. NULL = every day. Set on 5 deals
  (Crossroads, HaHaHotpot = Mon–Fri; Fireplace = Mon–Sat; OMMA = Mon–Thu;
  Treasures of the Sea = Fri–Sat).
- **`deals.holiday_validity`** — `jsonb`, e.g. `{"2026-11-09": false}`.
  true = valid that holiday, false = not valid, **missing = supplier never asked**
  (treated as valid). Crossroads and HaHaHotpot are marked false on every weekday
  holiday through 2027.
- **`deals_dates_order`** constraint: `end_date >= start_date`.

### Scheduled release

A deal with a future `start_date` is hidden from the public and appears on its own
that day. No cron: `deals_public_read` / `deals_select_authenticated` check
`start_date <= (now() at time zone 'Asia/Singapore')::date` on every read. The
end_date check uses Singapore time too (it was UTC, so deals flipped at 8am SGT).
Suppliers still see their own scheduled deals. There is no "is this live" flag —
the phase (scheduled / active / expired) is always derived from the dates
(`dealPhase()` in `supplier.js`).

### Security

`supabase-rls-policies.sql` was rewritten 19 Sep. The old version described
policies that no longer existed: its `DROP POLICY IF EXISTS` guards named the
*old* policy names, so re-running the file (which it advertised as safe) would
have **added** `anyone can read deals USING (true)` alongside the live policy.
Postgres ORs permissive policies together, so that would have exposed every
pending, rejected and unreleased deal to the public. The file is now a dump of
what is actually live, with DROP guards that match the real names.

**If you change a policy in the dashboard, re-dump that file. A stale copy is
worse than no copy.**

`get_advisors(security)` returns:
- `auth_leaked_password_protection` (WARN) — Pro plan only, leave it.
- `rls_enabled_no_policy` (INFO) ×2 for `onemap_token` and `travel_times` —
  **intentional**: RLS on with no policies means only the service role (the edge
  function) can touch them.

Do not regress these:
- `categories` needs its public read policy or logged-out visitors see nothing.
- `deals_select_authenticated` covers anon and authenticated. Don't split it back
  into an anon-only policy — that's what made logged-in users see zero deals.
- `deals_admin_select` lets the founder account read every deal. Without it the
  admin queue shows nothing pending.
- Insert policies check `supplier_whitelist`.
- `guard_deal_status_change` must keep its `if (select auth.jwt()) is null then
  return NEW; end if;` guard, or any service-role update un-approves deals.
- Never add a broader SELECT policy on `deals`.

---

## 3. Edge function: `travel-time`

`POST /functions/v1/travel-time` with
`{ legs:[{from:{lat,lng},to:{lat,lng}}], date, time }` →
`{ legs:[{minutes, mode:'walk'|'pt'}|null] }`.

- Logs in to OneMap with the **`onemap_email` / `onemap_password`** secrets
  (lowercase in the dashboard; the function accepts either case) and stores the
  token in `onemap_token`. OneMap tokens last 3 days and are renewed when under an
  hour remains, so nothing is renewed by hand.
- Under 800 m it returns a walking estimate without calling OneMap. Longer hops
  call the routing API and are cached in `travel_times` (key = coords to 4 d.p.).
- `verify_jwt` is **off** (the site uses a publishable, non-JWT key). Abuse is
  limited by max 8 legs per call, a Singapore bounding box, and the cache.
- Verified live: Parkway Parade → CBD 30 min; Merlion → Marina Bay 11 min walk.
- If it fails, the site keeps its own estimates — nothing breaks.

**OneMap account:** registered to Elisa; password reset via
onemap.gov.sg → Account Settings → Forget Password.

---

## 4. What's built

- Auth with password rules shown before submit; guest shortlist in localStorage
  that merges into the account on sign-in (`mergeGuestShortlist`).
- Explore with category, vibe, price and area filters. Deal detail page with the
  4-card meta grid (Category / When / Offer ends / Location) — **Elisa likes this
  layout, don't change it**. The When card also shows day rules.
- **Price filters** (19 Sep): percentage offers are stored as `price = 0`, so they
  used to fall into "Under $20" — the Zoo at "up to 26% off" is about $38pp. They
  now have their own **"% off"** bucket and are excluded from the money buckets,
  with a line explaining the price isn't fixed.
- Browse cards: image → tag/heart → title → location → price → "Add to plan".
  The footer wraps rather than squeezing the button when a discount label is long.
- Swipe: setup screen first (budget / area / optional vibe), then matches
  cheapest-first, a divider card, then everything else ranked by how far off it is.
  Guest save count sits in the header next to "Change filters" — a toast there
  landed on top of the ✕ / ♡ buttons on a short phone.
- **Planner** (`buildItinerary` in `app.js`): walks the date from the start time
  and only places a stop whose `time_slots` fit that hour and whose `days` /
  holiday answers allow that date. Meals need 3h apart; travel time counts toward
  duration; no paid stop more than 40 min away; free stops within 5 km; max 2 free
  in a row. Percentage-only deals are excluded unless pinned.
- **"What to include?"** (19 Sep): was six chips that only toggled a CSS class and
  were never read by `readPlannerParams()`. Two of them (Live Music, Art) weren't
  even real categories. Now four real ones, wired as a *soft* preference —
  inventory outside Dining is thin, so it falls back to the wider pool and the
  plan says when it had to.
- **Foodie vibe** added to the planner (19 Sep). Swipe already offered it, so 5 of
  19 deals were unreachable by vibe from the planner.
- **Plan page** renders entirely from `currentPlan`: Regenerate, Remove (Undo),
  Replace, Save, travel pills (estimate first, real OneMap times a moment later).
  Suggestions under the plan are filtered to what fits the remaining budget *and*
  the time window. A plan that ends early now says so instead of silently handing
  back a shorter date.
- **Add to plan** respects day-of-week and public-holiday rules (19 Sep) — it
  previously let a Mon–Fri-only deal slot into a Saturday plan without a word.
- **Saved plans**: account (`saved_plans`) or device (`datify-guest-plans`),
  merged on sign-in.
- Supplier portal: Scheduled/Active/Expired status, time-of-day chips, Mon–Sun
  chips, per-holiday Valid / Not valid question. Saving is blocked until answered.
- Admin approval queue.
- Dark mode, hamburger-only nav, How It Works, contact form.

### Responsive (19 Sep)

Tested 375 / 390 / 667 / 768 / 820 / 1024 / 1280 — no horizontal overflow on any
page at any width.

- There was **no breakpoint between 650px and desktop**, so iPad got the desktop
  layout. Added a 651–900px band: vibe tiles drop from 5 across (117px, labels
  wrapping) to 3, and the detail sidebar narrows 320px → 260px.
- Explore's filter bar stacks its two groups once it wraps (≤900px). "Price:" used
  to trail a row of category chips and read as one of them.
- Phone: hero buttons no longer wrap to two lines, results pills fit 2 rows
  instead of 3, "Change filters" is a 37px tap target rather than 17px.

The supplier and admin tables are wrapped in `.table-scroll{overflow-x:auto}` so
they scroll sideways rather than breaking. **Their layouts have never actually
been checked on a phone** — both pages redirect when signed out.

---

## 5. Open items

### Blocks launch

**Email delivery — in progress, needs a live test.** Supabase's built-in mailer is
development-only (a couple of messages an hour, shared sending domain, lands in
spam). That's why confirmations never arrived — not a bug to work around.

Done 19 Sep:
- Resend account, `getdatify.com` added, region **Tokyo (ap-northeast-1)**
- DNS in Namecheap: DKIM `resend._domainkey`, CNAMEs `send` + `rsend`, DMARC
  `_dmarc`. All confirmed resolving from Namecheap's own nameservers.
- Domain shows **Verified** in Resend
- Custom SMTP saved in Supabase (`smtp.resend.com`, port 465, user `resend`)

**Still to do: sign up with a fresh address and confirm the mail arrives.** Keep
"Confirm email" ON — turning it off is what lets people sign up with addresses
they don't own. Then check Supabase auth logs and Resend's Logs tab. Also raise
Supabase's auth rate limit; it stays low even after custom SMTP is attached.

⚠️ While editing DNS on 19 Sep the four apex `A` records were accidentally deleted
and the root domain briefly stopped resolving. They're restored
(`185.199.108–111.153`, host `@`). **Those and the `www` CNAME
(`bababoo28811.github.io`) must never be removed** — the checkboxes in Namecheap's
record list are bulk-*delete* selection, not enable toggles.

### Next up

1. **Drop the `suppliers` table.** 0 rows, no FKs, no triggers, no views, no code
   reference. A tool safety classifier blocked the DROP on 19 Sep, so run it by
   hand in the SQL editor:
   ```sql
   drop table if exists public.suppliers;
   ```
   Original shape if it ever needs recreating: `id uuid not null`,
   `business_name text`, `created_at timestamptz not null default now()`.
2. **Inventory.** 19 deals, 12 Central. "Under $15 in the East" has zero exact
   matches. This is content, not code.
3. **Fill in `original_price` on the 4 percentage deals.** Without it the detail
   page can't show what "Up to 26% off" is off *of*, so it's unbudgetable.
4. **Move the Zoo's real catch out of the description.** "Discounted admission for
   WildPass holders" is the actual condition and it's buried in prose.
5. **Public holidays run out after 2027.** MOM publishes the next year around June.
6. **OMMA and Fireplace** have day rules but no public-holiday answers.
7. **Deal durations** are a flat 60 min for every deal. A real `duration_mins`
   field would make plan timings honest.

### Deferred on purpose

- **Leaked-password protection** — Pro plan only.
- **"$3.90/dish" and "$10 min. spend"** stay in "Under $20". Technically true and
  the unit is displayed, but they aren't really sub-$20 dates.

---

## 6. Gotchas

- **The repo used to live in OneDrive and silently reverted files.** It was moved
  to `C:\Users\Rog\dev\datify` to stop that. Don't move it back.
- **`--white` is the surface token and flips in dark mode. `--on-accent` is text on
  pink and never flips.** Also watch for hardcoded `background:#fff`.
- **Times are Singapore time.** `sgToday()` in `app.js` / `supplier.js`;
  `toISOString()` is UTC and is wrong here before 8am.
- **A transformed absolutely-positioned element can resize the document.** The
  swipe card flying off at `translateX(±600px)` made the page 1036px wide on a
  375px screen, which let the browser pan sideways and reset scroll to the top on
  every swipe. Fixed with `#page-swipe{overflow-x:clip}` — `clip` not `hidden`,
  because `hidden` would make it a scroll container. If you add another fly-off
  animation, check `document.documentElement.scrollWidth` mid-animation.
- **The swipe page only scrolls on short screens.** At 375×812 it fits exactly, so
  scroll bugs there are invisible. Test at 375×667.
- **Percentage deals have `price = 0`.** Anything that buckets or sums by price
  must check `hasFixedPrice(d)` first, or they read as free/cheapest.
- **Local preview:** there's no working `python` on this machine (the Microsoft
  Store stub shadows it). Use a small Node static server. `node --check <file>`
  works for JS syntax checking.

---

## 7. Where to pick up

1. **Test the signup email** (section 5). It's the last step of the launch blocker.
2. Drop the `suppliers` table — one line in the SQL editor.
3. Add deals outside Central.
4. Fill in `original_price` on the percentage deals.
5. Check the supplier dashboard and admin queue on a phone while signed in.
