# Datify — Handoff

**Last updated:** 20 Sep 2026
**Owner:** Elisa (sole founder)
**Live site:** GetDatify.com (GitHub Pages)
**Repo:** `C:\Users\Rog\dev\datify` → `https://github.com/Bababoo28811/datify.git`, branch `main`
**Supabase project ref:** `uujbonptqglzndzlovmp` (region ap-northeast-1)
**Admin/founder account:** elisazhu.ys@gmail.com

> **New session?** Read this file first, then check `git log` for anything newer
> than the date above. **Where things stand:** the site is live and deployed,
> `main` is the only branch and is in sync, and nothing is blocking launch.
> Two things are actively costing users, though: **there is no password recovery
> at all**, and **auth mail is landing in Gmail spam**. Both in section 5.
> Start from section 7.
>
> **Reaching the admin page:** `getdatify.com` → ☰ → **Admin** (only shows for
> the founder account). It is *not* the supplier dashboard, and "My Deals" there
> will always look empty — section 2 explains why.

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
| `admin.html` + `js/admin.js` | Founder-only. Approval queue, **Expiring soon**, **To Stay or Not to Stay** (shares `css/supplier.css`). This is Elisa's workspace — not the supplier dashboard. |
| `js/supabase-client.js` | Creates the `db` client. Must load before `app.js`. |
| `js/track.js` | `track()` — writes one row per interaction to `events`. Loads after the client, before `app.js`. See section 2. |
| `js/icons.js` | Inline SVG icon set. **Generated — don't hand-edit.** See section 4. |
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
| `supplier_whitelist` | 1 | **`choijieen@gmail.com`** ("big ball inc", DTF-0001, added 24 Apr) — *not* Elisa |
| `events` | 1 | usage log, new 20 Sep. The one row is a verification insert — delete it whenever. |

15 deals have a real price; 4 are percentage-discount offers (`price = 0` +
`discount_label`). All 19 are geocoded and have `time_slots`.

Deal vibes: Fun 6, Foodie 5, Chill 3, Romantic 3, Adventurous 2.

### Who the supplier dashboard is actually for (corrected 20 Sep)

This file previously said the whitelist held "Elisa only." It doesn't, and never
did. Two facts that follow, both of which caused real confusion:

- **Elisa is not a whitelisted supplier.** She reaches
  `supplier-dashboard.html` purely through the `isAdmin` bypass in
  `supplier.js` — which is exactly why the "Admin preview" banner
  (`supplier-dashboard.html:42`) shows for her.
- **All 19 deals have `supplier_id = NULL`.** None belongs to any account,
  because they were all added directly rather than through the supplier flow.

So **"My Deals" on the supplier dashboard is always empty for Elisa, and always
will be.** That page is the view a *restaurant* gets; it is not the founder's
workspace. Everything she works with lives on `admin.html`. Don't go looking for
a bug here.

Worth deciding at some point whether `choijieen@gmail.com` should still have
supplier access from April.

### Columns added this month

- **`deals.venue_url`** (20 Sep) — where a visitor is sent when they want the
  deal. **Not the same as `source_url`**, which points at the roundup blog the
  deal was copied from. A check constraint requires `http://` or `https://`,
  because the value is rendered straight into an `href`. NULL on all 19 today.
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

**Nothing deletes or archives an expired deal.** It stays in `deals` with its data
intact and simply stops being returned by the read policies, so a deal that gets
renewed only needs its `end_date` edited.

#### The cron job that used to be here (removed 19 Sep)

"No cron" above was aspirational until 19 Sep — there was a nightly `pg_cron` job
(jobid 1, `0 0 * * *`) calling `expire_old_deals()`, undocumented and not in the
repo. It had failed **every night since 24 April** on
`column "is_ongoing" does not exist` (the column is `ongoing`), so it never did
anything. Its body was:

```sql
update deals set status = 'expired'
where status = 'active' and is_ongoing = false
  and end_date is not null and end_date < current_date;
```

It was **dropped, not repaired**, because repairing it would have caused real
damage:

