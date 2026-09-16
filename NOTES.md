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
| `deals` | 19 | 15 approved, **4 pending** |
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

**The 4 pending deals need approving or they stay invisible:** F1 Exhibition
tickets, OMMA Korean BBQ, Singapore Zoo, Snow City (re-checked 16 Sep, still
pending). These are exactly the 4 percentage-discount deals. They're pending
because they were inserted after the approval trigger went in. Approve them in
`admin.html` or with a direct SQL update.

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
- Planner: picks stops by vibe, budget, time and area, then fills leftover time with
  nearby free activities using Haversine distance from stored lat/lng. Checks budget
  and time on every stop, not just at the end.
- Dark mode, hamburger-only nav at all widths, How It Works page, contact form.
- Supplier portal with approval-status badges and Seller IDs (DTF-0001 format).
- Admin approval queue.
- Prices show a unit: `/pax`, `total`, `/dish`, `min. spend`, "at the door",
  "no ticket needed". Always 2 d.p. via `money()`.

### Uncommitted work sitting on disk right now

**Swipe pre-filter** (on disk, not committed, not pushed). New setup screen before
the deck: Budget per person (Under $15/$30/$50/Any) / Area / Vibe (optional,
"Surprise me" = any). Touches:
- `app.js`: `swipePrefs` (declared next to `swipeDeals`), `buildSwipe`,
  `showSwipeSetup`, `startSwipeDeck`, `swipeMisses`, `perPersonPrice`,
  `describePrefs`, `inArea`, `stretchNote`, `renderSwipeStack`, and a
  `!deal.divider` guard in `swipeCommit`.
- `index.html`: `#swipe-setup` markup, `#swipe-deck` wrapper, `#swipe-subtitle`.
- `style.css`: `.swipe-setup*`, `.swipe-change-btn`, `.swipe-divider*`,
  `.swipe-stretch-note`.

Behaviour (Elisa chose option B, soft filter): exact matches first, cheapest first
(percentage offers after priced ones), then a divider card, then everything else
ranked by how far off it is (wrong area costs 1, wrong vibe 0.5, over-budget costs
the fraction it's over by). So for "under $15, East", Sushidan $19.90 in the East
comes before a $3.90 izakaya in Central. Stretch cards carry a small label saying
why they're there ("over budget · in the West"). `total` prices are halved before
the budget comparison since they're for two. Percentage-only offers count as
fitting the budget rather than being hidden. With no filters set, all deals show
cheapest first with no divider. Copy says "in Central" but "in the East".

**Testing so far:** run in headless Chromium inside the container with a stubbed
Supabase client fed the real 19 rows (live Supabase is unreachable from the
container). Verified: chip selection, zero-match case (divider first, subtitle
"No exact matches … yet"), a partial-match case, no-filter case, right-swipe
saving a deal, "Change filters" from the deck header, no JS errors.
**Not yet checked:** right-swipe on the divider (guarded in code, not clicked),
the "Change filters" buttons on the divider and the end-of-deck empty state, real
images, dark mode, and the live site with real auth. Note the 4 percentage deals
are pending, so live users currently won't see them in the deck.

To ship:
```
git add -A
git commit -m "Swipe: setup filters + soft-ranked deck with divider"
git push
```

---

## 4. Open items

### Blocks launch

**Email delivery.** Supabase's built-in mailer does not reliably deliver
confirmation emails. Elisa's own account had `email_confirmed = false` and she
never got the mail; it had to be confirmed directly in the DB. Real users will hit
this and there is no workaround for them. Either wire up Resend or SendGrid SMTP in
Supabase Auth settings, or turn off "Confirm email" until it's sorted. Do not launch
with this as-is.

### Friction list, in the order agreed

1. ~~Swipe pre-filter~~ — built, partly tested (see above).
2. **The itinerary doesn't behave like a date.** It can put dinner before the
   afternoon activity, or stack two meals. Needs a `time_of_day` or slot field on
   `deals` and `free_activities` so the planner can order stops sensibly.
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

1. Elisa: open Swipe on the live site (after pushing) and check the "not yet
   checked" list in section 3.
2. Push the swipe pre-filter.
3. Approve the 4 pending deals.
4. Next real piece of work: friction item 2, itinerary ordering. Needs a schema
   change (`time_of_day` / slot field) before any frontend work.
