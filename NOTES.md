# Datify — Handoff

**Last updated:** 18 Sep 2026
**Owner:** Elisa (sole founder)
**Live site:** GetDatify.com (GitHub Pages)
**Repo:** `C:\Users\Rog\dev\datify` → `https://github.com/Bababoo28811/datify.git`, branch `main`
**Supabase project ref:** `uujbonptqglzndzlovmp` (region ap-northeast-1)
**Admin/founder account:** elisazhu.ys@gmail.com

> **New session?** Read this file first, then check `git log` for anything newer than the date above. Everything below was pushed as of 18 Sep.

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
| `js/app.js` | ~97 KB, the main logic: auth, explore, swipe, planner, saved, detail, contact. No IIFE — functions are global, which is why inline `onclick` works. |
| `css/style.css` | ~43 KB. Theming is CSS custom properties on `:root`, flipped by `[data-theme="dark"]`. |
| `js/theme.js` | Dark mode toggle + localStorage. Loaded in `<head>` on every page to avoid a flash. |
| `supplier-dashboard.html` + `js/supplier.js` + `css/supplier.css` | Supplier portal: add/edit deals, categories, image upload. |
| `admin.html` + `js/admin.js` | Founder-only approval queue (shares `css/supplier.css`). |
| `js/supabase-client.js` | Creates the `db` client. Must load before `app.js`. |

**Dead files at repo root that should be deleted:** `supplier.js` (stale duplicate
of `js/supplier.js`), `supabase.js` (superseded by `js/supabase-client.js`), and
the `Claude outputs/` folder. Nothing references them.

---

## 2. Database (verified 18 Sep)

| Table | Rows | Notes |
|---|---|---|
| `deals` | 19 | all approved; 12 are in Central |
| `free_activities` | 14 | planner uses these to fill gaps |
| `public_holidays` | 26 | SG gazetted 2026 + 2027, incl. observed Mondays |
| `saved_deals` | 11 | shortlists |
| `saved_plans` | 0 | new 17 Sep |
| `travel_times` | 5 | OneMap route cache |
| `onemap_token` | 1 | auto-renewed |
| `categories` | 4 | Dining / Drinks / Activities / Outdoor |
| `supplier_whitelist` | 1 | Elisa only |

15 deals have a real price; 4 are percentage-discount offers (`price = 0` +
`discount_label`). All 19 are geocoded and have `time_slots`.

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

`get_advisors(security)` returns:
- `auth_leaked_password_protection` (WARN) — Pro plan only, leave it.
- `rls_enabled_no_policy` (INFO) ×2 for `onemap_token` and `travel_times` —
  **intentional**: RLS on with no policies means only the service role (the edge
  function) can touch them.

Do not regress these:
- `categories` needs its public read policy or logged-out visitors see nothing.
- `deals_select_authenticated` covers anon and authenticated. Don't split it back
  into an anon-only policy — that's what made logged-in users see zero deals.
- `deals_admin_select` (16 Sep) lets the founder account read every deal. Without
  it the admin queue shows nothing pending: admin update/delete policies existed
  but there was no admin SELECT, so pending deals were invisible.
- Insert policies check `supplier_whitelist`.
- `guard_deal_status_change` must keep its `if (select auth.jwt()) is null then
  return NEW; end if;` guard, or any service-role update un-approves deals.
- Functions that were hardened have `search_path` pinned.
- Default `EXECUTE` grants go to `PUBLIC`, not `anon`/`authenticated`.

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
- Verified live: Parkway Parade → CBD 30 min; Merlion → Marina Bay 11 min walk;
  Bukit Timah → Jewel 77 min.
- If it fails, the site keeps its own estimates — nothing breaks.

**OneMap account:** registered to Elisa; password reset via
onemap.gov.sg → Account Settings → Forget Password. The confirm-code page is
Account Settings → Verify Confirmation Code.

---

## 4. What's built

- Auth with password rules shown before submit; guest shortlist in localStorage
  that merges into the account on sign-in (`mergeGuestShortlist`).
- Explore with category, vibe, price and area filters. Deal detail page with the
  4-card meta grid (Category / When / Offer ends / Location) — **Elisa likes this
  layout, don't change it**. The When card also shows day rules, e.g.
  "Mon–Fri only · not on public holidays".
- Browse cards: image → tag/heart → title → location → price → "Add to plan".
  Hours/expiry chips were tried and rejected as too cramped.
- Swipe: setup screen first (budget / area / optional vibe), then matches
  cheapest-first, a divider card, then everything else ranked by how far off it is
  (wrong area 1, wrong vibe 0.5, over budget by the fraction over). `total` prices
  are halved per person; percentage offers count as within budget.