- `status` holds *approval* state — only `pending` / `approved` / `rejected` are
  real values. Writing `'expired'` into it means a renewed deal is no longer
  approved and would need re-approving to come back.
- It duplicates work the read policies already do correctly.
- `current_date` is UTC and the job ran at UTC midnight (8am SGT) — exactly the
  timezone bug that was fixed in the policies.

No rows were ever affected: all 19 deals were still `approved` afterwards.
**If expiry ever looks like it needs a job, re-read this section first — it
doesn't.**

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
- **"To Stay or Not to Stay" on `admin.html`** (19 Sep) — a keep-or-drop verdict per deal:
  **Y / N**, the real cost once `++` and any conditions land, and remarks behind
  an expand. Flagged first, filterable to flagged/passed only.
  - The question is **"is this a real saving"**, not "is this cheap." A $98
    buffet honestly priced at $98 passes; a headline discount off a price nobody
    was ever charged fails. Affordability is what the price filters are for.
  - Verdicts live in their own table, **`deal_reviews`**, not as columns on
    `deals` — `deals_public_read` returns every column, so an opinion about a
    named venue would have been readable straight from the public API even if
    the site never rendered it. One policy, founder only. **Never add a public
    read policy to that table**, and never surface these on the customer site.
  - The first 19 were written in-session, 11 Y / 8 N. Current state: **11 deals
    have no discount and no `original_price`** — four percentage offers that
    literally can't be evaluated, and four ($48–$98) that are menu prices listed
    as deals. See section 5.
  - Verdicts go stale when prices change; `checked_at` records when each was
    written. Nothing refreshes them yet.
- **Expiry tracker on `admin.html`** (19 Sep) — the catalogue shrinks on its own
  and nothing used to say so. Two stat cards (**Lapsed**, **Expiring ≤14 days**)
  and an "Expiring soon" table above the queue, windowed to 7 / 30 / 90 days.
  - `WARN_DAYS = 14`, not 7: renewing means getting an answer out of a venue.
    Six deals share a 30 Sep end date and a 7-day band showed all six as fine.
  - **Already-lapsed deals are listed, deliberately.** They're invisible on the
    site and are the likeliest to just need a new date — the most useful rows
    here, not noise.
  - Actions per row: **+1 mo**, **+3 mo**, **Ongoing**. Extending counts forward
    from *today* when a deal has already lapsed, so a renewed deal can't land
    back in the past. `addMonths` clamps to the month's length (31 Jan + 1 mo is
    28 Feb, not 3 Mar). **Ongoing** also clears `end_date`, matching what the
    supplier form writes (`supplier.js:463`).
  - It never writes `status` — that column is approval state, and the expiry
    panel has no business touching it. See the removed cron in section 2.
  - It has its own fetch (`expiringDeals`) because the queue table follows the
    status dropdown, which starts on "pending".
  - `sgToday()` is duplicated from `supplier.js` — `admin.html` doesn't load
    that file, and both pages have to agree on what "today" is.
- Dark mode, hamburger-only nav, How It Works, contact form.

### Reaching the back office (20 Sep)

`admin.html` was reachable **only by typing its address** — nothing on the site
linked to it, and the two back-office pages didn't link to each other. In
practice that meant retyping the URL every time, and it read as though the page
didn't exist. Three doors now:

1. **`getdatify.com` → ☰ → Admin** — the main one. Added to the hamburger menu
   (`.nav-links` is `display:none` at every width, so that menu *is* the nav),
   hidden by default and revealed in `updateNavForAuth()` off the `ADMIN_EMAIL`
   constant already at `app.js:9`. Verified in all four states: hidden by
   default, visible for the founder, hidden for another signed-in user, hidden
   for guests.
2. **Supplier dashboard → `Admin →`** in the nav, revealed off the same
   `isAdmin` check `supplier.js` already used for the whitelist bypass.
3. **`admin.html` → `Supplier →`** going back the other way (no condition — the
   page is founder-only already).

