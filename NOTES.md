# Datify — Handoff

**Last updated:** 16 Sep 2026
**Owner:** Elisa (sole founder)
**Live site:** GetDatify.com (GitHub Pages)
**Repo:** `C:\Users\Rog\dev\datify` → `https://github.com/Bababoo28811/datify.git`, branch `main`
**Supabase project ref:** `uujbonptqglzndzlovmp` (region ap-northeast-1)
**Admin/founder account:** elisazhu.ys@gmail.com

> **New session?** Read this file first, then check `git log` on the repo for anything newer than the date above. Update this file at the end of every session.

---

## 1. What this is

A Singapore date-deals aggregator for budget-conscious couples. Static single-page
app (no framework, no build step) served from GitHub Pages, with Supabase for auth,
database and image storage.

Elisa knows HTML/CSS/JS but not backend. Explain backend/SQL concepts rather than
just handing over code. She prefers working through a problem step by step over
getting the finished answer, but will ask directly when she's short on time.

### File map

| File | What's in it |
|---|---|
| `index.html` | The whole customer site. Every "page" is a `.page` div toggled by `go(name)`. |
| `js/app.js` | ~70 KB, the main logic: auth, explore, swipe, planner, saved, detail, contact. No IIFE — functions are global, which is why inline `onclick` works. |
| `css/style.css` | ~41 KB. Theming is CSS custom properties on `:root`, flipped by `[data-theme="dark"]`. |
| `js/theme.js` | Dark mode toggle + localStorage persistence. Loaded in `<head>` on every page to avoid a flash. |
| `supplier-dashboard.html` + `js/supplier.js` + `css/supplier.css` | Supplier portal: add/edit deals, categories, image upload. |
| `admin.html` + `js/admin.js` | Founder-only approval queue. |
| `js/supabase-client.js` | Creates the `db` client. Must load before `app.js`. |

**Dead files at repo root that should be deleted:** `supplier.js` (stale duplicate of
`js/supplier.js`), `supabase.js` (superseded by `js/supabase-client.js`), and the
`Claude outputs/` folder. Nothing references them. Left in place only because nobody
confirmed it was safe to delete.

---

## 2. Database state (verified 16 Sep)

| Table | Rows | Notes |
|---|---|---|
| `deals` | 19 | all 19 approved (16 Sep) |
| `free_activities` | 14 | Used by the planner to fill gaps |
| `categories` | 4 | |
| `supplier_whitelist` | 1 | Only Elisa's account |
| `saved_deals` | 0 | No real users yet |
| `contact_messages` | 0 | |
| `auth.users` | 2 | |

Of the 19 deals: 15 have a real price, 4 are percentage-discount offers with
`price = 0` and a `discount_label`. 12 are in Central. 7 have `opening_hours`
filled in; the other 12 are deliberately NULL and render "Hours not stated —
check with venue" rather than a made-up claim. All 19 are geocoded
(`latitude`/`longitude` populated), 12 have an `end_date`.

The 4 percentage-discount deals (F1 Exhibition, OMMA, Zoo, Snow City) were stuck
pending and invisible in the admin queue because of the missing
`deals_admin_select` policy. Fixed and approved 16 Sep.

### New columns (16 Sep)

- `deals.time_slots` and `free_activities.time_slots`: `text[]`, subset of
  `morning, midday, afternoon, evening, late` (check constraint). NULL = any time.
  All 19 deals and 14 free activities are tagged. Windows: morning <12pm,
  midday 11:30–2:30, afternoon 2–6, evening 6–9:30, late 9pm+.
- `deals_dates_order` constraint: `end_date >= start_date`.

### Scheduled release (16 Sep)

A deal with a future `start_date` is hidden from the public and goes live on that
day automatically. No cron: `deals_public_read` and `deals_select_authenticated`
check `start_date <= (now() at time zone 'Asia/Singapore')::date` on every read.
The end_date check also uses Singapore time now (was UTC, so deals flipped at 8am
SGT). Suppliers still see their own scheduled deals. No checkbox: the phase
(scheduled / active / expired) is always derived from the dates (`dealPhase()` in
`supplier.js`), so it can't contradict them. All current deals have
`start_date = NULL`.

### Security