- **Planner** (`buildItinerary` in `app.js`): walks the date from the start time
  and only places a stop whose `time_slots` fit that hour and whose `days` /
  holiday answers allow that date. Rules: meals need 3h apart; if the date covers
  lunch/dinner a meal outranks vibe (not after 9pm); travel time between stops
  counts toward the duration; no paid stop more than 40 min away; free "nearby"
  stops within 5 km; max 2 free stops in a row; the first stop leans toward where
  the deals cluster (or the chosen area); if nothing fits it waits 15 min and
  retries. Percentage-only deals are excluded unless pinned via Add to plan.
- **Plan page** renders entirely from `currentPlan`, so these all stay in sync:
  title from vibe + start time; Regenerate (avoids the current stops + jitter);
  Remove (with Undo); Replace (up to 4 alternatives that fit the slot, day,
  budget, area, travel and meal spacing); Save; travel pills between stops
  (estimate first, real OneMap times a moment later, then stops are re-timed).
- **Add to plan** (deal cards + detail page): adds to the open plan at the
  best-fitting position with Undo, or opens the planner with a
  "📌 Planning around X" banner and builds around that deal. Says why when it
  can't fit, e.g. "(afternoons, Fri–Sat only)".
- **Saved plans**: account (`saved_plans`, own-rows-only policies) or device
  (`datify-guest-plans`), merged on sign-in. Reopen or delete from Saved → Plans;
  tells you if a saved stop has since ended.
- Supplier portal: Scheduled/Active/Expired status, Scheduled stat card, "Best
  time of day" chips, Mon–Sun chips, and a per-holiday Valid / Not valid question
  that only appears when the deal's dates and days actually cover a holiday
  (with All valid / None valid shortcuts). Saving is blocked until each one is
  answered.
- Admin approval queue; nav badge on the right with "← Back to Datify".
- Dark mode, hamburger-only nav, How It Works, contact form.

---

## 5. Open items

### Blocks launch

**Email delivery.** Supabase's built-in mailer doesn't reliably deliver
confirmation emails — Elisa's own account had to be confirmed directly in the DB.
Either wire up Resend (or SendGrid) SMTP in Supabase Auth, or turn off "Confirm
email" until it's sorted. Domain is on **Namecheap**; Resend setup was started and
paused. Next step: add getdatify.com in Resend (Tokyo region), copy its DNS
records into Namecheap Advanced DNS without touching the GitHub Pages records.

### Next up

1. **Inventory.** 19 deals, 12 Central. "Under $15 in the East" still has zero
   exact matches, and plans repeat for a returning visitor. This is content, not
   code.
2. **Delete the dead root files** (section 1).
3. **Public holidays run out after 2027.** MOM publishes the next year around June;
   top up `public_holidays` then, or add a yearly job that pulls from data.gov.sg.
   Ongoing deals won't have answers for new holidays until a supplier edits them.
4. **Weekday-only nuance not covered:** OMMA and Fireplace have day rules but were
   not marked as excluded on public holidays — their listings don't say. Check
   their terms and tick the box if needed.
5. **Deal durations** are a flat 60 min for every deal. A real `duration_mins`
   field on `deals` would make plan timings honest.

### Deferred on purpose

- **Leaked-password protection** — Pro plan only.
- **OneMap Search/geocoding** still works without a token; only routing needed the
  login, and that now lives in the edge function.

---

## 6. Gotchas

- **The repo used to live in OneDrive and silently reverted files.** It was moved
  to `C:\Users\Rog\dev\datify` to stop that. Don't move it back.
- **`device_commit_files` can write a stale cached snapshot** if you reuse an
  outputs path. Use a fresh path per commit, and re-stage afterwards to confirm
  what landed.
- **There's no `device_bash` on this machine.** You can't run git/node/npm on her
  computer. Stage files, edit them in the container, commit them back; Elisa runs
  git herself. You *can* stage `.git/logs/HEAD` to read commit history and
  `.git/refs/...` to check what's pushed.
- **The container's egress blocks Supabase and Unsplash.** To test logic: serve
  the repo with `python3 -m http.server`, and in Playwright abort all `https:`
  requests, fulfil the `supabase-js` CDN request with a stub whose
  `createClient().from(table)` returns rows pulled via the Supabase MCP, and fake
  `/functions/v1/travel-time`. Register the abort route **before** the stub route;
  later routes win. The local server dies between shell calls — start it in the
  same command as the test.
- **To exercise the real edge function**, run `fetch` from the built-in browser on
  getdatify.com (the OneMap site's CSP blocks it).
- **`--white` is the surface token and flips in dark mode. `--on-accent` is text on
  pink and never flips.** Also watch for hardcoded `background:#fff`.
- **Times are Singapore time.** `sgToday()` in `app.js` / `supplier.js`;
  `toISOString()` is UTC and is wrong here before 8am.

---

## 7. Where to pick up

1. Email delivery (blocks launch) — Resend + Namecheap, or turn off Confirm email.
2. Add deals outside Central (East / West / North / North-East).
3. Delete the dead root files.
4. Optional polish: real per-deal durations; a "why this plan" line explaining the
   picks; public-holiday top-up job.