These are doorways, not security. `admin.js` and the RLS policies remain the
actual guard, which is why a supplier never sees a link they'd only be bounced
from.

### Two back-office UI fixes (20 Sep)

- **The theme toggle was invisible in dark mode** on `admin.html` and
  `supplier-dashboard.html`. `css/style.css` gives `.theme-toggle`
  `color:var(--text)`; `css/supplier.css` never did, and a `<button>` does not
  inherit `color` from the page — so the glyph fell back to the UA default
  near-black. Now themed on both. **If you add a control to `supplier.css`,
  check it against `style.css` first: the two stylesheets have drifted.**
- **Sign out moved out of the nav** to the foot of the page (`.signout-foot`) on
  both pages. It sat top-right beside the two buttons actually used often, which
  is where muscle memory reaches for something else — and an accidental sign-out
  on a login-gated page costs a whole log-in.

### Icons (19 Sep)

`js/icons.js` is **generated from lucide-static v1.47.0** (ISC), fetched from
the CDN rather than typed out, so no path data is guessed. 30 icons, ~8 KB, no
runtime dependency and no build step. To change the set, re-fetch — don't
hand-edit the file.

- `icon(name, {size, cls, label})` returns an `<svg>` string for use inside
  template literals.
- `hydrateIcons()` fills any `<el data-icon="name" data-icon-size="26">` in
  static markup, so `index.html` stays declarative. It runs itself on
  `DOMContentLoaded`.
- Icons are `aria-hidden` by default — every one sits beside visible text that
  already says what it means. Pass `label` only for an icon that stands alone.

This replaced 32 distinct emoji (58 occurrences). Emoji render differently on
every platform, can't inherit `currentColor`, and share no stroke weight.
`js/theme.js` loads in `<head>` **before** `icons.js`, so its toggle falls back
to a text glyph if `window.icon` isn't there yet.

### Accessibility (19 Sep)

- Focus rings restored. Every input had `outline:none` with only a pink border
  tint, which is a colour-only cue. Now `:focus-visible` so keyboard users get a
  2px ring and mouse clicks look unchanged.
- Inputs moved 14px → **16px**. iOS Safari auto-zooms any field below 16px and
  leaves the page zoomed — it affected signup, login, contact and the planner's
  date/time pickers.
- `prefers-reduced-motion` block at the end of `style.css`. Durations collapse
  rather than animations being deleted, so state changes still register.
- All deal `<img>` tags have `alt=""` plus `loading="lazy"` on the grid.
  Deliberately empty, not the deal title: the title is already adjacent visible
  text, and many photos are stock images that don't show the real venue.

### Type scale (19 Sep)

Six tokens on `:root`, next to the radius ones:

```
--fs-xs:12px  --fs-sm:14px  --fs-md:16px  --fs-lg:20px  --fs-xl:24px  --fs-2xl:32px
```

There were 23 distinct sizes, 11 of them between 10 and 16px. Everything rounds
to the nearest step, ties going down so nothing grew by more than 1px. Reading
text sits at 16px: the body default (was 15px), the deal description, and the
How It Works body and lede.

**Anything above 32px is an emoji glyph, not type, and stays a literal.** Deals
carry an `emoji` column and fall back to it when there's no photo — 52px on a
card, 64px on a swipe card, 80px on the detail hero. The hero headline keeps its
`clamp()` for the same reason. The hero subheading is body copy, so its clamp
runs between two tokens.

Adding a new size means picking a token. If none of them fit, that's worth a
conversation, not a seventh value.

### Loading screen (19 Sep)

Generating a plan now takes **600 ms**, not 3.3 s. `buildItinerary()` is
synchronous, so the old five-step checklist was pure theatre — and Regenerate
never showed it. The remaining delay is a single beat so the page change
registers; `prefers-reduced-motion` skips even that. If you ever need the screen
to cover real work, make it wait on the work, not on a timer.

### Icons, favicon and link previews (19 Sep)

