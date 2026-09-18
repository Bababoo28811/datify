// app.js — Datify main site logic (home, planner, explore, auth, profile)
// Depends on: js/supabase-client.js (db must be defined first)

// ============================================================
  // PASSWORD STRENGTH — min 8 chars, upper, lower, and a symbol
  // ============================================================
  // Founder/admin account — gets to reach /admin.html and the supplier
  // dashboard without the supplier auto-redirect getting in the way.
  const ADMIN_EMAIL = 'elisazhu.ys@gmail.com';

  const PASSWORD_RULE_TEXT = 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a symbol.';
  function isStrongPassword(pw) {
    return pw.length >= 8
      && /[A-Z]/.test(pw)
      && /[a-z]/.test(pw)
      && /[^A-Za-z0-9]/.test(pw);
  }

  // ============================================================
  // ✅ STEP 2 — Auth state: update nav when user signs in/out
  // ============================================================
  // Tracks whether anyone is signed in, so the UI can tell a guest that
  // their shortlist is device-only without re-querying auth every render.
  let CURRENT_USER = null;

  db.auth.onAuthStateChange((event, session) => {
    CURRENT_USER = session?.user ?? null;
    updateNavForAuth(CURRENT_USER);
    loadSavedDeals().then(() => {
      refreshSaveButtons();
      // If they're sitting on Saved when they sign in, redraw so the
      // "device only" banner disappears and the merged list shows.
      if (document.getElementById('page-saved')?.classList.contains('active')) buildSavedDeals();
    });
  });

  function updateNavForAuth(user) {
    const area       = document.getElementById('nav-auth-area');
    const areaMobile = document.getElementById('nav-auth-area-mobile');
    let html;
    if (user) {
      const meta      = user.user_metadata || {};
      const firstName = meta.first_name || '';
      const lastName  = meta.last_name  || '';
      const fullName  = (firstName + ' ' + lastName).trim() || user.email.split('@')[0];
      const initials  = (firstName ? firstName[0] : (user.email[0] || '?')).toUpperCase();
      html = `
        <button class="nav-user-btn" onclick="go('profile');closeMobileMenu()" title="My profile">
          <div class="nav-user-avatar">${initials}</div>
          <span>${fullName}</span>
          <span class="nav-user-chevron">▾</span>
        </button>`;
    } else {
      html = `
        <button class="btn-ghost" onclick="go('login');closeMobileMenu()">Sign in</button>
        <button class="btn-pink"  onclick="go('signup');closeMobileMenu()">Join free</button>`;
    }
    if (area)       area.innerHTML       = html;
    if (areaMobile) areaMobile.innerHTML = html;
  }

  // ============================================================
  // MOBILE NAV
  // ============================================================
  function toggleMobileMenu() {
    document.getElementById('nav-mobile-menu').classList.toggle('open');
    document.getElementById('nav-hamburger').classList.toggle('open');
  }
  function closeMobileMenu() {
    document.getElementById('nav-mobile-menu').classList.remove('open');
    document.getElementById('nav-hamburger').classList.remove('open');
  }

  // Adds a "Supplier Dashboard" entry to the menu, only for whitelisted
  // suppliers (and the admin). This is how a supplier gets back to their
  // dashboard now that they're no longer force-redirected there.
  function showSupplierNavLink() {
    const menu = document.getElementById('nav-mobile-menu');
    if (!menu || document.getElementById('nav-supplier-link')) return;
    const link = document.createElement('button');
    link.className = 'nav-link nav-supplier-link';
    link.id = 'nav-supplier-link';
    link.textContent = '🏪 Supplier Dashboard';
    link.onclick = () => { window.location.href = 'supplier-dashboard.html'; };
    const authArea = menu.querySelector('.nav-mobile-auth');
    menu.insertBefore(link, authArea || null);
  }

  // ============================================================
  // ✅ STEP 3 — Sign Up (with full validation)
  // ============================================================
  async function handleSignUp() {
    const firstName = document.getElementById('signup-firstname').value.trim();
    const lastName  = document.getElementById('signup-lastname').value.trim();
    const email     = document.getElementById('signup-email').value.trim();
    const password  = document.getElementById('signup-password').value.trim();
    const btn       = document.getElementById('signup-btn');
    const errEl     = document.getElementById('signup-error');
    const okEl      = document.getElementById('signup-success');

    // Hide previous messages
    errEl.style.display = 'none';
    okEl.style.display  = 'none';

    // Validate BEFORE touching Supabase
    if (!firstName || !email || !password) {
      errEl.textContent   = 'Please fill in your first name, email and password.';
      errEl.style.display = 'block';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent   = 'Please enter a valid email address.';
      errEl.style.display = 'block';
      return;
    }
    if (!isStrongPassword(password)) {
      errEl.textContent   = PASSWORD_RULE_TEXT;
      errEl.style.display = 'block';
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Creating account…';

    try {
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          data: { first_name: firstName, last_name: lastName }
        }
      });
      if (error) throw error;

      // Update the nav avatar immediately — don't wait for onAuthStateChange
      if (data.user) updateNavForAuth(data.user);

      // Check whitelist — suppliers go straight to their dashboard, nobody else
      const supplier = await isSupplierEmail(email);
      if (supplier) {
        window.location.href = 'supplier-dashboard.html';
        return;
      }

      // If confirmation is required the session will be null here — say so
      // clearly (including the spam-folder hint) instead of implying they're
      // already signed in and bouncing them to a page that needs a login.
      if (!data.session) {
        okEl.innerHTML = '✓ Account created. We\'ve emailed you a confirmation link — <strong>check your spam folder too</strong>, it often lands there. You\'ll need to click it before you can sign in.';
        okEl.style.display = 'block';
        return;
      }

      okEl.textContent   = '✓ Account created! Signing you in…';
      okEl.style.display = 'block';

      setTimeout(() => go('planner'), 1800);

    } catch (err) {
      errEl.textContent   = err.message || 'Something went wrong. Please try again.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled    = false;
      btn.textContent = "Create account — it's free";
    }
  }

  // ============================================================
  // ✅ SUPPLIER CHECK — silently checks the whitelist table.
  // Returns true if the email belongs to a supplier.
  // This is invisible to regular users; it's just a DB read.
  // ============================================================
  async function isSupplierEmail(email) {
    // The founder account is never auto-redirected to the supplier
    // dashboard — otherwise being whitelisted (or admin) would hijack every
    // login and make /admin.html awkward to reach. Admin can still open the
    // supplier dashboard directly by URL.
    if (email === ADMIN_EMAIL) return false;
    const { data, error } = await db
      .from('supplier_whitelist')
      .select('email')
      .eq('email', email)
      .single();
    return !error && !!data;
  }

  // ============================================================
  // ✅ STEP 4 — Log In (with full validation)
  // ============================================================
  async function handleLogin() {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const btn      = document.getElementById('login-btn');
    const errEl    = document.getElementById('login-error');
    const okEl     = document.getElementById('login-success');

    errEl.style.display = 'none';
    okEl.style.display  = 'none';

    if (!email || !password) {
      errEl.textContent   = 'Please enter your email and password.';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Signing in…';

    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;

      okEl.textContent   = '✓ Signed in! Redirecting…';
      okEl.style.display = 'block';

      // Stealth supplier check — redirect to dashboard if whitelisted, stop there
      const supplier = await isSupplierEmail(email);
      if (supplier) {
        window.location.href = 'supplier-dashboard.html';
        return;
      }

      setTimeout(() => go('planner'), 1000);

    } catch (err) {
      // "Email not confirmed" is the single most common way people get stuck:
      // the account exists but the confirmation mail never arrived (Supabase's
      // built-in mailer is rate-limited and often lands in spam). Give them a
      // way out instead of a dead-end error.
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('not confirmed') || msg.includes('email not confirmed')) {
        errEl.innerHTML = 'Your email address hasn\'t been confirmed yet. Check your inbox <strong>and your spam folder</strong>, or <button type="button" class="link-btn" onclick="resendConfirmation()">send the confirmation email again</button>.';
      } else {
        errEl.textContent = err.message || 'Invalid email or password.';
      }
      errEl.style.display = 'block';
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Sign in';
    }
  }

  // Re-sends the signup confirmation email. Supabase rate-limits this, so the
  // error is surfaced plainly rather than swallowed.
  async function resendConfirmation() {
    const email = document.getElementById('login-email').value.trim();
    const errEl = document.getElementById('login-error');
    const okEl  = document.getElementById('login-success');
    if (!email) {
      errEl.textContent = 'Type your email address in the field above first.';
      errEl.style.display = 'block';
      return;
    }
    try {
      const { error } = await db.auth.resend({ type: 'signup', email });
      if (error) throw error;
      errEl.style.display = 'none';
      okEl.textContent   = '✓ Sent. Check your inbox and spam folder — it can take a minute.';
      okEl.style.display = 'block';
    } catch (e) {
      errEl.textContent = e.message || 'Could not resend just now — wait a minute and try again.';
      errEl.style.display = 'block';
    }
  }

  // ============================================================
  // ✅ STEP 5 — Log Out
  // ============================================================
  async function handleLogout() {
    await db.auth.signOut();
    go('home');
  }

  // ============================================================
  // APP DATA
  // ============================================================
  // ============================================================
  // LIVE DEALS — loaded from Supabase (replaces the old hardcoded
  // sample list). DEALS/CATEGORIES start empty and are populated by
  // loadDealsAndCategories(), called once at boot (see INIT below).
  // ============================================================
  let DEALS = [];
  let CATEGORIES = [];

  function slugify(s) {
    return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'other';
  }

  function escHtmlApp(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Today's date in Singapore as YYYY-MM-DD. toISOString() is UTC, which
  // is still "yesterday" until 8am here.
  function sgToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  }

  async function loadDealsAndCategories() {
    try {
      const [catRes, dealRes, freeRes, holRes] = await Promise.all([
        db.from('categories').select('id, name').order('name'),
        db.from('deals').select('*, categories(name)').order('created_at', { ascending: false }),
        db.from('free_activities').select('*').eq('active', true),
        db.from('public_holidays').select('day, name')
      ]);

      // Date string -> holiday name. A failed load just means no holiday
      // rules apply, which is safer than blocking the planner.
      PUBLIC_HOLIDAYS = new Map((holRes?.data || []).map(h => [h.day, h.name]));

      // Free things to do, used to pad out an itinerary when the budget
      // and time aren't used up by paid deals.
      FREE_ACTIVITIES = (freeRes.data || []).map(f => ({
        id: 'free-' + f.id,
        name: f.name,
        desc: f.description,
        location: f.location,
        region: f.region,
        lat: f.latitude  != null ? Number(f.latitude)  : null,
        lng: f.longitude != null ? Number(f.longitude) : null,
        price: 0,
        dur: f.duration_mins || 45,
        vibe: f.vibe || '',
        timeSlots: f.time_slots || null,
        categoryName: 'Free to do',
        type: 'free',
        isFree: true,
        image: f.image_url || null,
        bg: '#F1F5F9',
        emoji: '🚶'
      }));

      CATEGORIES = catRes.data || [];

      // Same rule as the database policy, in Singapore time. The database
      // already hides these; this just keeps the two in step.
      const today = sgToday();
      const rows  = (dealRes.data || []).filter(r =>
        (!r.start_date || r.start_date <= today) &&
        (r.ongoing || !r.end_date || r.end_date >= today));

      // NOTE: real deals have no stored duration, so every stop is
      // scheduled as a flat 60 minutes for planner purposes — an
      // estimate, not a fact from the supplier. Worth adding a real
      // duration field to the supplier form later.
      DEALS = rows.map(r => ({
        id: r.id,
        name: r.title,
        type: slugify(r.categories?.name || 'other'),
        categoryName: r.categories?.name || 'Other',
        vibe: r.vibe || '',
        price: Number(r.price) || 0,
        // Percentage/conditional offers ("20% off") have no fixed price.
        // Where this is set it must be shown INSTEAD of the price —
        // otherwise a price of 0 renders as "Free", which is just wrong.
        discountLabel: r.discount_label || null,
        originalPrice: r.original_price != null ? Number(r.original_price) : null,
        sourceUrl: r.source_url || null,
        imageIsStock: !!r.image_is_stock,
        // Not every price is per-person: a set menu for two is a total,
        // flat izakaya pricing is per dish, a simulator is a minimum spend.
        // Labelling all of them "pp" overstated what people actually pay.
        priceUnit: r.price_unit || 'per person',
        location: r.location || 'Singapore',
        tags: [r.vibe].filter(Boolean),
        desc: r.description || '',
        // Real availability, only where the source actually stated it.
        // NULL stays NULL — the UI says "not stated" rather than the old
        // "Anytime", which claimed something we never knew.
        openingHours: r.opening_hours || null,
        best: r.ongoing ? 'Ongoing' : (r.start_date || null),
        endDate: r.end_date || null,
        region: r.region || null,
        // When in the day this makes sense. null = any time.
        timeSlots: r.time_slots || null,
        // Days of the week it's valid ('mon'..'sun'). null = every day.
        days: r.days || null,
        // Per-holiday answers from the supplier: { 'YYYY-MM-DD': true/false }.
        // Missing date = never asked, treated as valid.
        holidayValidity: r.holiday_validity || {},
        lat: r.latitude  != null ? Number(r.latitude)  : null,
        lng: r.longitude != null ? Number(r.longitude) : null,
        dur: 60,
        image: r.image_url || null,
        bg: '#FFF0F2',
        emoji: '🎁'
      }));
    } catch (err) {
      console.error('Failed to load deals:', err);
      DEALS = [];
      CATEGORIES = [];
    }
    renderCategoryChips();
    renderStatsBar();
  }

  // Hero proof line — real live counts, never invented numbers. Stays
  // hidden until there's at least one real deal, so a pre-launch visitor
  // sees nothing rather than an embarrassing "0 live deals".
  function renderStatsBar() {
    const bar = document.getElementById('hero-stats');
    if (!bar) return;
    if (DEALS.length === 0) {
      bar.style.display = 'none';
      return;
    }
    const dealsEl = document.getElementById('stat-deals-num');
    const catsEl  = document.getElementById('stat-cats-num');
    if (dealsEl) dealsEl.textContent = String(DEALS.length);
    if (catsEl)  catsEl.textContent  = String(CATEGORIES.length);
    bar.style.display = '';
  }

  // Every money amount on the site goes through this. Adding prices like
  // 25 + 3.90 + 10 + 19.90 in binary floating point gives 58.80000000000001,
  // which was being printed raw ("Budget left $1.2000000000000028").
  // Always format money at the point of display, never trust the raw number.
  function money(n) {
    return '$' + (Number(n) || 0).toFixed(2);
  }

  // What the price is actually FOR. Shown under or beside every amount.
  // "2026-09-30" is a database value, not something to show a person.
  // Deals closing within a fortnight get a louder chip — that's the
  // difference between "noted" and "go this weekend".
  function isEndingSoon(iso) {
    if (!iso) return false;
    const days = (new Date(iso + 'T12:00') - new Date()) / 86400000;
    return days >= 0 && days <= 14;
  }

  function prettyDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function priceUnitLabel(d) {
    if (d.isFree)        return 'no ticket needed';
    if (d.discountLabel) return 'at the door';
    if (d.price === 0)   return '';
    switch (d.priceUnit) {
      case 'total':     return 'total';
      case 'per item':  return '/dish';
      case 'min spend': return 'min. spend';
      default:          return '/pax';
    }
  }

  // "/pax" and "/dish" read as one token with the number ($25/pax), while
  // worded units need breathing room ($40 total).
  function priceWithUnit(d) {
    const unit = priceUnitLabel(d);
    if (!unit) return money(d.price);
    return unit.startsWith('/') ? money(d.price) + unit : money(d.price) + ' ' + unit;
  }

  // Single source of truth for how a deal's price is shown. A deal is
  // either fixed-price, or a discount offer with no computable price —
  // never "Free" unless it genuinely costs nothing.
  function priceLabel(d) {
    if (d.discountLabel) return escHtmlApp(d.discountLabel);
    if (d.price === 0)   return 'Free';
    return money(d.price);
  }

  function hasFixedPrice(d) {
    return !d.discountLabel;
  }

  function renderCategoryChips() {
    const el = document.getElementById('category-chips');
    if (!el) return;
    // Only show categories that actually contain a visible deal. A filter
    // that always returns "no deals match" is broken by definition — and it
    // was leaking supplier test categories (e.g. "bang") onto the live site.
    const withDeals = new Set(DEALS.map(d => d.type));
    const seen = new Map();
    CATEGORIES.forEach(c => {
      const slug = slugify(c.name);
      if (withDeals.has(slug)) seen.set(slug, c.name);
    });
    el.innerHTML = Array.from(seen.entries()).map(([slug, name]) =>
      `<button class="filter-chip filter-chip-cat" onclick="filterDeals('${slug}',this)">${escHtmlApp(name)}</button>`
    ).join('');
  }

  // ============================================================
  // TIMELINE BUILDER — walks the date from the start time, one stop at a
  // time, only placing things that make sense at that hour.
  //
  // Before this, stops were picked by vibe/price and then listed in pick
  // order, so a 6:30pm date could open with afternoon tea and put dinner
  // last, or stack two buffets back to back.
  // ============================================================
  // Slot windows in minutes from midnight. They overlap on purpose:
  // 11:45am is both "morning" and "midday".
  const SLOT_WINDOWS = {
    morning:   [0,    720],   // before 12pm
    midday:    [690,  870],   // 11:30am – 2:30pm
    afternoon: [840,  1080],  // 2pm – 6pm
    evening:   [1080, 1290],  // 6pm – 9:30pm
    late:      [1260, 2880]   // 9pm onwards (past midnight too)
  };

  function slotsAt(mins) {
    return Object.keys(SLOT_WINDOWS).filter(k => mins >= SLOT_WINDOWS[k][0] && mins < SLOT_WINDOWS[k][1]);
  }

  // No slots stored = no restriction (e.g. a new supplier deal).
  function fitsAt(stop, mins) {
    if (!stop.timeSlots || !stop.timeSlots.length) return true;
    const now = slotsAt(mins);
    return stop.timeSlots.some(sl => now.includes(sl));
  }

  const DAY_KEYS  = ['sun','mon','tue','wed','thu','fri','sat'];
  const DAY_NAMES = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
  const WEEK_ORDER = ['mon','tue','wed','thu','fri','sat','sun'];

  // What kind of day a YYYY-MM-DD date is, for deal rules.
  function dayInfo(isoDate) {
    const dow = DAY_KEYS[new Date(isoDate + 'T12:00').getDay()];
    const holiday = PUBLIC_HOLIDAYS.get(isoDate) || null;
    return { date: isoDate, dow, holiday };
  }

  function validOnDay(d, info) {
    if (!info) return true;
    if (d.days && d.days.length && !d.days.includes(info.dow)) return false;
    if (info.holiday && d.holidayValidity[info.date] === false) return false;
    return true;
  }

  // ['mon','tue','wed','thu','fri'] -> "Mon–Fri", ['fri','sat'] -> "Fri–Sat",
  // ['mon','wed'] -> "Mon, Wed". Back-to-back days become a range.
  function formatDays(days) {
    if (!days || !days.length || days.length === 7) return '';
    const idx = WEEK_ORDER.map((k, i) => days.includes(k) ? i : -1).filter(i => i >= 0);
    const parts = [];
    for (let i = 0; i < idx.length; i++) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
      const a = DAY_NAMES[WEEK_ORDER[idx[i]]], b = DAY_NAMES[WEEK_ORDER[idx[j]]];
      parts.push(j === i ? a : a + '–' + b);
      i = j;
    }
    return parts.join(', ');
  }

  // Short line for the detail page, e.g. "Mon–Fri · not on public holidays".
  function dealDaysNote(d) {
    const bits = [];
    const f = formatDays(d.days);
    if (f) bits.push(f + ' only');
    // Upcoming holidays it's not valid on, e.g. "not on 9 Nov, 25 Dec".
    const today = sgToday();
    const off = Object.keys(d.holidayValidity || {})
      .filter(k => d.holidayValidity[k] === false && k >= today)
      .sort();
    const upcomingAnswers = Object.keys(d.holidayValidity || {}).filter(k => k >= today);
    if (off.length && off.length === upcomingAnswers.length && off.length > 2) {
      // Excluded on every holiday it covers: say it simply.
      bits.push('not on public holidays');
    } else if (off.length) {
      const fmt = k => new Date(k + 'T12:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
      const more = off.length > 2 ? ` + ${off.length - 2} more` : '';
      bits.push(`not on ${off.length === 1 ? 'public holiday' : 'public holidays'} ${off.slice(0, 2).map(fmt).join(', ')}${more}`);
    }
    return bits.join(' · ');
  }

  const isMeal = s => s.categoryName === 'Dining';
  // Two meals need at least this long between them to be a sensible date.
  const MEAL_GAP_MINS = 180;

  // opts.avoid: ids to steer away from (Regenerate), opts.shuffle: add a
  // little randomness so Regenerate doesn't return the identical plan.
  function buildItinerary(vibeKey, budget, startMins, minutesAvailable, areaFilter, day, opts = {}) {
    const avoid = opts.avoid || new Set();
    const jitter = () => opts.shuffle ? Math.random() * 20 : 0;
    const vibeLabel = { romantic:'Romantic', fun:'Fun', adventurous:'Adventurous', chill:'Chill', foodie:'Foodie' }[vibeKey] || 'Romantic';
    const endMins = startMins + minutesAvailable;

    // Discount-type deals ("20% off") have no computable price, so they'd
    // silently understate the total. Keep them out of generated plans.
    // Also drop anything not valid on the date picked (weekday-only deals
    // on a Saturday, weekday deals on a public holiday).
    let paidPool = DEALS.filter(d => hasFixedPrice(d) && validOnDay(d, day));
    // A deal the user asked to plan around goes in the pool even if it's a
    // "20% off" deal with no fixed price (it's paid at the venue).
    const pinned = opts.pin ? DEALS.find(d => d.id === opts.pin) : null;
    if (pinned && validOnDay(pinned, day) && !paidPool.includes(pinned)) paidPool.push(pinned);
    // Narrow to the chosen area, but fall back to the whole island rather
    // than hand back nothing because a region is thin.
    if (areaFilter && areaFilter !== 'any') {
      const inArea = paidPool.filter(d => d.region === areaFilter || d === pinned);
      if (inArea.length) paidPool = inArea;
    }
    // "What to include?" — a preference, not a hard filter. Inventory outside
    // Dining is thin, so a strict filter would hand back an empty date; fall
    // back to the wider pool the same way the area filter does. renderPlan()
    // says so when that happens, rather than pretending the choice was honoured.
    if (opts.cats && opts.cats.length) {
      const inCats = paidPool.filter(d => opts.cats.includes(d.type) || d === pinned);
      if (inCats.length) paidPool = inCats;
    }

    const MAX_PAID = 4, MAX_STOPS = 8, MIN_SLOT = 25, STEP = 15, MAX_FREE_HOP_KM = 5, MAX_HOP_MINS = 40;
    const out = [];
    const usedIds = new Set();
    const catCount = new Map();
    let cursor = startMins, total = 0, paidCount = 0, lastMealEnd = null;

    // Lower = better. Shortlisted and on-vibe first; a category already in
    // the plan is pushed back so you get variety before repeats.
    //   - A date that covers lunch or dinner time should include the meal,
    //     even if no restaurant matches the vibe, so that outranks vibe.
    //   - Each km from the previous stop costs a little, so the plan
    //     doesn't zig-zag across the island.
    // Where the deals cluster. The first stop leans towards it so there's
    // something nearby to do next (with no previous stop, distance is
    // otherwise ignored and a plan can open somewhere isolated).
    // With an area picked, the hub is that area's deals and free spots.
    const areaOn = areaFilter && areaFilter !== 'any';
    const freeForHub = areaOn ? FREE_ACTIVITIES.filter(f => f.region === areaFilter) : FREE_ACTIVITIES;
    const located = [...paidPool, ...freeForHub].filter(x => x.lat != null);
    const hub = located.length
      ? { lat: located.reduce((t, x) => t + x.lat, 0) / located.length,
          lng: located.reduce((t, x) => t + x.lng, 0) / located.length }
      : null;

    const paidScore = d => {
      let sc = d.price / 1000;
      if (!out.length && hub) sc += (haversineKm(hub, d) || 0) * 1.5;
      if (SAVED_DEAL_IDS.has(d.id)) sc -= 100;
      if (isMeal(d) && lastMealEnd == null) {
        const now = slotsAt(cursor);
        if ((now.includes('midday') || now.includes('evening')) && !now.includes('late')) sc -= 70;
      }
      if ((d.vibe || '').toLowerCase() === vibeLabel.toLowerCase()) sc -= 50;
      sc += (catCount.get(d.type) || 0) * 30;
      if (avoid.has(d.id)) sc += 60;
      if (pinned && d === pinned) sc -= 1000;
      sc += jitter();
      const km = haversineKm(out[out.length - 1], d);
      if (km != null) sc += km * 2;
      return sc;
    };

    // When we'd get to a stop if we left the previous one now.
    const arrival = d => cursor + estTravel(out[out.length - 1], d).minutes;

    const nextPaid = () => {
      if (paidCount >= MAX_PAID) return null;
      return paidPool
        .filter(d => {
          if (usedIds.has(d.id) || total + d.price > budget) return false;
          // Don't send people across the island for one stop.
          if (d !== pinned && estTravel(out[out.length - 1], d).minutes > MAX_HOP_MINS) return false;
          const at = arrival(d);
          return at + d.dur <= endMins
            && (catCount.get(d.type) || 0) < 2
            && fitsAt(d, at)
            && !(isMeal(d) && lastMealEnd != null && at - lastMealEnd < MEAL_GAP_MINS);
        })
        .sort((a, b) => paidScore(a) - paidScore(b))[0] || null;
    };

    const nextFree = () => {
      if (endMins - cursor < MIN_SLOT) return null;
      const prev = out[out.length - 1];
      // Two free stops in a row is enough; after that, wait for a paid one.
      const prev2 = out[out.length - 2];
      if (prev && prev.isFree && prev2 && prev2.isFree) return null;
      const ok = f => {
        const at = prev ? arrival(f) : cursor;
        if (usedIds.has(f.id) || at + f.dur > endMins || !fitsAt(f, at)) return false;
        // A "nearby" stroll shouldn't be a cross-island trip.
        const km = prev ? haversineKm(prev, f) : null;
        return km == null || km <= MAX_FREE_HOP_KM;
      };
      if (!prev) {
        // Opening stop: on-vibe first, then closest to where the deals are.
        const onVibe = f => (f.vibe || '').toLowerCase() === vibeLabel.toLowerCase() ? 0 : 5;
        const nearHub = f => hub ? (haversineKm(hub, f) || 0) : 0;
        const fscore = f => onVibe(f) + nearHub(f) + (avoid.has(f.id) ? 8 : 0) + jitter() / 4;
        return FREE_ACTIVITIES.filter(ok).sort((a, b) => fscore(a) - fscore(b))[0] || null;
      }
      if (opts.shuffle || avoid.size) {
        // Same idea as nearestFreeActivity, with Regenerate's variety added.
        const fscore = f => (haversineKm(prev, f) ?? 99)
          - ((f.vibe || '').toLowerCase() === vibeLabel.toLowerCase() ? 1.5 : 0)
          + (avoid.has(f.id) ? 4 : 0) + jitter() / 5;
        return FREE_ACTIVITIES.filter(f => !usedIds.has(f.id) && ok(f)).sort((a, b) => fscore(a) - fscore(b))[0] || null;
      }
      return nearestFreeActivity(prev, usedIds, vibeLabel, ok);
    };

    const place = stop => {
      const travel = estTravel(out[out.length - 1], stop);
      cursor += travel.minutes;
      out.push({ ...stop, startAt: cursor, travelBefore: travel });
      usedIds.add(stop.id);
      cursor += stop.dur;
      if (!stop.isFree) {
        total += stop.price;
        paidCount++;
        catCount.set(stop.type, (catCount.get(stop.type) || 0) + 1);
        if (isMeal(stop)) lastMealEnd = cursor;
      }
    };

    let guard = 0;
    while (cursor < endMins && out.length < MAX_STOPS && guard++ < 100) {
      const prev = out[out.length - 1];
      // After a paid stop, stroll somewhere free nearby before the next one,
      // the same rhythm the old planner had (dinner → walk → drinks).
      const order = prev && !prev.isFree ? [nextFree, nextPaid] : [nextPaid, nextFree];
      let stop = null;
      for (const pick of order) { stop = pick(); if (stop) break; }
      if (stop) { place(stop); continue; }
      // Nothing makes sense right now (e.g. 5:30pm, dinner not till 6).
      // Step forward instead of giving up on the rest of the date.
      cursor += STEP;
    }
    // Trailing gap is just the date ending early; don't pad with nothing.
    return out;
  }

  // Cheapest single priced deal — used for honest "nothing fits your
  // budget" copy instead of silently returning a thin or over-budget plan.
  function cheapestDeal() {
    const costable = DEALS.filter(hasFixedPrice);
    if (!costable.length) return null;
    return costable.slice().sort((a, b) => a.price - b.price)[0];
  }

  let curVibe = 'romantic';
  let savedPlans = [];
  let prevPage = 'home';
  let activeCat = 'all';
  let activePriceF = null;
  let SAVED_DEAL_IDS = new Set();
  let currentSavedTab = 'deals';
  let currentContactTab = 'support';
  let swipeDeals = [];
  let swipeIndex = 0;
  // Setup picks, kept for the session so "Change filters" reopens with
  // what she chose last time.
  let swipePrefs = { budget: 'any', area: 'any', vibe: 'any' };
  let FREE_ACTIVITIES = [];
  let PUBLIC_HOLIDAYS = new Map();

  // ============================================================
  // DISTANCE — straight-line, from stored coordinates.
  // Deliberately NOT a travel-time estimate: OneMap's routing API
  // needs a token that can't live in client-side code, so we show an
  // honest "X km apart" instead of inventing a journey time.
  // ============================================================
  function haversineKm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat/2)**2 +
              Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  // Rough door-to-door minutes between two stops, used while building the
  // plan (OneMap's real figure replaces it once the plan is on screen).
  // Under ~800 m you walk; otherwise ~10 min of walking/waiting plus ~3 min
  // per km, which matched OneMap closely on test routes (6.8 km -> 30 min).
  function estTravel(a, b) {
    if (!a || !b) return { minutes: 0, mode: 'none' };
    const km = haversineKm(a, b);
    if (km == null) return { minutes: 15, mode: 'pt' };
    if (km <= 0.8) return { minutes: Math.max(1, Math.round(km * 1000 * 1.3 / 75)), mode: 'walk' };
    return { minutes: Math.round(10 + km * 3), mode: 'pt' };
  }

  function nearestFreeActivity(toStop, usedIds, vibeLabel, extraFilter) {
    const pool = FREE_ACTIVITIES.filter(f => !usedIds.has(f.id) && (!extraFilter || extraFilter(f)));
    if (!pool.length) return null;
    const scored = pool.map(f => {
      const km = haversineKm(toStop, f);
      // Unknown distance sorts last; a matching vibe gets a small nudge.
      let score = km == null ? 999 : km;
      if (vibeLabel && f.vibe && f.vibe.toLowerCase() === vibeLabel.toLowerCase()) score -= 1.5;
      if (toStop.region && f.region === toStop.region) score -= 1;
      return { f, score };
    }).sort((x, y) => x.score - y.score);
    return scored[0].f;
  }

  // ============================================================
  // SAVED DEALS (shortlist)
  //
  // Signed in  -> rows in Supabase (saved_deals).
  // Signed out -> ids in this browser only, under GUEST_KEY.
  //
  // Guests can shortlist freely and are asked to sign up only once they've
  // built something worth keeping. Previously the heart silently threw you
  // at the login page, which lost the deal AND the visitor.
  // ============================================================
  const GUEST_KEY = 'datify-guest-shortlist';

  function getGuestShortlist() {
    try { return JSON.parse(localStorage.getItem(GUEST_KEY) || '[]'); }
    catch (e) { return []; }   // private mode / blocked storage
  }
  function setGuestShortlist(ids) {
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(ids)); } catch (e) {}
  }

  // On sign-up/sign-in, carry anything shortlisted as a guest into the real
  // account so the work isn't lost. unique(user_id, deal_id) makes this safe
  // to run more than once.
  async function mergeGuestShortlist(userId) {
    const ids = getGuestShortlist();
    if (!ids.length) return;
    try {
      const rows = ids.map(deal_id => ({ user_id: userId, deal_id }));
      const { error } = await db.from('saved_deals')
        .upsert(rows, { onConflict: 'user_id,deal_id', ignoreDuplicates: true });
      if (error) throw error;
      setGuestShortlist([]);
    } catch (err) {
      console.error('Could not merge guest shortlist:', err);
    }
  }

  async function loadSavedDeals() {
    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) { SAVED_DEAL_IDS = new Set(getGuestShortlist()); return; }
      await mergeGuestShortlist(session.user.id);
      const { data, error } = await db.from('saved_deals').select('deal_id').eq('user_id', session.user.id);
      if (error) throw error;
      SAVED_DEAL_IDS = new Set((data || []).map(r => r.deal_id));
    } catch (err) {
      console.error('Failed to load saved deals:', err);
      SAVED_DEAL_IDS = new Set();
    }
  }

  async function toggleSaveDeal(dealId, btnEl) {
    let session;
    try {
      ({ data: { session } } = await db.auth.getSession());
    } catch (err) {
      console.error('Session check failed:', err);
      return;
    }
    // Not signed in: shortlist locally instead of bouncing them to login.
    if (!session) {
      const ids = getGuestShortlist();
      const at = ids.indexOf(dealId);
      if (at >= 0) { ids.splice(at, 1); SAVED_DEAL_IDS.delete(dealId); }
      else         { ids.push(dealId);  SAVED_DEAL_IDS.add(dealId); }
      setGuestShortlist(ids);
      refreshSaveButtons();
      if (document.getElementById('page-saved')?.classList.contains('active')) buildSavedDeals();
      // On Swipe the count lives in the header instead: a toast here covers the
      // ✕ / ♡ buttons on a short phone, which is the one place you can't
      // afford to lose them.
      if (document.getElementById('page-swipe')?.classList.contains('active')) return;
      // Nudge once they've saved enough to care about losing it — but don't
      // nag on every swipe. Only at 2, 5 and 10.
      if ([2, 5, 10].includes(ids.length)) showGuestSavePrompt(ids.length);
      else if (ids.length === 1) showToast('Saved to this device. Sign up later to keep it.');
      return;
    }

    const isSaved = SAVED_DEAL_IDS.has(dealId);
    try {
      if (isSaved) {
        const { error } = await db.from('saved_deals').delete()
          .eq('user_id', session.user.id).eq('deal_id', dealId);
        if (error) throw error;
        SAVED_DEAL_IDS.delete(dealId);
      } else {
        const { error } = await db.from('saved_deals').insert({ user_id: session.user.id, deal_id: dealId });
        if (error) throw error;
        SAVED_DEAL_IDS.add(dealId);
      }
    } catch (err) {
      console.error('Failed to update saved deal:', err);
      return;
    }
    refreshSaveButtons();
  }

  // Small transient message, bottom of screen. Used instead of silently
  // doing something (or silently navigating somewhere).
  let toastTimer = null;
  function showToast(msg, actionLabel, actionFn) {
    let el = document.getElementById('datify-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'datify-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.innerHTML = `<span>${escHtmlApp(msg)}</span>`;
    if (actionLabel) {
      const b = document.createElement('button');
      b.className = 'toast-action';
      b.textContent = actionLabel;
      b.onclick = () => { hideToast(); (actionFn || (() => {}))(); };
      el.appendChild(b);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 3500);
  }
  function hideToast() {
    const el = document.getElementById('datify-toast');
    if (el) el.classList.remove('show');
  }

  function showGuestSavePrompt(count) {
    showToast(`${count} deals shortlisted on this device.`, 'Create an account to keep them', () => go('signup'));
  }

  // Signed-out count for the Swipe header. Signed in, the shortlist is already
  // safe on the account, so there's nothing to warn about.
  function renderSwipeSavedNote() {
    const el = document.getElementById('swipe-saved-note');
    if (!el) return;
    const n = CURRENT_USER ? 0 : getGuestShortlist().length;
    el.innerHTML = n
      ? `${n} saved · <button type="button" onclick="go('signup')">Create account</button>`
      : '';
  }

  function refreshSaveButtons() {
    renderSwipeSavedNote();
    document.querySelectorAll('.deal-save').forEach(el => {
      el.classList.toggle('saved', SAVED_DEAL_IDS.has(el.dataset.dealId));
    });
    const detailBtn = document.getElementById('save-deal-btn');
    if (detailBtn && detailBtn.dataset.dealId) {
      const saved = SAVED_DEAL_IDS.has(detailBtn.dataset.dealId);
      detailBtn.textContent = saved ? 'Saved ✓' : 'Save deal ♡';
      detailBtn.style.borderColor = saved ? 'var(--green)' : '';
      detailBtn.style.color       = saved ? 'var(--green)' : '';
    }
  }

  // ============================================================
  // NAVIGATION — single clean function, no overwriting
  // ============================================================
  function go(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.remove('active');
      if (l.dataset.page === page) l.classList.add('active');
    });
    const el = document.getElementById('page-' + page);
    if (!el) return;
    el.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Side effects per page
    if (page === 'saved')   { buildSavedDeals(); buildSavedPlansList(); }
    if (page === 'explore') buildExplore(activeCat, activePriceF);
    if (page === 'profile') buildProfile();
    if (page === 'swipe')   buildSwipe();
  }

  function switchSavedTab(tab, btn) {
    currentSavedTab = tab;
    document.querySelectorAll('.saved-tab-btn').forEach(b => b.classList.remove('on'));
    if (btn) btn.classList.add('on');
    document.getElementById('saved-deals-panel').style.display = tab === 'deals' ? '' : 'none';
    document.getElementById('saved-plans-panel').style.display = tab === 'plans' ? '' : 'none';
  }

  function setVibeAndGo(v) {
    curVibe = v;
    go('planner');
    const btn = document.querySelector(`[data-vibe="${v}"]`);
    if (btn) pickVibe(btn);
  }

  function pickVibe(el) {
    document.querySelectorAll('.vibe-btn').forEach(b => b.classList.remove('sel'));
    el.classList.add('sel');
    curVibe = el.dataset.vibe;
  }

  // ============================================================
  // PLANNER → LOADING → RESULTS
  // ============================================================
  function startGenerate() {
    go('loading');
    let step = 0;
    const steps = document.querySelectorAll('.l-step');
    steps.forEach(s => s.classList.remove('done', 'active'));
    steps[0].classList.add('active');
    const iv = setInterval(() => {
      steps[step].classList.remove('active');
      steps[step].classList.add('done');
      step++;
      if (step < steps.length) {
        steps[step].classList.add('active');
      } else {
        clearInterval(iv);
        setTimeout(() => {
          const pin = PINNED_DEAL;
          PINNED_DEAL = null;
          renderPinBanner();
          buildResults(pin ? { pin } : {});
          go('results');
        }, 500);
      }
    }, 560);
  }

  // ============================================================
  // PLAN PAGE — everything on the results page renders from currentPlan,
  // so Remove / Replace / Regenerate / real travel times all stay in sync
  // with the totals.
  // ============================================================
  const VIBE_LABELS = { romantic:'Romantic', fun:'Fun', adventurous:'Adventurous', chill:'Chill', foodie:'Foodie' };
  const INCLUDE_LABELS = { dining:'Food', activities:'Activities', drinks:'Drinks', outdoor:'Outdoor' };
  let currentPlan = null;          // { params, stops, savedId }
  const REAL_TRAVEL = new Map();   // 'fromId>toId' -> { minutes, mode } from OneMap

  // "What to include?" chips. All on (or all off) means no restriction, so
  // the common case doesn't quietly narrow the pool.
  function readIncludeCats() {
    const chips = [...document.querySelectorAll('#include-chips .chip')];
    if (!chips.length) return null;
    const on = chips.filter(c => c.classList.contains('on')).map(c => c.dataset.cat);
    return (on.length === 0 || on.length === chips.length) ? null : on;
  }

  function toggleInclude(el) {
    el.classList.toggle('on');
  }

  function readPlannerParams() {
    return {
      vibe:   curVibe,
      budget: parseInt(document.getElementById('budget-slider').value) || 70,
      time:   document.getElementById('p-time')?.value || '18:30',
      dur:    parseInt(document.getElementById('p-dur')?.value) || 3,
      // No date picked = planning for today.
      date:   document.getElementById('p-date')?.value || sgToday(),
      loc:    document.getElementById('p-loc')?.value || 'any',
      cats:   readIncludeCats()
    };
  }

  // "Fun Afternoon", "Romantic Evening" — from the vibe and start time.
  function planTitle(params) {
    const m = timeToMins(params.time);
    const part = m < 720 ? 'Morning' : m < 1020 ? 'Afternoon' : m < 1260 ? 'Evening' : 'Night';
    return `${VIBE_LABELS[params.vibe] || 'Date'} ${part}`;
  }

  function buildResults(opts = {}) {
    const params = opts.params || readPlannerParams();
    const stops = buildItinerary(params.vibe, params.budget, timeToMins(params.time),
      params.dur * 60, params.loc, dayInfo(params.date), { ...opts, cats: params.cats });
    currentPlan = { params, stops, savedId: null };
    retimePlan();
    renderPlan();
    refineTravelTimes();
    if (opts.pin) {
      const d = DEALS.find(x => x.id === opts.pin);
      if (d && !stops.some(x => x.id === d.id)) {
        showToast(`${d.name} doesn't fit this date${whenNote(d) ? ' (' + whenNote(d) + ')' : ''}. Try another day or time.`);
      }
    }
  }

  // "evening, Fri–Sat" style hint for when a deal is on.
  function whenNote(d) {
    const slotNames = { morning: 'mornings', midday: 'lunch', afternoon: 'afternoons', evening: 'evenings', late: 'late nights' };
    const bits = [];
    if (d.timeSlots && d.timeSlots.length) bits.push(d.timeSlots.map(x => slotNames[x] || x).join('/'));
    const f = formatDays(d.days);
    if (f) bits.push(f + ' only');
    return bits.join(', ');
  }

  // ------------------------------------------------------------
  // ADD TO PLAN — from a deal card or the deal page.
  // With a plan open: slot it in where it makes sense.
  // Without one: open the planner and build around it.
  // ------------------------------------------------------------
  let PINNED_DEAL = null;

  function addToPlan(id) {
    const d = DEALS.find(x => x.id === id);
    if (!d) return;
    if (currentPlan && currentPlan.stops.length) {
      if (currentPlan.stops.some(s => s.id === id)) {
        go('results');
        showToast(`${d.name} is already in your plan.`);
        return;
      }
      insertIntoPlan(d);
      return;
    }
    PINNED_DEAL = id;
    // Plan around its vibe unless they've already picked one.
    const vibeKey = Object.keys(VIBE_LABELS).find(k => VIBE_LABELS[k].toLowerCase() === (d.vibe || '').toLowerCase());
    go('planner');
    if (vibeKey) {
      const btn = document.querySelector(`[data-vibe="${vibeKey}"]`);
      if (btn) pickVibe(btn);
    }
    renderPinBanner();
  }

  function renderPinBanner() {
    const el = document.getElementById('pin-banner');
    if (!el) return;
    const d = PINNED_DEAL && DEALS.find(x => x.id === PINNED_DEAL);
    if (!d) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const note = whenNote(d);
    el.innerHTML = `<span>📌 Planning around <strong>${escHtmlApp(d.name)}</strong>${note ? ` <span class="pin-note">(${escHtmlApp(note)})</span>` : ''}</span>
      <button class="pin-clear" onclick="clearPin()" aria-label="Stop planning around this deal">✕</button>`;
    el.style.display = '';
  }

  function clearPin() {
    PINNED_DEAL = null;
    renderPinBanner();
  }

  // Try every position; keep the one where the deal fits its time slot
  // and the plan runs over least.
  function insertIntoPlan(d) {
    const p = currentPlan;
    const day = dayInfo(p.params.date);
    const endMins = timeToMins(p.params.time) + p.params.dur * 60;
    const original = p.stops;
    let best = null;
    // Day-of-week and public-holiday rules are per-date, not per-slot, so a
    // deal that isn't valid on the planned date can't fit anywhere in it.
    const validToday = validOnDay(d, day);
    for (let k = 0; validToday && k <= original.length; k++) {
      p.stops = [...original.slice(0, k), { ...d }, ...original.slice(k)];
      retimePlan();
      const placed = p.stops[k];
      if (!fitsAt(placed, placed.startAt)) continue;
      const meals = p.stops.filter((x, j) => j !== k && isMeal(x));
      if (isMeal(placed) && meals.some(m => Math.abs(m.startAt - placed.startAt) < MEAL_GAP_MINS)) continue;
      const last = p.stops[p.stops.length - 1];
      const over = Math.max(0, last.startAt + last.dur - endMins);
      // Ties go to the later slot: added things usually come after what's planned.
      if (!best || over <= best.over) best = { k, over, stops: p.stops };
    }
    if (!best) {
      p.stops = original;
      retimePlan();
      go('results');
      renderPlan();
      const note = whenNote(d);
      const why = note ? ' (' + note + ')' : '';
      showToast(validToday
        ? `${d.name} doesn't fit this plan${why}. Replace a stop or plan another time.`
        : `${d.name} isn't available on this date${why}. Try another day.`);
      return;
    }
    p.stops = best.stops;
    p.savedId = null;
    renderPlan();
    go('results');
    refineTravelTimes();
    const total = p.stops.reduce((t, x) => t + x.price, 0);
    const msg = total > p.params.budget
      ? `Added ${d.name}. That puts you ${money(total - p.params.budget)} over budget.`
      : best.over > 10
        ? `Added ${d.name}. The plan now runs ${best.over} min over. Remove a stop to fit.`
        : `Added ${d.name} to your plan.`;
    showToast(msg, 'Undo', () => {
      p.stops = original; retimePlan(); renderPlan(); refineTravelTimes();
    });
  }

  // Regenerate: same settings, steer away from what's on screen.
  function regeneratePlan() {
    if (!currentPlan) return startGenerate();
    const before = currentPlan.stops.map(s => s.id).join(',');
    buildResults({ params: currentPlan.params, avoid: new Set(currentPlan.stops.map(s => s.id)), shuffle: true });
    if (currentPlan.stops.map(s => s.id).join(',') === before) {
      showToast("That's the only plan that fits these settings. Try a bigger budget or another area.");
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // First time at or after `mins` when the stop makes sense (15-min steps).
  function earliestFit(stop, mins) {
    for (let t = mins; t < mins + 12 * 60; t += 15) if (fitsAt(stop, t)) return t;
    return mins;
  }

  // Recompute start times in order: arrive after the previous stop plus
  // travel (real OneMap time if we have it), and wait if it's too early.
  function retimePlan() {
    const p = currentPlan;
    if (!p) return;
    const start = timeToMins(p.params.time);
    let prev = null, prevEnd = start;
    p.stops = p.stops.map(s => {
      let travel = { minutes: 0, mode: 'none' }, real = false;
      if (prev) {
        const known = REAL_TRAVEL.get(prev.id + '>' + s.id);
        travel = known || estTravel(prev, s);
        real = !!known;
      }
      const at = earliestFit(s, prevEnd + travel.minutes);
      const next = { ...s, startAt: at, travelBefore: travel, travelReal: real };
      prev = next;
      prevEnd = at + s.dur;
      return next;
    });
  }

  function renderPlan() {
    const p = currentPlan;
    const { params } = p;
    const day = dayInfo(params.date);
    const locLabel = params.loc === 'any' ? 'Anywhere in Singapore' : params.loc + ', Singapore';
    const dateStr = new Date(params.date + 'T12:00').toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long' });

    document.querySelector('.results-plan-name').innerHTML =
      `Your <span>${escHtmlApp(planTitle(params))}</span> ✨`;
    document.getElementById('res-date-line').textContent =
      dateStr + ' • ' + fmtTime(params.time) + ' • ' + params.dur + ' hours' +
      (day.holiday ? ' • Public holiday: ' + day.holiday : '');

    const stops = p.stops;
    const paidStops = stops.filter(s => !s.isFree);

    // If nothing paid fits, say so plainly and name the real cheapest price
    // rather than quietly handing back a thin or over-budget plan.
    let budgetNote = '';
    if (paidStops.length === 0 && stops.length) {
      const cheapest = cheapestDeal();
      budgetNote = cheapest
        ? `<div class="travel-warn">No paid deal currently fits ${money(params.budget)}. The cheapest we have is <strong>${escHtmlApp(cheapest.name)}</strong> at ${money(cheapest.price)}. Here's a free plan instead — raise your budget to mix in deals.</div>`
        : `<div class="travel-warn">No deals available to plan with yet.</div>`;
    }

    // The "What to include?" chips are a preference, not a hard filter (see
    // buildItinerary). When it had to be widened, say so instead of silently
    // handing back categories they unticked.
    let catsNote = '';
    if (params.cats && params.cats.length && paidStops.some(s => !params.cats.includes(s.type))) {
      const want = params.cats.map(c => INCLUDE_LABELS[c] || c).join(' and ');
      catsNote = `<div class="travel-warn">Not enough ${escHtmlApp(want)} deals to fill this date, so other categories are mixed in. Use Replace on a stop to swap one out.</div>`;
    }

    if (stops.length === 0) {
      document.getElementById('timeline').innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🗓</div>
          <h3>Nothing left in this plan</h3>
          <p>Build a fresh one with the same settings, or change them.</p>
          <button class="btn-pink" onclick="regeneratePlan()">Build a new plan</button>
        </div>`;
      document.getElementById('res-pills').innerHTML = '';
      document.getElementById('total-summary').innerHTML = '';
      document.getElementById('res-extras').innerHTML = '';
      return;
    }

    let total = 0;
    let tlHTML = '<div class="tl-spine"></div>';
    stops.forEach((s, i) => {
      const startStr = minsToTime(s.startAt);
      const endStr   = minsToTime(s.startAt + s.dur);
      total += s.price;
      const typeClass = s.type === 'food' ? 'food' : s.type === 'drinks' ? 'drinks' : 'activity';
      const thumb = s.image
        ? `<img src="${escHtmlApp(s.image)}" style="width:100%;height:100%;object-fit:cover;border-radius:14px">`
        : s.emoji;
      if (i > 0 && s.travelBefore && s.travelBefore.mode !== 'none') {
        tlHTML += `<div class="travel-seg"><div class="travel-line"></div><div class="travel-pill">${travelLabel(s.travelBefore, !s.travelReal)}</div><div class="travel-line"></div></div>`;
      }
      tlHTML += `
        <div class="tl-item">
          <div class="tl-node ${typeClass}">${s.emoji}</div>
          <div class="tl-card" id="tlc-${i}">
            <div class="tl-card-img" style="background:${s.bg}">${thumb}</div>
            <div class="tl-card-body">
              <span class="tl-badge ${typeClass}">${escHtmlApp(s.categoryName)}</span>
              <div class="tl-name">${escHtmlApp(s.name)}</div>
              <div class="tl-loc">📍 ${escHtmlApp(s.location)}</div>
              <div class="tl-times">
                <div class="tl-time-chip">▶ ${startStr}</div>
                <div class="tl-time-chip">■ ${endStr} (est.)</div>
              </div>
            </div>
            <div class="tl-price-col">
              <div>
                <div class="tl-price">${s.discountLabel ? escHtmlApp(s.discountLabel) : (s.price === 0 ? 'Free' : money(s.price))}</div>
                <div class="tl-price-sub">${escHtmlApp(priceUnitLabel(s))}</div>
              </div>
              <div class="tl-actions">
                <button class="tl-act-btn"        onclick="replaceStop(${i})">Replace</button>
                <button class="tl-act-btn remove" onclick="removeStop(${i})">Remove</button>
              </div>
            </div>
          </div>
          <div class="swap-panel" id="swap-${i}" style="display:none"></div>
        </div>`;
    });

    const startMins = timeToMins(params.time);
    const endMins = startMins + params.dur * 60;
    const lastEnd = stops[stops.length - 1].startAt + stops[stops.length - 1].dur;
    const over = lastEnd - endMins;
    const overNote = over > 10
      ? `<div class="travel-warn">⏱ This plan runs about ${over} min past your end time. Remove a stop to fit.</div>` : '';

    // Suggestions have to be things you could actually add to THIS plan:
    // inside what's left of the budget, and open at some point in the window.
    // Listing a $78 high tea under a plan with $10 left just reads as noise.
    const stopIds = new Set(stops.map(s => s.id));
    const budgetLeft = params.budget - total;
    const fitsWindow = d => {
      for (let t = startMins; t + d.dur <= endMins; t += 15) if (fitsAt(d, t)) return true;
      return false;
    };
    const addable = DEALS.filter(d =>
      !stopIds.has(d.id) && validOnDay(d, day) && hasFixedPrice(d) &&
      d.price <= budgetLeft && fitsWindow(d));
    // Same soft category preference as the planner itself.
    const addableInCats = params.cats && params.cats.length
      ? addable.filter(d => params.cats.includes(d.type)) : [];
    const extras = (addableInCats.length ? addableInCats : addable).slice(0, 4);

    // A plan that stops well short of the end time isn't finished, it's out of
    // options. Say which, rather than quietly handing back a shorter date.
    const under = endMins - lastEnd;
    const shortNote = (over <= 10 && under >= 30)
      ? `<div class="travel-ok">🕐 This plan ends about ${under} min early. ${
          extras.length
            ? 'Add one of the deals below to fill it.'
            : `Nothing else fits ${money(budgetLeft)} and the time left.`
        }</div>`
      : '';

    document.getElementById('timeline').innerHTML = budgetNote + catsNote + tlHTML +
      `<div id="travel-note">${travelSummary(stops, stops.slice(1).every(s => s.travelReal))}${overNote}${shortNote}</div>` +
      `<div style="font-size:12px;color:var(--muted);margin-top:12px;padding-left:4px">
        ⏱ Stop times are estimates (60 min per deal). Travel times are for public transport or walking — check the route before you go.
      </div>`;

    const totalMins = lastEnd - startMins;
    const durStr = `${Math.floor(totalMins / 60)}h${totalMins % 60 ? ' ' + (totalMins % 60) + 'm' : ''}`;
    const stopWord = stops.length === 1 ? 'stop' : 'stops';
    document.getElementById('res-pills').innerHTML = `
      <div class="r-pill">📍 ${stops.length} ${stopWord}</div>
      <div class="r-pill">💰 ${money(total)} total${stops.some(x => x.discountLabel) ? ' + discount paid at venue' : ''}</div>
      <div class="r-pill">🕐 ${durStr}</div>
      <div class="r-pill">📍 ${escHtmlApp(locLabel)}</div>`;

    const saved = !!p.savedId;
    document.getElementById('total-summary').innerHTML = `
      <div class="ts-item"><div class="ts-label">Total cost</div><div class="ts-val pink">${money(total)}</div></div>
      <div class="ts-divider"></div>
      <div class="ts-item"><div class="ts-label">Budget left</div><div class="ts-val">${money(Math.max(0, params.budget - total))}</div></div>
      <div class="ts-divider"></div>
      <div class="ts-item"><div class="ts-label">Duration</div><div class="ts-val">${durStr}</div></div>
      <div class="ts-divider"></div>
      <div class="ts-item"><div class="ts-label">Stops</div><div class="ts-val">${stops.length}</div></div>
      <button class="save-plan-btn${saved ? ' saved' : ''}" onclick="savePlan()" ${saved ? 'disabled' : ''}>${saved ? 'Saved ✓' : 'Save this plan ♡'}</button>`;
    const topSave = document.getElementById('res-save-btn');
    if (topSave) { topSave.textContent = saved ? 'Saved ✓' : 'Save Plan'; topSave.disabled = saved; }

    // Nothing worth adding: drop the whole section rather than leaving an
    // empty grid under a heading that promises more deals.
    const extrasSection = document.getElementById('res-extras-section');
    if (extrasSection) extrasSection.style.display = extras.length ? '' : 'none';
    const extrasSub = document.getElementById('res-extras-sub');
    if (extrasSub) extrasSub.textContent = `Fits your plan and the ${money(budgetLeft)} you have left. Use Replace on a stop to swap one in.`;
    document.getElementById('res-extras').innerHTML = extras.map(d => dealCardHTML(d)).join('');
  }

  function travelLabel(t, estimated) {
    const approx = estimated ? '~' : '';
    return t.mode === 'walk'
      ? `🚶 ${approx}${t.minutes} min walk`
      : `🚇 ${approx}${t.minutes} min by MRT/bus`;
  }

  // One line under the plan about the longest trip between stops.
  function travelSummary(stops, fromOneMap) {
    const hops = stops.slice(1)
      .map((s, i) => ({ from: stops[i].name, to: s.name, t: s.travelBefore }))
      .filter(h => h.t && h.t.mode !== 'none');
    if (!hops.length) return '';
    const worst = hops.slice().sort((a, b) => b.t.minutes - a.t.minutes)[0];
    const approx = fromOneMap ? '' : 'about ';
    if (worst.t.minutes >= 35) {
      return `<div class="travel-warn">⚠ Longest trip: <strong>${escHtmlApp(worst.from)}</strong> to <strong>${escHtmlApp(worst.to)}</strong> takes ${approx}${worst.t.minutes} min by MRT/bus. Swap one out for something closer if that's too far.</div>`;
    }
    const allWalk = hops.every(h => h.t.mode === 'walk');
    return `<div class="travel-ok">📍 ${allWalk ? 'Everything is walkable' : 'Longest trip between stops is ' + approx + worst.t.minutes + ' min'}${allWalk ? ` — the furthest is ${approx}${worst.t.minutes} min on foot` : ' by MRT/bus'}.</div>`;
  }

  // Ask OneMap (via our travel-time function) for real public-transport
  // times for any hop we don't know yet, then re-time and redraw.
  // Failing quietly is fine: the estimates are already on screen.
  async function refineTravelTimes() {
    const p = currentPlan;
    if (!p) return;
    const legs = [], keys = [];
    p.stops.forEach((s, i) => {
      if (i === 0) return;
      const a = p.stops[i - 1];
      const k = a.id + '>' + s.id;
      if (REAL_TRAVEL.has(k) || a.lat == null || s.lat == null || keys.includes(k)) return;
      legs.push({ from: { lat: a.lat, lng: a.lng }, to: { lat: s.lat, lng: s.lng } });
      keys.push(k);
    });
    if (!legs.length) return;
    let result;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/travel-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
        body: JSON.stringify({ legs, date: p.params.date, time: p.params.time })
      });
      if (!res.ok) return;
      result = await res.json();
    } catch (err) {
      console.warn('Travel times unavailable, keeping estimates:', err);
      return;
    }
    (result.legs || []).forEach((t, k) => { if (t) REAL_TRAVEL.set(keys[k], t); });
    if (currentPlan !== p) return;   // a different plan is on screen now
    retimePlan();
    renderPlan();
  }

  function removeStop(idx) {
    if (!currentPlan) return;
    const [gone] = currentPlan.stops.splice(idx, 1);
    currentPlan.savedId = null;   // it's a different plan now
    retimePlan();
    renderPlan();
    refineTravelTimes();
    if (gone) showToast(`Removed ${gone.name}.`, 'Undo', () => {
      currentPlan.stops.splice(idx, 0, gone);
      retimePlan(); renderPlan(); refineTravelTimes();
    });
  }

  // Alternatives that fit the same spot: right time of day, valid that
  // day, within what's left of the budget, not already in the plan.
  function swapOptions(idx) {
    const p = currentPlan, s = p.stops[idx];
    const prev = p.stops[idx - 1], next = p.stops[idx + 1];
    // Other meals in the plan, to keep the 3-hour gap between meals.
    const otherMeals = p.stops.filter((x, j) => j !== idx && isMeal(x));
    const day = dayInfo(p.params.date);
    const inPlan = new Set(p.stops.map(x => x.id));
    const spent = p.stops.reduce((t, x) => t + x.price, 0) - s.price;
    const areaOk = x => p.params.loc === 'any' || x.region === p.params.loc;
    const arriveAt = x => (prev ? prev.startAt + prev.dur + estTravel(prev, x).minutes : s.startAt);
    const pool = (s.isFree ? FREE_ACTIVITIES : DEALS.filter(d => hasFixedPrice(d) && validOnDay(d, day)))
      .filter(x => !inPlan.has(x.id) && areaOk(x) && spent + x.price <= p.params.budget)
      .filter(x => {
        const at = arriveAt(x);
        if (!fitsAt(x, at)) return false;
        if (prev && estTravel(prev, x).minutes > 40) return false;
        if (next && estTravel(x, next).minutes > 40) return false;
        if (isMeal(x) && otherMeals.some(m => Math.abs(m.startAt - at) < MEAL_GAP_MINS)) return false;
        return true;
      });
    // Honour "What to include?" here too, with the same fall-back as the
    // planner: offering a drinks stop to someone who unticked Drinks is worse
    // than nothing, but so is an empty Replace panel.
    const cats = p.params.cats;
    const inCats = (cats && cats.length && !s.isFree) ? pool.filter(x => cats.includes(x.type)) : [];
    const choices = inCats.length ? inCats : pool;
    const vibe = (VIBE_LABELS[p.params.vibe] || '').toLowerCase();
    return choices.map(x => ({ x, score: (prev ? estTravel(prev, x).minutes : 0) - ((x.vibe || '').toLowerCase() === vibe ? 15 : 0) }))
      .sort((a, b) => a.score - b.score).slice(0, 4).map(o => o.x);
  }

  function replaceStop(idx) {
    const panel = document.getElementById('swap-' + idx);
    if (!panel) return;
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    document.querySelectorAll('.swap-panel').forEach(el => (el.style.display = 'none'));
    const opts = swapOptions(idx);
    const prev = currentPlan.stops[idx - 1];
    panel.innerHTML = opts.length
      ? `<div class="swap-head">Swap for one of these</div>` + opts.map(x => `
          <div class="swap-row">
            <div class="swap-info">
              <div class="swap-name">${escHtmlApp(x.name)}</div>
              <div class="swap-meta">${x.isFree ? 'Free' : (x.discountLabel ? escHtmlApp(x.discountLabel) : money(x.price))} · ${escHtmlApp(x.region || x.location || '')}${prev ? ' · ' + travelLabel(estTravel(prev, x), true) : ''}</div>
            </div>
            <button class="tl-act-btn" onclick="swapStop(${idx}, '${escHtmlApp(String(x.id))}')">Swap in</button>
          </div>`).join('')
      : `<div class="swap-empty">Nothing else fits this time slot and budget. You can remove this stop instead.</div>`;
    panel.style.display = '';
  }

  function swapStop(idx, id) {
    const p = currentPlan;
    const old = p.stops[idx];
    const pool = old.isFree ? FREE_ACTIVITIES : DEALS;
    const next = pool.find(x => String(x.id) === id);
    if (!next) return;
    p.stops[idx] = { ...next };
    p.savedId = null;
    retimePlan();
    renderPlan();
    refineTravelTimes();
  }

  // ------------------------------------------------------------
  // SAVED PLANS — account (saved_plans table) or this device.
  // Stored as settings + stop ids so they can be reopened; deal
  // details are looked up fresh when opened.
  // ------------------------------------------------------------
  const GUEST_PLANS_KEY = 'datify-guest-plans';
  function getGuestPlans() {
    try { return JSON.parse(localStorage.getItem(GUEST_PLANS_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function setGuestPlans(list) {
    try { localStorage.setItem(GUEST_PLANS_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function serialisePlan() {
    const p = currentPlan;
    return {
      name: planTitle(p.params),
      total: p.stops.reduce((t, s) => t + s.price, 0),
      plan: {
        params: p.params,
        stops: p.stops.map(s => ({ id: s.id, isFree: !!s.isFree }))
      }
    };
  }

  async function savePlan() {
    if (!currentPlan || !currentPlan.stops.length || currentPlan.savedId) return;
    const row = serialisePlan();
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      const list = getGuestPlans();
      const id = 'local-' + Date.now();
      list.unshift({ id, ...row, created_at: new Date().toISOString() });
      setGuestPlans(list);
      currentPlan.savedId = id;
      renderPlan();
      showToast('Plan saved to this device.', 'Create an account to keep it', () => go('signup'));
      return;
    }
    const { data, error } = await db.from('saved_plans')
      .insert({ user_id: session.user.id, ...row }).select('id').single();
    if (error) {
      console.error('Could not save plan:', error);
      showToast("Couldn't save the plan. Try again.");
      return;
    }
    currentPlan.savedId = data.id;
    renderPlan();
    showToast('Plan saved. Find it under Saved → Plans.');
  }

  // Guest plans move into the account on sign-in (like the shortlist).
  async function mergeGuestPlans(userId) {
    const list = getGuestPlans();
    if (!list.length) return;
    try {
      const rows = list.map(({ name, total, plan }) => ({ user_id: userId, name, total, plan }));
      const { error } = await db.from('saved_plans').insert(rows);
      if (error) throw error;
      setGuestPlans([]);
    } catch (err) {
      console.error('Could not merge guest plans:', err);
    }
  }

  async function loadSavedPlans() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { savedPlans = getGuestPlans(); return; }
    await mergeGuestPlans(session.user.id);
    const { data, error } = await db.from('saved_plans')
      .select('id, name, total, plan, created_at').order('created_at', { ascending: false });
    if (error) { console.error('Could not load plans:', error); savedPlans = []; return; }
    savedPlans = data || [];
  }

  function openSavedPlan(id) {
    const row = savedPlans.find(r => String(r.id) === String(id));
    if (!row) return;
    const stops = [];
    let missing = 0;
    (row.plan.stops || []).forEach(ref => {
      const src = ref.isFree ? FREE_ACTIVITIES : DEALS;
      const found = src.find(x => String(x.id) === String(ref.id));
      if (found) stops.push({ ...found }); else missing++;
    });
    currentPlan = { params: row.plan.params, stops, savedId: missing ? null : row.id };
    retimePlan();
    renderPlan();
    go('results');
    refineTravelTimes();
    if (missing) showToast(`${missing} ${missing === 1 ? 'stop has' : 'stops have'} ended since you saved this plan.`);
  }

  async function deleteSavedPlan(id, ev) {
    if (ev) ev.stopPropagation();
    if (String(id).startsWith('local-')) {
      setGuestPlans(getGuestPlans().filter(p => p.id !== id));
    } else {
      const { error } = await db.from('saved_plans').delete().eq('id', id);
      if (error) { showToast("Couldn't delete that plan."); return; }
    }
    if (currentPlan && currentPlan.savedId === id) currentPlan.savedId = null;
    savedPlans = savedPlans.filter(p => p.id !== id);
    buildSavedPlansList();
  }

  // ============================================================
  // DEAL CARDS
  // ============================================================
  function dealCardHTML(d) {
    const media = d.image
      ? `<img src="${escHtmlApp(d.image)}" style="width:100%;height:100%;object-fit:cover">`
      : `<span style="font-size:52px">${d.emoji}</span>`;
    const savedCls = SAVED_DEAL_IDS.has(d.id) ? ' saved' : '';
    return `
      <div class="deal-card" onclick="openDeal('${d.id}')">
        <div class="deal-img" style="background:${d.bg}">
          ${media}
          <div class="deal-img-overlay">
            ${d.tags.map(t => `<span class="deal-tag ${t==='Romantic'||t==='Premium' ? 'pink' : ''}">${escHtmlApp(t)}</span>`).join('')}
          </div>
          <div class="deal-save${savedCls}" data-deal-id="${d.id}" onclick="event.stopPropagation();toggleSaveDeal('${d.id}', this)">♡</div>
        </div>
        <div class="deal-body">
          <div class="deal-name">${escHtmlApp(d.name)}</div>
          <div class="deal-loc">📍 ${escHtmlApp(d.location)}</div>
          <div class="deal-footer">
            <div class="deal-price">${d.discountLabel ? escHtmlApp(d.discountLabel) : (d.price === 0 ? '<span>Free</span>' : `${money(d.price)}<span>${priceUnitLabel(d).startsWith('/') ? '' : ' '}${priceUnitLabel(d)}</span>`)}${d.originalPrice ? ` <span class="deal-price-was">${money(d.originalPrice)}</span>` : ''}</div>
            <button class="deal-cta" onclick="event.stopPropagation();addToPlan('${d.id}')">Add to plan</button>
          </div>
        </div>
      </div>`;
  }

  function buildHomeTrending() {
    const el = document.getElementById('home-trending');
    if (DEALS.length === 0) {
      el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🍽</div><h3>No deals yet</h3><p>Check back soon — suppliers are adding deals.</p></div>`;
      return;
    }
    el.innerHTML = DEALS.slice(0, 4).map(d => dealCardHTML(d)).join('');
  }

  function buildExplore(filter = 'all', priceFilter = null) {
    let filtered = DEALS;
    if (filter !== 'all') filtered = filtered.filter(d => d.type === filter);
    // A percentage offer has no computable price (it's stored as 0), so it
    // must never fall into a money bucket — "Up to 26% off" the Zoo is about
    // $38pp, and listing it under "Under $20" is exactly the kind of claim
    // this site exists to avoid. They get their own bucket instead.
    if (priceFilter === 'budget')       filtered = filtered.filter(d => hasFixedPrice(d) && d.price < 20);
    else if (priceFilter === 'mid')     filtered = filtered.filter(d => hasFixedPrice(d) && d.price >= 20 && d.price <= 60);
    else if (priceFilter === 'premium') filtered = filtered.filter(d => hasFixedPrice(d) && d.price > 60);
    else if (priceFilter === 'discount') filtered = filtered.filter(d => !hasFixedPrice(d));
    const el = document.getElementById('explore-grid');
    const note = priceFilter === 'discount'
      ? `<div class="travel-warn" style="grid-column:1/-1">These are percentage discounts, so the final price depends on what you order and what the venue charges on the day. Check the original listing before you go.</div>`
      : '';
    el.innerHTML = filtered.length
      ? note + filtered.map(d => dealCardHTML(d)).join('')
      : `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🔍</div><h3>No deals match</h3><p>Try a different filter.</p></div>`;
  }

  function filterDeals(cat, btn) {
    document.querySelectorAll('#page-explore .filter-chip-cat').forEach(c => c.classList.remove('on'));
    btn.classList.add('on');
    activeCat = cat;
    buildExplore(activeCat, activePriceF);
  }

  function filterPrice(p, btn) {
    document.querySelectorAll('#page-explore .filter-chip-price').forEach(c => c.classList.remove('on'));
    if (activePriceF === p) { activePriceF = null; }
    else { btn.classList.add('on'); activePriceF = p; }
    buildExplore(activeCat, activePriceF);
  }

  function openDeal(id) {
    prevPage = document.querySelector('.nav-link.active')?.dataset.page || 'home';
    const d = DEALS.find(x => x.id === id);
    if (!d) return;
    const heroEl = document.getElementById('detail-img');
    heroEl.style.background = d.bg;
    heroEl.innerHTML = d.image
      ? `<img src="${escHtmlApp(d.image)}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0"><div class="detail-tags" id="detail-tags" style="position:relative;z-index:1"></div>`
      : `<span style="font-size:80px">${d.emoji}</span><div class="detail-tags" id="detail-tags"></div>`;
    document.getElementById('detail-tags').innerHTML =
      d.tags.map(t => `<span class="deal-tag ${t==='Romantic'||t==='Premium'?'pink':''}">${escHtmlApp(t)}</span>`).join('');
    document.getElementById('detail-main').innerHTML = `
      <div class="detail-info">
        <h1>${escHtmlApp(d.name)}</h1>
        <div class="detail-loc">📍 ${escHtmlApp(d.location)}</div>
        <p class="detail-desc">${escHtmlApp(d.desc)}</p>
        <div class="detail-meta-grid">
          <div class="detail-meta-item"><div class="detail-meta-label">Category</div><div class="detail-meta-val">${escHtmlApp(d.categoryName)}</div></div>
          <div class="detail-meta-item"><div class="detail-meta-label">When</div><div class="detail-meta-val">${d.openingHours ? escHtmlApp(d.openingHours) : (dealDaysNote(d) ? '' : '<span class="meta-unknown">Hours not stated — check with venue</span>')}${dealDaysNote(d) ? `${d.openingHours ? '<br>' : ''}<span class="meta-days">${escHtmlApp(dealDaysNote(d))}</span>` : ''}</div></div>
          <div class="detail-meta-item"><div class="detail-meta-label">${d.endDate ? 'Offer ends' : 'Availability'}</div><div class="detail-meta-val">${d.endDate ? escHtmlApp(prettyDate(d.endDate)) : 'Ongoing'}</div></div>
          <div class="detail-meta-item"><div class="detail-meta-label">Location</div><div class="detail-meta-val">${escHtmlApp(d.location)}</div></div>
        </div>
        ${d.imageIsStock ? `<p class="detail-source">Photo is a stock image for illustration — not a photo of this venue.</p>` : ''}
        ${d.sourceUrl ? `<p class="detail-source">Deal details via <a href="${escHtmlApp(d.sourceUrl)}" target="_blank" rel="noopener noreferrer">the original listing ↗</a>. Always check current terms with the merchant before you go.</p>` : ''}
      </div>
      <div class="detail-sidebar">
        <div class="sidebar-price">${priceLabel(d)}</div>
        <div class="sidebar-price-sub">${escHtmlApp(priceUnitLabel(d))}${d.originalPrice ? ` · usually ${money(d.originalPrice)}` : ''}</div>
        <button class="sidebar-btn primary" onclick="addToPlan('${d.id}')">Add to plan</button>
        <button class="sidebar-btn secondary" id="save-deal-btn" data-deal-id="${d.id}" onclick="toggleSaveDeal('${d.id}', this)">${SAVED_DEAL_IDS.has(d.id) ? 'Saved ✓' : 'Save deal ♡'}</button>
      </div>`;
    if (SAVED_DEAL_IDS.has(d.id)) {
      const btn = document.getElementById('save-deal-btn');
      btn.style.borderColor = 'var(--green)';
      btn.style.color       = 'var(--green)';
    }
    go('detail');
  }

  function buildSavedDeals() {
    const el = document.getElementById('saved-deals-panel');
    const saved = DEALS.filter(d => SAVED_DEAL_IDS.has(d.id));

    // Guests get a standing reminder that this list lives only in this
    // browser — honest, and it's the natural moment to ask them to sign up.
    const isGuest = !CURRENT_USER;
    const guestBanner = (isGuest && saved.length)
      ? `<div class="guest-banner">
           <div><strong>Saved on this device only.</strong> Create a free account and these ${saved.length} deal${saved.length === 1 ? '' : 's'} follow you to your phone.</div>
           <button class="btn-pink" onclick="go('signup')">Create account</button>
         </div>`
      : '';

    el.innerHTML = saved.length
      ? guestBanner + `<div class="deals-grid">${saved.map(d => dealCardHTML(d)).join('')}</div>`
      : `<div class="empty-state">
          <div class="es-icon">🤍</div>
          <h3>No shortlisted deals yet</h3>
          <p>Heart a deal on Explore, or try Swipe to build your shortlist. No account needed.</p>
          <button class="btn-pink" onclick="go('swipe')">Try Swipe →</button>
        </div>`;
  }

  async function buildSavedPlansList() {
    const el = document.getElementById('saved-plans-panel');
    await loadSavedPlans();
    if (savedPlans.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🗓</div>
          <h3>No saved plans yet</h3>
          <p>Generate a date plan and save it here for easy access.</p>
          <button class="btn-pink" onclick="go('planner')">Plan your first date →</button>
        </div>`;
      return;
    }
    const guestNote = !CURRENT_USER
      ? `<div class="travel-ok" style="margin:0 0 16px">These plans are saved on this device only. <a href="#" onclick="go('signup');return false">Create an account</a> to keep them.</div>` : '';
    el.innerHTML = guestNote + savedPlans.map(p => {
      const params = p.plan?.params || {};
      const when = params.date
        ? new Date(params.date + 'T12:00').toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + fmtTime(params.time || '18:30')
        : '';
      const n = (p.plan?.stops || []).length;
      return `
        <div class="saved-plan-card" onclick="openSavedPlan('${escHtmlApp(String(p.id))}')">
          <div class="spc-icon">❤️</div>
          <div class="spc-body">
            <div class="spc-name">${escHtmlApp(p.name)}</div>
            <div class="spc-meta"><span>📅 ${escHtmlApp(when)}</span><span>🛑 ${n} ${n === 1 ? 'stop' : 'stops'}</span></div>
          </div>
          <div class="spc-right">
            <div class="spc-cost">${money(p.total)}</div>
            <div class="spc-stops">total</div>
          </div>
          <button class="spc-delete" title="Delete plan" aria-label="Delete plan" onclick="deleteSavedPlan('${escHtmlApp(String(p.id))}', event)">✕</button>
        </div>`;
    }).join('');
  }

  // ============================================================
  // SWIPE — Tinder-style card browsing.
  // Right / swipe-right = shortlist (saved_deals). Left = pass
  // (client-side only for this session; nothing is stored for a pass).
  // ============================================================
  function buildSwipe() {
    // Always open on the setup screen: the whole point is that the deck is
    // sorted by what she's told us before she swipes anything.
    showSwipeSetup();
  }

  function showSwipeSetup() {
    const setup = document.getElementById('swipe-setup');
    const deck  = document.getElementById('swipe-deck');
    if (!setup || !deck) return;
    setup.querySelectorAll('.swipe-setup-chips').forEach(group => {
      const key = group.dataset.group;
      group.querySelectorAll('.chip').forEach(btn => {
        btn.classList.toggle('on', btn.dataset.val === swipePrefs[key]);
        btn.onclick = () => {
          group.querySelectorAll('.chip').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          swipePrefs[key] = btn.dataset.val;
        };
      });
    });
    setup.style.display = '';
    deck.style.display  = 'none';
    const sub = document.getElementById('swipe-subtitle');
    if (sub) sub.textContent = 'Tell us what you want first, so you only swipe what fits';
  }

  // What one person actually pays, for budget comparison.
  //   - "total" prices are for two, so halve them.
  //   - percentage-only offers have no price: return null (unknown).
  function perPersonPrice(d) {
    if (d.discountLabel) return null;
    if (d.priceUnit === 'total') return d.price / 2;
    return d.price;
  }

  // Which of her picks a deal misses. Empty array = full match.
  // Unknown price (percentage offers) counts as fitting the budget —
  // we can't prove it's over, and hiding every "20% off" would be worse.
  function swipeMisses(d, prefs) {
    const misses = [];
    if (prefs.budget !== 'any') {
      const pp = perPersonPrice(d);
      if (pp != null && pp > Number(prefs.budget)) misses.push('budget');
    }
    if (prefs.area !== 'any' && d.region !== prefs.area) misses.push('area');
    if (prefs.vibe !== 'any' && (d.vibe || '').toLowerCase() !== prefs.vibe.toLowerCase()) misses.push('vibe');
    return misses;
  }

  // "in Central" but "in the East" — reads the way people say it here.
  function inArea(region) {
    return region === 'Central' ? 'in Central' : `in the ${region}`;
  }

  // Builds "romantic deals under $30 in Central" style phrases.
  //   describePrefs(prefs)          -> "romantic under $30 in Central"
  //   describePrefs(prefs, 'deal')  -> "romantic deal under $30 in Central"
  function describePrefs(prefs, noun) {
    const bits = [];
    if (prefs.vibe !== 'any') bits.push(prefs.vibe.toLowerCase());
    if (noun) bits.push(noun);
    if (prefs.budget !== 'any') bits.push(`under $${prefs.budget}`);
    if (prefs.area !== 'any') bits.push(inArea(prefs.area));
    return bits.join(' ');
  }

  function startSwipeDeck() {
    const prefs = swipePrefs;
    const pool = DEALS.filter(d => !SAVED_DEAL_IDS.has(d.id))
      .map(d => ({ d, misses: swipeMisses(d, prefs), pp: perPersonPrice(d) }));

    // Matches: priced deals cheapest first, then percentage offers.
    const byPrice = (a, b) => (a.pp == null) - (b.pp == null) || (a.pp ?? 0) - (b.pp ?? 0);
    const matches = pool.filter(x => !x.misses.length).sort(byPrice);

    // Stretch: closest misses first. A wrong area costs 1, a wrong vibe
    // 0.5, and going over budget costs the fraction it's over by — so a
    // $19.90 in her area (+33%) beats a $3.90 across the island, and a
    // $98 buffet (+553%) sinks to the bottom.
    const budget = prefs.budget === 'any' ? null : Number(prefs.budget);
    const distance = x => {
      let score = 0;
      if (x.misses.includes('area')) score += 1;
      if (x.misses.includes('vibe')) score += 0.5;
      if (x.misses.includes('budget')) score += (x.pp - budget) / budget;
      return score;
    };
    const stretch = pool.filter(x => x.misses.length)
      .sort((a, b) => distance(a) - distance(b) || byPrice(a, b));

    swipeDeals = matches.map(x => x.d);
    if (stretch.length) {
      swipeDeals.push({ divider: true, matchCount: matches.length, label: describePrefs(prefs) });
      swipeDeals.push(...stretch.map(x => ({ ...x.d, stretchNote: stretchNote(x.misses, x.d) })));
    }
    swipeIndex = 0;

    document.getElementById('swipe-setup').style.display = 'none';
    document.getElementById('swipe-deck').style.display  = '';
    const sub = document.getElementById('swipe-subtitle');
    if (sub) {
      const label = describePrefs(prefs);
      sub.textContent = !label ? 'Right to shortlist, left to pass'
        : matches.length
          ? `${matches.length} ${describePrefs(prefs, matches.length === 1 ? 'deal' : 'deals')} · right to shortlist, left to pass`
          : `No exact matches ${label} yet · showing the closest`;
    }
    renderSwipeStack();
  }

  // Small honest label on stretch cards so she knows WHY it's there.
  function stretchNote(misses, d) {
    const parts = [];
    if (misses.includes('budget')) parts.push('over budget');
    if (misses.includes('area') && d.region) parts.push(inArea(d.region));
    if (misses.includes('vibe') && d.vibe) parts.push(`${d.vibe.toLowerCase()} vibe`);
    return parts.join(' · ');
  }

  function renderSwipeStack() {
    const stack = document.getElementById('swipe-stack');
    if (!stack) return;
    renderSwipeSavedNote();
    if (swipeIndex >= swipeDeals.length) {
      stack.innerHTML = `<div class="empty-state">
          <div class="es-icon">🎉</div>
          <h3>That's everything for now</h3>
          <p>Check back later for new deals, or view what you've shortlisted.</p>
          <button class="btn-pink" onclick="go('saved')">View Saved →</button>
          <button class="btn-outline" style="margin-top:8px" onclick="showSwipeSetup()">Change filters</button>
        </div>`;
      return;
    }
    // Render current + next card (next sits behind, for a subtle stack effect)
    const cur  = swipeDeals[swipeIndex];
    const next = swipeDeals[swipeIndex + 1];
    stack.innerHTML = [next, cur].filter(Boolean).map(d => {
      const isTop = d === cur;
      const idAttr = isTop ? 'swipe-card-top' : 'swipe-card-behind';
      if (d.divider) {
        const what = d.label ? `everything ${escHtmlApp(d.label)}` : 'everything that matches';
        const head = d.matchCount
          ? `That's ${what}`
          : `Nothing matches ${d.label ? escHtmlApp(d.label) : 'that'} yet`;
        return `
        <div class="swipe-card swipe-divider${isTop ? ' swipe-card-top' : ''}" id="${idAttr}">
          <div class="swipe-divider-inner">
            <div class="es-icon">🧭</div>
            <h3>${head}</h3>
            <p>Here's what's close if you stretch a bit. Swipe either way to keep going.</p>
            <button class="btn-outline" onclick="event.stopPropagation();showSwipeSetup()" onpointerdown="event.stopPropagation()">Change filters</button>
          </div>
        </div>`;
      }
      const media = d.image
        ? `<img src="${escHtmlApp(d.image)}" draggable="false" style="width:100%;height:100%;object-fit:cover">`
        : `<span style="font-size:64px">${d.emoji}</span>`;
      const note = d.stretchNote ? `<div class="swipe-stretch-note">${escHtmlApp(d.stretchNote)}</div>` : '';
      return `
        <div class="swipe-card${isTop ? ' swipe-card-top' : ''}" id="${idAttr}" style="background:${d.bg}">
          ${media}
          ${note}
          <div class="swipe-card-info">
            <div class="swipe-card-name">${escHtmlApp(d.name)}</div>
            <div class="swipe-card-loc">📍 ${escHtmlApp(d.location)}</div>
            <div class="swipe-card-price">${d.discountLabel ? escHtmlApp(d.discountLabel) : (d.price === 0 ? 'Free' : priceWithUnit(d))}</div>
          </div>
        </div>`;
    }).join('');
    attachSwipeDrag(document.getElementById('swipe-card-top'));
  }

  // Pointer Events + setPointerCapture. Two reasons this shape matters:
  //   1. Every listener lives on the card itself, so when the card is
  //      replaced the listeners die with it. The old version attached
  //      mousemove/mouseup to `window` on every render and never removed
  //      them, so stale listeners piled up pointing at detached cards.
  //   2. preventDefault() on pointerdown stops the browser's native
  //      image drag — that's what made the photo stick to the cursor.
  function attachSwipeDrag(card) {
    if (!card) return;
    let startX = 0, curX = 0, dragging = false;
    card.style.transition = 'none';

    card.addEventListener('dragstart', e => e.preventDefault());

    card.addEventListener('pointerdown', e => {
      // Stops the native drag-image ghost from latching onto the cursor.
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      curX = 0;
      card.style.transition = 'none';
      card.setPointerCapture(e.pointerId);
    });

    card.addEventListener('pointermove', e => {
      if (!dragging) return;
      curX = e.clientX - startX;
      card.style.transform = `translateX(${curX}px) rotate(${curX / 18}deg)`;
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      if (card.hasPointerCapture && e && card.hasPointerCapture(e.pointerId)) {
        card.releasePointerCapture(e.pointerId);
      }
      const threshold = 110;
      if (curX > threshold)       swipeCommit('right');
      else if (curX < -threshold) swipeCommit('left');
      else {
        card.style.transition = 'transform 0.25s';
        card.style.transform  = 'translateX(0) rotate(0)';
      }
      curX = 0;
    }

    card.addEventListener('pointerup', endDrag);
    card.addEventListener('pointercancel', endDrag);
  }

  function swipeButton(direction) {
    swipeCommit(direction);
  }

  function swipeCommit(direction) {
    const card = document.getElementById('swipe-card-top');
    const deal = swipeDeals[swipeIndex];
    if (card) {
      card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      card.style.transform = `translateX(${direction === 'right' ? 600 : -600}px) rotate(${direction === 'right' ? 25 : -25}deg)`;
      card.style.opacity = '0';
    }
    // The divider isn't a deal: either direction just moves past it.
    if (direction === 'right' && deal && !deal.divider) {
      toggleSaveDeal(deal.id);
    }
    swipeIndex++;
    setTimeout(renderSwipeStack, 220);
  }

  // ============================================================
  // CONTACT / PARTNERSHIP
  // ============================================================
  function switchContactTab(tab, btn) {
    currentContactTab = tab;
    document.querySelectorAll('.contact-tab-btn').forEach(b => b.classList.remove('on'));
    if (btn) btn.classList.add('on');
    const submitBtn = document.getElementById('contact-submit-btn');
    if (submitBtn) submitBtn.textContent = tab === 'partnership' ? 'Send partnership request' : 'Send message';
  }

  async function submitContact(e) {
    e.preventDefault();
    const btn    = document.getElementById('contact-submit-btn');
    const errEl  = document.getElementById('contact-error');
    const okEl   = document.getElementById('contact-success');
    errEl.style.display = 'none';
    okEl.style.display  = 'none';

    const name    = document.getElementById('contact-name').value.trim();
    const email   = document.getElementById('contact-email').value.trim();
    const message = document.getElementById('contact-message').value.trim();

    if (!name || !email || !message) {
      errEl.textContent = 'Please fill in your name, email, and message.';
      errEl.style.display = 'block';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = 'Please enter a valid email address.';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const { error } = await db.from('contact_messages').insert({
        type: currentContactTab,
        name,
        email,
        message
      });
      if (error) throw error;
      okEl.textContent = "✓ Thanks — we'll get back to you soon.";
      okEl.style.display = 'block';
      document.getElementById('contact-form').reset();
    } catch (err) {
      errEl.textContent = err.message || 'Something went wrong. Please try again.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = currentContactTab === 'partnership' ? 'Send partnership request' : 'Send message';
    }
  }

  // ============================================================
  // PROFILE PAGE
  // ============================================================
  async function buildProfile() {
    let session;
    try {
      ({ data: { session } } = await db.auth.getSession());
    } catch (err) {
      console.error('Failed to load session for profile:', err);
      showBootError('Could not load your profile — check your connection and try again.');
      go('home');
      return;
    }
    if (!session) { go('login'); return; }

    const user      = session.user;
    const meta      = user.user_metadata || {};
    const firstName = meta.first_name || '';
    const lastName  = meta.last_name  || '';
    const fullName  = (firstName + ' ' + lastName).trim() || user.email.split('@')[0];
    const initials  = (firstName ? firstName[0] : user.email[0]).toUpperCase();

    // Avatar + header
    const avatarEl = document.getElementById('profile-avatar-lg');
    if (avatarEl) avatarEl.textContent = initials;
    const nameEl = document.getElementById('profile-display-name');
    if (nameEl) nameEl.textContent = fullName;
    const emailEl = document.getElementById('profile-display-email');
    if (emailEl) emailEl.textContent = user.email;

    // Populate fields
    const pfFirst = document.getElementById('pf-first');
    const pfLast  = document.getElementById('pf-last');
    const pfEmail = document.getElementById('pf-email');
    if (pfFirst) pfFirst.value = firstName;
    if (pfLast)  pfLast.value  = lastName;
    if (pfEmail) pfEmail.value = user.email;

    // Clear password fields and messages
    const pfNewPass  = document.getElementById('pf-new-pass');
    const pfConfPass = document.getElementById('pf-confirm-pass');
    if (pfNewPass)  pfNewPass.value  = '';
    if (pfConfPass) pfConfPass.value = '';
    ['profile-details-msg', 'profile-pass-msg'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  async function saveProfileDetails() {
    const btn    = document.getElementById('profile-save-btn');
    const msgEl  = document.getElementById('profile-details-msg');
    const first  = document.getElementById('pf-first').value.trim();
    const last   = document.getElementById('pf-last').value.trim();

    if (!first) {
      showProfileMsg(msgEl, 'err', 'First name is required.');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Saving…';

    try {
      const { data, error } = await db.auth.updateUser({
        data: { first_name: first, last_name: last }
      });
      if (error) throw error;

      // Refresh the nav and avatar immediately
      updateNavForAuth(data.user);
      const avatarEl = document.getElementById('profile-avatar-lg');
      const nameEl   = document.getElementById('profile-display-name');
      if (avatarEl) avatarEl.textContent = first[0].toUpperCase();
      if (nameEl)   nameEl.textContent   = (first + ' ' + last).trim();

      showProfileMsg(msgEl, 'ok', '✓ Profile updated!');
    } catch (err) {
      showProfileMsg(msgEl, 'err', err.message || 'Could not save changes.');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Save Changes';
    }
  }

  async function saveProfilePassword() {
    const btn     = document.getElementById('profile-pass-btn');
    const msgEl   = document.getElementById('profile-pass-msg');
    const newPass = document.getElementById('pf-new-pass').value.trim();
    const confPass= document.getElementById('pf-confirm-pass').value.trim();

    if (!newPass || !isStrongPassword(newPass)) {
      showProfileMsg(msgEl, 'err', PASSWORD_RULE_TEXT);
      return;
    }
    if (newPass !== confPass) {
      showProfileMsg(msgEl, 'err', 'Passwords do not match.');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Updating…';

    try {
      const { error } = await db.auth.updateUser({ password: newPass });
      if (error) throw error;

      document.getElementById('pf-new-pass').value   = '';
      document.getElementById('pf-confirm-pass').value = '';
      showProfileMsg(msgEl, 'ok', '✓ Password updated successfully!');
    } catch (err) {
      showProfileMsg(msgEl, 'err', err.message || 'Could not update password.');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Update Password';
    }
  }

  function showProfileMsg(el, type, text) {
    el.textContent  = text;
    el.className    = 'profile-msg ' + (type === 'ok' ? 'ok' : 'err');
    el.style.display = 'block';
    if (type === 'ok') setTimeout(() => (el.style.display = 'none'), 3000);
  }

  // ============================================================

  // ============================================================
  function fmtTime(t) {
    const [h, m] = t.split(':').map(Number);
    return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' PM' : ' AM');
  }
  function timeToMins(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }
  function minsToTime(m) {
    const h = Math.floor(m / 60) % 24, mi = m % 60;
    return ((h % 12) || 12) + ':' + (mi < 10 ? '0' : '') + mi + (h >= 12 ? ' PM' : ' AM');
  }
  function formatDate(d) {
    return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  // ============================================================
  // INIT
  // ============================================================
  const pi = document.getElementById('p-date');
  if (pi) {
    pi.value = sgToday();
    pi.min   = sgToday();
  }

  loadDealsAndCategories().then(() => {
    buildHomeTrending();
    buildExplore();
  }).catch(err => {
    console.error('Boot: failed to load deals/categories:', err);
    showBootError('Some deals may not have loaded — check your connection and refresh.');
  });

  // Check if already logged in on page load.
  //
  // Deliberately does NOT redirect suppliers to their dashboard any more.
  // It used to, which trapped them: a signed-in supplier clicking the logo
  // to browse the site was bounced straight back to the dashboard, so they
  // could never use Datify as a normal visitor. Suppliers are sent to the
  // dashboard once, right after they log in; from then on they get there
  // via the "Supplier Dashboard" link that appears in their menu.
  db.auth.getSession().then(async ({ data: { session } }) => {
    updateNavForAuth(session?.user ?? null);
    if (session?.user) {
      const supplier = await isSupplierEmail(session.user.email);
      if (supplier || session.user.email === ADMIN_EMAIL) {
        showSupplierNavLink();
      }
    }
  }).catch(err => {
    // Non-fatal: worst case the user just isn't auto-redirected /
    // the nav stays in signed-out state until they refresh.
    console.error('Boot: failed to check session:', err);
  });

  // Last-resort safety net so a bug anywhere doesn't fail silently —
  // without this, an unhandled promise rejection just vanishes into
  // the console and the user is left looking at a stuck/blank page
  // with no idea anything went wrong.
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled error:', e.reason);
    showBootError('Something went wrong loading part of the page. Try refreshing.');
  });

  function showBootError(msg) {
    let el = document.getElementById('boot-error-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'boot-error-banner';
      el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;background:#FDEAEA;color:#B42318;padding:10px 16px;text-align:center;font-size:13px;font-weight:600';
      document.body.prepend(el);
    }
    el.textContent = msg;
  }