RLS was audited and locked down this month. `get_advisors(security)` now returns
**one** warning: `auth_leaked_password_protection`, which is Pro-plan only.
Leave it. Everything else is clean.

Things that were fixed and should not be regressed:
- `categories` needs its public read policy or logged-out visitors see nothing.
- `deals_select_authenticated` covers both anon and authenticated. Don't split it
  back into an anon-only policy — that's what made logged-in users see zero deals.
- Insert policies check `supplier_whitelist`. Without that check any signed-up user
  can insert deals.
- `guard_deal_status_change` must keep its `if (select auth.jwt()) is null then
  return NEW; end if;` guard. Without it the service role counts as a non-admin and
  the trigger un-approves every deal it touches. This already happened once.
- `deals_admin_select` (added 16 Sep) lets the founder account read every deal.
  Without it the admin queue shows nothing pending: admin update/delete policies
  existed but there was no admin SELECT, so pending deals with no `supplier_id`
  (or another supplier's) were invisible. Don't drop it.
- Functions that were hardened have `search_path` pinned. Keep it that way.
- Default `EXECUTE` grants go to `PUBLIC`, not to `anon`/`authenticated`. Revoking
  from those two roles does nothing; revoke from `public`.

---

## 3. What's been built

Done and working:

- Auth with password rules (8+ chars, upper, lower, symbol), shown to the user
  before they submit rather than after.
- Explore with category, vibe, price and area filters (Anywhere / Central / East /
  West / North / North-East).
- Deal detail page with a 4-card meta grid: Category, When, Offer ends, Location.
  **Elisa specifically likes this layout. Don't change it.**
- Browse cards: image → tag/heart → title → location → price → "Add to plan",
  nothing extra. Hours/expiry chips were tried and rejected as too cramped
  (reverted in commit "revert", 16 Sep 23:09, already pushed).
- Swipe deck with pointer-capture drag. Right shortlists, left passes.
- Saved / shortlist, including **guest shortlist** — signed-out visitors can save to
  localStorage, and it merges into the DB on sign-in (`mergeGuestShortlist`,
  upsert on `user_id,deal_id` with `ignoreDuplicates`).
- Planner (`buildItinerary` in `app.js`, rewritten 16 Sep): walks the date from the
  start time and only places a stop whose `time_slots` fit that hour, so dinner is
  never before afternoon tea. Rules: a meal (category Dining) needs 3h since the
  last one; if the date covers lunch/dinner time and no meal is placed yet, a meal
  outranks vibe (not after 9pm); paid stops cost 2 points per km from the previous
  stop; after a paid stop it tries a free stroll within 8 km; max 2 free stops in a
  row; if nothing fits it waits 15 min and tries again (so stops can have gaps).
  Budget and time checked per stop. Percentage-only deals are excluded. The old
  `pickItineraryStops` / `padWithFreeActivities` are gone. Tested headless against
  the real data across 9 start-time/budget/vibe/area cases.
- Supplier form has "Best time of day" chips (writes `time_slots`), a hint under
  Start Date, a Scheduled stat card and a "Scheduled · live 7 Oct" status pill.
  Fixed a bug where the save success message was hidden immediately by
  `cancelEdit()`.
- Dark mode, hamburger-only nav at all widths, How It Works page, contact form.
- Supplier portal with approval-status badges and Seller IDs (DTF-0001 format).
- Admin approval queue.
- Prices show a unit: `/pax`, `total`, `/dish`, `min. spend`, "at the door",
  "no ticket needed". Always 2 d.p. via `money()`.

### Uncommitted work sitting on disk right now

Swipe pre-filter was pushed 16 Sep. On disk and **not pushed** yet:
`js/app.js` (planner rewrite, Singapore-time date filter), `js/supplier.js`,
`supplier-dashboard.html`, `css/supplier.css`, `NOTES.md`. The database side
(time_slots, new policies) is already live, and the currently deployed site is
compatible with it.

To check before pushing: Planner with a few start times (e.g. 12pm, 3pm, 6:30pm);
supplier dashboard add/edit with slot chips and a future start date.

```
git add -A
git commit -m "Time-aware planner, scheduled deals, time-of-day on supplier form"
git push
```

Swipe pre-filter details: setup screen (budget / area / optional vibe), exact
matches first, then a divider, then the rest ranked by how far off they are
(wrong area 1, wrong vibe 0.5, over budget by fraction over). `total` prices halved
per person; percentage offers count as within budget.

---

## 4. Open items

### Blocks launch

(Elisa bought getdatify.com on **Namecheap**. Resend setup was started and
paused on 16 Sep: next step is adding the domain in Resend, Tokyo region, then
copying its DNS records into Namecheap Advanced DNS without touching the
GitHub Pages records.)


**Email delivery.** Supabase's built-in mailer does not reliably deliver
confirmation emails. Elisa's own account had `email_confirmed = false` and she
never got the mail; it had to be confirmed directly in the DB. Real users will hit
this and there is no workaround for them. Either wire up Resend or SendGrid SMTP in
Supabase Auth settings, or turn off "Confirm email" until it's sorted. Do not launch
with this as-is.

### Friction list, in the order agreed

1. ~~Swipe pre-filter~~ — pushed 16 Sep.
2. ~~Itinerary order~~ — done 16 Sep (time_slots + `buildItinerary`), not pushed yet.
   Known limits: ignores weekday rules (weekday-lunch buffets, Fri/Sat dinner
   buffet); the planner's Date field isn't used for that yet. Gaps while waiting
   for a slot aren't labelled in the timeline.
3. **The distance message undersells the trek.** "All stops within 7.7 km" reads
   reassuring, but 7.7 km across Singapore by public transport is a real journey.
   Either convert to a rough travel time or reword so it doesn't sound like nothing.
4. **Inventory depth.** 15 priced deals, 12 of them Central. The swipe pre-filter
   makes this visible rather than fixing it — "under $15 in the East" currently
   has zero exact matches. More deals in East/West/North is the actual fix.

### Deferred on purpose

- **OneMap routing.** Search and geocoding work without a token (with a deprecation
  warning). Routing and reverse-geocoding return 401. The token is a POST with email
  and password, expires in 3 days, and doesn't auto-renew, so it cannot live in
  frontend JS. Options are a Supabase Edge Function proxy, or keep using stored
  lat/lng with Haversine and skip real routing. Waiting on Elisa registering for an
  account. Nothing is blocked on this.
- **Leaked-password protection.** Pro plan only. Skipped.

---

## 5. Gotchas for whoever picks this up

- **The repo used to live in OneDrive and silently reverted files**, losing edits
  more than once. It was moved to `C:\Users\Rog\dev\datify` to stop that. Do not
  move it back. If edits appear to vanish, that's the first thing to check.
- **`device_commit_files` can write a stale cached snapshot** if you reuse an
  outputs path that was previously sent via `SendUserFile`. Use a fresh path per
  commit, and re-stage the file afterwards to confirm what actually landed.
- **There's no `device_bash` on this machine.** You can't run git, node or any shell
  command on her computer. Stage files, edit them in the container, commit them
  back. Elisa runs git herself. You *can* stage `.git/logs/HEAD` to read recent
  commit history.
- **The container's egress blocks Supabase and Unsplash**, so you cannot render a
  working preview of the live data from inside the container. Workaround for logic
  tests: serve the repo with `python3 -m http.server`, and in Playwright abort all
  `https:` requests and fulfil the `supabase-js` CDN request with a small stub whose
  `createClient().from('deals')` returns rows pulled via the Supabase MCP. (Register
  the abort route *before* the stub route; later routes win.) For visuals, use the
  browser tools against the live site, or ask her to look. Don't claim you've seen
  something you haven't.
- **`--white` is the surface token and flips in dark mode. `--on-accent` is text on
  pink and never flips.** Mixing these up produced dark text on pink buttons in 16
  places once. Also watch for hardcoded `background:#fff` — a find-and-replace for
  `background:white` won't catch it, and that's what caused the "font is very close
  to the background" bug.

---

## 6. Where to pick up

1. Elisa: test the planner and supplier form locally, then push (section 3).
2. Email delivery (blocks launch): Resend + Namecheap, or turn off "Confirm email"
   in the meantime.
3. Friction item 3: distance message → rough travel time.
4. Delete the dead root files (`supplier.js`, `supabase.js`, `Claude outputs/`).