The site had one `<link rel="icon">` pointing at an SVG and **nothing else** — no
`favicon.ico`, no `apple-touch-icon`, no Open Graph tags, no `meta description`.
A shared link was a bare URL with no image or title anywhere.

| File | What uses it |
|---|---|
| `assets/img/logo-mark.svg` | modern browsers' tab icon |
| `favicon.ico` (root, 48px) | Safari, and what crawlers probe for |
| `assets/img/icon-192.png` | `rel=icon` PNG fallback |
| `apple-touch-icon.png` (root, 180px) | iOS home screen — **needs a solid background**, iOS renders transparency as black |
| `assets/img/og-image.jpg` | `og:image`, 1200×630 |

`logo-mark.svg` was 7973 bytes, of which 7736 was C2PA metadata from whatever
exported it. It's 191 bytes now, and its viewBox is `6 6 52 52` rather than
`0 0 64 64` — the art only spans x 6–58 / y 12–52, so the old box left the mark
floating small at favicon sizes.

**og:image and twitter:image must be absolute URLs.** Relative ones are silently
ignored, which looks identical to having no tag at all.

The PNGs were rendered by drawing the two circles onto a canvas in the browser —
there's no ImageMagick on this machine, and `convert` on PATH is *Windows' disk
conversion tool*, not ImageMagick. To redo them, the generator is a throwaway
script; the drawing is ~20 lines of canvas calls.

A first pass wrote og-image as PNG at 470 KB. As JPEG q0.92 it's 44 KB and looks
the same — the radial gradient is what PNG can't compress.

`admin.html` and `supplier-dashboard.html` get `noindex, nofollow` plus the
icons. They're login-gated and have nothing to index.

**Google re-crawls favicons on its own schedule — expect days or weeks, not
minutes.** Link previews (WhatsApp, iMessage, Slack) update as soon as their
cache expires, and can be forced with Facebook's Sharing Debugger.

The `<title>` is still "Datify — Plan the Perfect Date" while `og:title` says
"Real date deals in Singapore". Deliberate — the title is what Google shows —
but worth a look if you want them to match.

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

### Nothing blocks launch any more

**Signup email works end to end, verified live 19 Sep.** Fresh address →
delivered → tapped → confirmed and signed in, 15 seconds start to finish, one
`/verify` request, no retry. `auth.users` holds 3 accounts, all confirmed.

The setup, for reference:
- Resend account, `getdatify.com`, region **Tokyo (ap-northeast-1)**
- DNS in Namecheap: DKIM `resend._domainkey`, CNAMEs `send` + `rsend`, DMARC
  `_dmarc`. All confirmed resolving from Namecheap's own nameservers.
- Domain **Verified** in Resend
- Custom SMTP in Supabase (`smtp.resend.com`, port 465, user `resend`)
- **Site URL `https://getdatify.com`**, redirect allow-list `https://getdatify.com/**`
  and `https://www.getdatify.com/**`

Supabase's built-in mailer was never going to work — it's development-only (a
couple of messages an hour, shared sending domain, lands in spam). Custom SMTP
was the fix, not a workaround.

Keep **"Confirm email" ON**. Turning it off is what lets people sign up with
addresses they don't own.

**Still worth doing: raise Supabase's auth rate limit.** It stays low even after
custom SMTP is attached, and it is not obvious from the outside — it looks like
mail silently not arriving.

#### The redirect bug, in case it comes back

The first live test looked like a failure: the emailed link returned
**"requested path is invalid"**. The mail had actually worked and the account was
already confirmed — the logs showed `/verify` return 303, then a second tap 8
seconds later fail with "One-time token not found" because the first tap had
spent the token.

The cause was **Site URL set to `getdatify.com` with no scheme**. That made the
link carry `redirect_to=getdatify.com`, so the 303's `Location` was a *relative*
path, which the browser resolved against the Supabase origin:
`https://<ref>.supabase.co/auth/v1/getdatify.com/…`. No such route on the API,
hence the message. Adding `https://` fixed it.

Two lessons: a confirmation link that errors has often already worked — check
`auth.users.email_confirmed_at` before assuming delivery is broken. And the
emailed URL's `redirect_to` parameter is the fastest way to see what the Site URL
actually is.

⚠️ While editing DNS on 19 Sep the four apex `A` records were accidentally deleted
and the root domain briefly stopped resolving. They're restored
(`185.199.108–111.153`, host `@`). **Those and the `www` CNAME
(`bababoo28811.github.io`) must never be removed** — the checkboxes in Namecheap's
record list are bulk-*delete* selection, not enable toggles.

### There is no password recovery (found 20 Sep — the hard way)

**The site has no "Forgot password" flow.** `resetPasswordForEmail` appears
nowhere in the codebase; `saveProfilePassword()` (`app.js:2194`) only works for
someone *already signed in*. So any user who forgets their password is locked
out permanently with no route back.

Elisa hit this herself on 20 Sep and got back in only via the Supabase
dashboard, which no ordinary user has. **This is a silent account-loss bug for
every real user.** The fix is small and the email side already works:
`db.auth.resetPasswordForEmail()`, a link under the sign-in button, and a page
that catches the recovery session and reuses the password form that exists.

Note the recovery link obeys the redirect allow-list (`getdatify.com/**`), so it
**cannot** return to a localhost dev server — it always lands on the live site.

### Auth mail is landing in Gmail spam (20 Sep)

The 20 Sep recovery mail was **delivered but filed as spam**. Supabase's side was
clean: two `/recover` calls, both HTTP 200, ~2s SMTP round-trips, no rate-limit
rejection. Delivery is working; *placement* is not.

This matters far more than one lost password: **signup confirmations go the same
route.** A new user who never finds the mail assumes the site is broken and
leaves, and this would never show up in testing because whoever tests knows to
check spam. Section 5 says signup email "works end to end" — it does *deliver*,
but that is not the same as arriving in an inbox. Worth checking the DMARC policy
and the from-name.

### Where deals actually come from (20 Sep)

All 19 deals are `source = 'curated'` and **no supplier has ever listed one**.
Sourcing is three roundup blogs on a monthly cycle:

| Source | Deals | URL shape |
|---|---|---|
| Eatbook | 3 | `eatbook.sg/food-deals-singapore-<month>-<year>/` |
| Bykido | 3 | `bykido.com/blogs/…-in-singapore-this-<month>-<year>` |
| Sassy Mama | 2 | `sassymamasg.com/play-deals-promo-codes-discounts-attractions-dining/` |

Two of the three are **month-stamped and therefore predictable**. Verified 19
Sep: the September Eatbook post resolves, the October one 404s — it simply isn't
published yet.

**This is why so many deals share an end date of 30 September.** Those dates are
mostly "the end of the month I found this in", not a date any venue gave. Treat
`end_date` as bookkeeping, not fact, and fix it before building anything that
acts on it automatically.

The monthly ritual that keeps inventory alive: when the new roundups publish,
walk the expiry panel — still listed, tap **+1 mo**; gone, leave it — then add
what's new, aiming at the gaps (Activities, North-East, evening outside Central,
Romantic that isn't a meal).

### What gets measured (20 Sep)

Until 20 Sep the site collected nothing at all — no analytics script, no click
tracking, no way to answer "did anyone look at this deal." That is now an
`events` table in Supabase and a `track()` helper in `js/track.js`.

It is deliberately **first-party**: no Google Analytics, no third-party script,
no cookie, nothing leaving our own database. That is partly a privacy choice
and partly a commercial one — the numbers are the asset you quote at a venue,
and they should not live in somebody else's dashboard.

**What is stored:** the event name, which deal it was about, a random
`session_id` the browser invents for itself, and the page. **What is not:** IP
address, user agent, email, name. When someone is signed in the database fills
`user_id` from their token — the browser is never trusted to say who it is.

Events currently logged:

| Event | Fired when |
|---|---|
| `page_view` | any `go()`, plus once on load for the landing page |
| `deal_view` | `openDeal()` |
| `add_to_plan` | the Add to plan button |
| `save_deal` / `unsave_deal` | the heart, signed in or guest |
| `plan_generated` | every itinerary built (records vibe, budget, area, stop count) |
| `venue_click` | **the one that matters** — someone leaving for the venue |
| `source_click` | someone leaving for the roundup blog instead |

`signup`, `login` and `plan_saved` are allowed by the table's check constraint
but are **not wired up yet** — the constraint was written ahead of the code so
adding them later needs no migration.

Three things worth knowing about the design:

- **Insert is open to anon**, because most visitors are not signed in. That
  makes the CHECK constraints part of the security boundary rather than
  decoration: the event name must be one of a known list, and the field sizes
  are capped, so the endpoint cannot be turned into free text storage. Verified
  20 Sep — a junk event name, an oversized path and a forged `user_id` are all
  rejected.
- **There is no UPDATE or DELETE policy.** The log is append-only; nothing
  reachable through the public API can rewrite it.
- **`track()` can never break the page.** Every failure path is a silent
  no-op — offline, ad blocker, blocked localStorage, failed insert. Nothing
  awaits it.

Reading it back (Supabase → SQL editor; only the founder account can read it):

```sql
-- the numbers you would actually quote at a venue
select d.title,
       count(*) filter (where e.name = 'deal_view')   as views,
       count(*) filter (where e.name = 'venue_click') as clicks_through
from events e join deals d on d.id = e.deal_id
where e.created_at > now() - interval '30 days'
group by d.title order by clicks_through desc;

-- visitors vs visits, last 30 days
select count(distinct session_id) as visitors, count(*) as page_views
from events where name = 'page_view' and created_at > now() - interval '30 days';
```

**The catch: `venue_click` cannot fire yet.** All 19 deals have
`venue_url = NULL`, so the Visit venue button never renders. Filling those in
is the job that turns this from plumbing into a number — see section 7.

### Design backlog (agreed 19 Sep, 3 of 5 done)

From a design review of the running site. **#1–#3 are done**; #4 and #5 are open
and were both approved in principle.

1. ~~**Emoji as icons.**~~ Done — see section 4.
2. ~~**The loading screen wastes 3.3 s of every plan.**~~ Done — 600 ms now, and
   the five-step checklist is gone rather than sped up (nobody reads five items
   in 600 ms, and two of them described work that happens after the plan
   renders). See section 4.
3. ~~**The type scale isn't a scale.**~~ Done — six `--fs-*` tokens. See
   section 4.
4. **The planner asks for 7 decisions before showing anything** — budget, date,
   start time, duration, area, vibe, categories. Better shape is *show first,
   refine after*: generate on sensible defaults (tonight, 6:30pm, $70, anywhere)
   and put the controls beside the result, updating live. `buildResults()` and
   `regeneratePlan()` already do the work; it's the order that's backwards.
   **This is the most structural one — worth discussing before building.**
5. **The hero leads with the weakest number.** "19 live deals · 4 categories"
   announces how small the catalogue is, directly under a strong line. Drop the
   count or swap it for something that is a strength.

Considered and rejected: putting availability (`days` / `time_slots`) on deal
cards. Hours chips were already tried and pulled for being cramped — understand
what failed before reopening it.

### Next up

1. **Inventory.** 19 deals, 12 Central. "Under $15 in the East" has zero exact
   matches. This is content, not code. Worse, it *shrinks on its own*: 6 deals
   end 30 Sep and 2 more by 12 Oct, taking the live site from 19 to 11 with
   nobody touching it. **North-East hits zero on 1 Oct and Activities hits zero
   on 12 Oct**, and both keep their filter chips. Set a coverage floor rather
   than a total — every area ≥3, every category ≥3, every vibe ≥3, ≥8 ongoing
   (roughly 35–40 deals) — which kills every empty state the filters can make.
2. **Fill in `original_price` on the 4 percentage deals.** Without it the detail
   page can't show what "Up to 26% off" is off *of*, so it's unbudgetable — and
   "To Stay or Not to Stay" has to fail all four for being unverifiable.
3. **Confirm whether the bank-card deals accept debit or credit only.** Royale
   needs DBS/POSB, Maybank, OCBC or Citi; Crossroads is DBS/POSB only; CLOVE
   takes five banks. These are three of the strongest discounts, and that one
   word decides whether students — the stated audience — can use them at all.
   One phone call.
4. **Four deals ($48–$98) have no discount and no `original_price`** —
   Quintessential English Afternoon Tea, Toy Story High Tea at SKAI, Peranakan
   Buffet, Treasures of the Sea. They are menu prices on a deals site. Find what
   they're discounted from, or drop them.
5. **Fix the fake end dates** before automating anything on top of them (see
   "Where deals actually come from"). Genuinely standing offers should be
   `ongoing`, which takes them off the expiry treadmill for good.
6. **`price_unit` mis-sorts Kok Sen.** It's `total` for 2–3 people, so $40 is
   really ~$15/head — but Explore's price filters treat it as $40 and it reads
   mid-range when it's the cheapest thing on the site.
7. **The F1 Simulator's "$10" is a minimum bar spend, not a ticket price**
   (`price_unit = 'min spend'`). The card reads like a $10 activity.
8. **Move the Zoo's real catch out of the description.** "Discounted admission for
   WildPass holders" is the actual condition and it's buried in prose.
9. **Public holidays run out after 2027.** MOM publishes the next year around June.
10. **OMMA and Fireplace** have day rules but no public-holiday answers.
11. **Deal durations** are a flat 60 min for every deal. A real `duration_mins`
   field would make plan timings honest.
12. **`signUp()` passes no `emailRedirectTo`** (`app.js`, ~line 126), so every
   confirmation link inherits the dashboard's Site URL silently. That one field
   being wrong is what broke the first live test. Passing it explicitly would
   make the app state where it wants people to land — needs the target in the
   redirect allow-list.

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
- **An element with no `color` renders SVG icons black.** Emoji carried their own
  colour, so several containers never needed `color` and didn't set one. The
  moment icons started inheriting `currentColor` they fell back to the UA default
  — invisible on the dark theme. Hit `.theme-toggle` and `.vibe-btn`. When adding
  an icon somewhere new, check the container sets a colour.
- **`.tl-card-img` / `.deal-img` backgrounds are hardcoded pastels** set inline
  from `d.bg`, and they do *not* flip with the theme. Icons there take a fixed
  `--pink-dark`, never `var(--text)`.
- **A grid item's default `min-width` is `auto`,** so `1fr 1fr` tracks refuse
  to shrink below their contents. `.input-grid` did this and the planner
  overflowed a 375px screen by 19px — `input[type=date]` and `[type=time]` have
  a wide intrinsic size. Use `repeat(2,minmax(0,1fr))`. Worth checking wherever
  a grid holds an input.
- **Buttons don't inherit `font-size`.** `.vibe-btn` had none and sat at the UA
  default of 13.33px. Same shape as the `color` trap above: set both on any
  button you add.
- **A URL with no scheme is a relative path.** Supabase's Site URL was
  `getdatify.com`, so the confirmation link's 303 `Location` resolved against the
  Supabase origin and returned "requested path is invalid". Always `https://`.
  Same trap anywhere a config field takes a URL.
- **Local preview:** there's no working `python` on this machine (the Microsoft
  Store stub shadows it). Use a small Node static server — `.claude/launch.json`
  (gitignored, machine-specific) runs `npx serve` on :5173. `node --check <file>`
  works for JS syntax checking.

---

## 7. Where to pick up

**Nothing is blocking launch**, but two things are actively costing users. In
rough order of value:

1. **Build password recovery.** There is none at all, and it silently loses
   accounts — see section 5. Small job, the email side already works.
2. **Check why auth mail lands in Gmail spam** (section 5). Signup
   confirmations take the same path, so this is a funnel leak nobody would
   notice from the inside.
3. **Inventory, and the 30 Sep cliff.** 6 deals end 30 Sep, 2 more by 12 Oct;
   North-East and Activities both hit zero. Open
   `getdatify.com/admin.html` → **Expiring soon** and walk the list: still
   running, tap **+1 mo**; genuinely open-ended, tap **Ongoing**. Most of those
   dates are bookkeeping, not fact.
4. **Fill in `venue_url` on the 19 deals.** Tracking went in on 20 Sep, but
   `venue_click` — the one event a venue would pay attention to — cannot fire
   until a deal has somewhere to click through to. `admin.html` → the Deals
   table → **Link** on each row; paste the venue's own booking or deal page,
   *not* the blog it was found on. The button on the deal page only appears
   once a URL exists, so the site looks unchanged until you start.
5. **Fix the four "deals" that have no discount**, fill in `original_price` on
   the four percentage offers, and confirm the debit-vs-credit question on the
   three bank-card deals (section 5, Next up 2–4).
6. **Design backlog #4 (planner reorder)** — show first, refine after. Still the
   most structural change left; talk it through before building.
7. **Check the supplier dashboard on a phone while signed in.** `admin.html` was
   checked at 375px on 19–20 Sep (tables scroll sideways, usable but not
   pleasant); the supplier dashboard still never has been. Pair this with giving
   `css/supplier.css` the same type-token pass the customer site got: it still
   has 38 hand-picked font sizes and its own `:root`.
8. Raise the Supabase auth rate limit (section 5).
9. Design backlog #5 (hero proof line) — a one-liner whenever you want it.

### Proposed but not built

- **A "Drop" button on flagged rows** in To Stay or Not to Stay. Today the
  verdict and the action live in different tables: you read a flagged deal, then
  scroll to the Deals card, switch the filter to Approved, find it again and
  Reject. One button would close the loop.
- **A roundup watcher.** A scheduled function polling the three source blogs for
  next month's post and mailing when one appears — the trigger for the monthly
  inventory pass (section 5, "Where deals actually come from"). Deliberately
  *not* a "your deals expire soon" alert: that would only report dates we set
  ourselves. Anything it finds must land as `status = 'pending'` for review,
  never straight onto the site.
- **`deal_date_history`** — nothing records that an end date changed or that a
  deal lapsed and was renewed, so renewal rate is unknowable. Worth having
  before spending weeks chasing venues; not worth it before that.

### Repo state at handoff (20 Sep)

Five commits on 20 Sep, all pushed and deployed:

```
7ff205e  Put an Admin link in the site menu for the founder account
dfcea69  Fix the invisible theme toggle and move Sign out out of the nav
ff4429c  Link the admin and supplier pages to each other
c7cc81a  Track deal expiry and keep-or-drop verdicts on the admin page
```

Database changes the same day: `deal_reviews` created (founder-only RLS, dumped
into `supabase-rls-policies.sql`) and seeded with 19 verdicts; the broken
`expire_old_deals()` cron job and its function dropped.

### Repo state at previous handoff (19 Sep)

- **`main` is the only branch, local and remote, in sync, and deployed.**
  Everything described above is live on GetDatify.com. Branches were cleaned up
  19 Sep: PR #2 landed by pushing `main` (GitHub closed it as merged),
  `svg-icon-system` and `design-refresh` were deleted once verified merged, and
  **PR #1 was closed unmerged** — its NOTES.md was older than what is live, so
  merging would have rolled the handoff backwards. Its commit `6c5493c` stays
  reachable from the closed PR; it holds a few details this file condensed away
  (swipe ranking weights, the planner's 15-minute retry, Replace offering up to 4
  alternatives, OneMap's confirm-code page).
- `.agents/` holds the `ui-ux-pro-max` skill used for the design review. It's
  gitignored (3.7 MB); `skills-lock.json` is committed so the version is pinned.
  Reinstall with:
  ```
  npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max
  ```
  Its `search.py` needs Python, which doesn't work on this machine — read the
  CSVs in `.agents/skills/ui-ux-pro-max/data/` directly instead.
