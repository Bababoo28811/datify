// app.js — Datify main site logic (home, planner, explore, auth, profile)
// Depends on: js/supabase-client.js (db must be defined first)

// ============================================================
  // ✅ STEP 2 — Auth state: update nav when user signs in/out
  // ============================================================
  db.auth.onAuthStateChange((event, session) => {
    updateNavForAuth(session?.user ?? null);
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
    if (password.length < 6) {
      errEl.textContent   = 'Password must be at least 6 characters.';
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

      okEl.textContent   = '✓ Account created! Check your email to confirm.';
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
      errEl.textContent   = err.message || 'Invalid email or password.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Sign in';
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

  async function loadDealsAndCategories() {
    try {
      const [catRes, dealRes] = await Promise.all([
        db.from('categories').select('id, name').order('name'),
        db.from('deals').select('*, categories(name)').order('created_at', { ascending: false })
      ]);

      CATEGORIES = catRes.data || [];

      const today = new Date().toISOString().split('T')[0];
      const rows  = (dealRes.data || []).filter(r => r.ongoing || !r.end_date || r.end_date >= today);

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
        location: r.location || 'Singapore',
        tags: [r.vibe].filter(Boolean),
        desc: r.description || '',
        best: r.ongoing ? 'Ongoing' : (r.start_date || 'Anytime'),
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
  }

  function renderCategoryChips() {
    const el = document.getElementById('category-chips');
    if (!el) return;
    const seen = new Map();
    CATEGORIES.forEach(c => seen.set(slugify(c.name), c.name));
    el.innerHTML = Array.from(seen.entries()).map(([slug, name]) =>
      `<button class="filter-chip filter-chip-cat" onclick="filterDeals('${slug}',this)">${escHtmlApp(name)}</button>`
    ).join('');
  }

  // Picks up to 4 real deals matching the chosen vibe, staying near
  // budget where possible. Falls back to any deals if none match the
  // vibe yet (early on, before suppliers have tagged much).
  function pickItineraryStops(vibeKey, budget) {
    const vibeLabel = { romantic:'Romantic', fun:'Fun', adventurous:'Adventurous', chill:'Chill', foodie:'Foodie' }[vibeKey] || 'Romantic';
    let pool = DEALS.filter(d => (d.vibe || '').toLowerCase() === vibeLabel.toLowerCase());
    if (pool.length === 0) pool = DEALS.slice();

    const sorted = pool.slice().sort((a, b) => a.price - b.price);
    const chosen = [];
    const usedCats = new Set();
    let total = 0;

    for (const d of sorted) {
      if (chosen.length >= 4) break;
      if (usedCats.has(d.type)) continue;
      if (chosen.length > 0 && total + d.price > budget) continue;
      chosen.push(d); usedCats.add(d.type); total += d.price;
    }
    if (chosen.length < 2) {
      chosen.length = 0; total = 0;
      for (const d of sorted) {
        if (chosen.length >= 3) break;
        if (chosen.length > 0 && total + d.price > budget) break;
        chosen.push(d); total += d.price;
      }
    }
    return chosen;
  }

  let curVibe = 'romantic';
  let savedPlans = [];
  let prevPage = 'home';
  let activeCat = 'all';
  let activePriceF = null;

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
    if (page === 'saved')   buildSaved();
    if (page === 'explore') buildExplore(activeCat, activePriceF);
    if (page === 'profile') buildProfile();
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
        setTimeout(() => { buildResults(); go('results'); }, 500);
      }
    }, 560);
  }

  function buildResults() {
    const budget = parseInt(document.getElementById('budget-slider').value) || 70;
    const time   = document.getElementById('p-time')?.value || '18:30';
    const dur    = parseInt(document.getElementById('p-dur')?.value) || 3;
    const dateVal= document.getElementById('p-date')?.value;
    const loc    = document.getElementById('p-loc')?.value || 'Singapore';
    const dateStr= dateVal
      ? new Date(dateVal + 'T12:00').toLocaleDateString('en-US', {weekday:'long',day:'numeric',month:'long'})
      : formatDate(new Date());

    document.getElementById('res-date-line').textContent =
      dateStr + ' • ' + fmtTime(time) + ' • ' + dur + ' hours';

    const stops = pickItineraryStops(curVibe, budget);

    if (stops.length === 0) {
      document.getElementById('timeline').innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🗓</div>
          <h3>No deals to plan with yet</h3>
          <p>Once suppliers add deals, they'll show up here.</p>
        </div>`;
      document.getElementById('res-pills').innerHTML = '';
      document.getElementById('total-summary').innerHTML = '';
      document.getElementById('res-extras').innerHTML = '';
      return;
    }

    let cursor = timeToMins(time), total = 0;
    let tlHTML = '<div class="tl-spine"></div>';

    stops.forEach((s, i) => {
      const endMins  = cursor + s.dur;
      const startStr = minsToTime(cursor);
      const endStr   = minsToTime(endMins);
      total += s.price;
      const typeClass = s.type === 'food' ? 'food' : s.type === 'drinks' ? 'drinks' : 'activity';
      const thumb = s.image
        ? `<img src="${escHtmlApp(s.image)}" style="width:100%;height:100%;object-fit:cover;border-radius:14px">`
        : s.emoji;

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
                <div class="tl-price">${s.price === 0 ? 'Free' : '$' + s.price}</div>
                <div class="tl-price-sub">per person</div>
              </div>
              <div class="tl-actions">
                <button class="tl-act-btn"        onclick="replaceStop(${i})">Replace</button>
                <button class="tl-act-btn remove" onclick="removeStop(${i})">Remove</button>
              </div>
            </div>
          </div>
        </div>`;

      cursor = endMins;
    });

    document.getElementById('timeline').innerHTML = tlHTML +
      `<div style="font-size:12px;color:var(--muted);margin-top:12px;padding-left:4px">
        ⏱ Times are estimated (60 min/stop) — travel time between stops isn't calculated yet, so double-check locations before you go.
      </div>`;

    const totalMins = cursor - timeToMins(time);
    document.getElementById('res-pills').innerHTML = `
      <div class="r-pill">📍 ${stops.length} stops</div>
      <div class="r-pill">💰 $${total} total</div>
      <div class="r-pill">🕐 ${Math.floor(totalMins/60)}h ${totalMins%60 > 0 ? totalMins%60+'m' : ''}</div>
      <div class="r-pill">📍 ${escHtmlApp(loc)}</div>`;

    document.getElementById('total-summary').innerHTML = `
      <div class="ts-item"><div class="ts-label">Total cost</div><div class="ts-val pink">$${total}</div></div>
      <div class="ts-divider"></div>
      <div class="ts-item"><div class="ts-label">Budget left</div><div class="ts-val">$${Math.max(0, budget - total)}</div></div>
      <div class="ts-divider"></div>
      <div class="ts-item"><div class="ts-label">Duration</div><div class="ts-val">${Math.floor(totalMins/60)}h ${totalMins%60 > 0 ? totalMins%60+'m' : ''}</div></div>
      <div class="ts-divider"></div>
      <div class="ts-item"><div class="ts-label">Stops</div><div class="ts-val">${stops.length}</div></div>
      <button class="save-plan-btn" onclick="savePlan()">Save this plan ♡</button>`;

    const stopIds = new Set(stops.map(s => s.id));
    const extras  = DEALS.filter(d => !stopIds.has(d.id)).slice(0, 4);
    document.getElementById('res-extras').innerHTML = extras.map(d => dealCardHTML(d)).join('');
  }

  function removeStop(idx) {
    const card = document.getElementById('tlc-' + idx);
    if (card) card.closest('.tl-item').remove();
  }

  function replaceStop(idx) {
    go('explore');
  }

  function savePlan() {
    const name  = document.querySelector('.results-plan-name')?.textContent || 'My Date Plan';
    const cost  = document.querySelector('.ts-val.pink')?.textContent || '$0';
    const stops = document.querySelectorAll('#timeline .tl-card').length || 3;
    savedPlans.push({ name, cost, date: new Date().toLocaleDateString(), emoji: '❤️', stops });
    const btn = document.querySelector('.save-plan-btn');
    if (btn) { btn.textContent = 'Saved! ✓'; btn.style.background = '#10B981'; }
  }

  // ============================================================
  // DEAL CARDS
  // ============================================================
  function dealCardHTML(d) {
    const media = d.image
      ? `<img src="${escHtmlApp(d.image)}" style="width:100%;height:100%;object-fit:cover">`
      : `<span style="font-size:52px">${d.emoji}</span>`;
    return `
      <div class="deal-card" onclick="openDeal('${d.id}')">
        <div class="deal-img" style="background:${d.bg}">
          ${media}
          <div class="deal-img-overlay">
            ${d.tags.map(t => `<span class="deal-tag ${t==='Romantic'||t==='Premium' ? 'pink' : ''}">${escHtmlApp(t)}</span>`).join('')}
          </div>
          <div class="deal-save" onclick="event.stopPropagation();this.classList.toggle('saved')">♡</div>
        </div>
        <div class="deal-body">
          <div class="deal-name">${escHtmlApp(d.name)}</div>
          <div class="deal-loc">📍 ${escHtmlApp(d.location)}</div>
          <div class="deal-footer">
            <div class="deal-price">${d.price === 0 ? '<span>Free</span>' : '$' + d.price + ' <span>pp</span>'}</div>
            <button class="deal-cta" onclick="event.stopPropagation();go('planner')">Add to plan</button>
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
    if (priceFilter === 'budget')  filtered = filtered.filter(d => d.price < 20);
    else if (priceFilter === 'mid')     filtered = filtered.filter(d => d.price >= 20 && d.price <= 60);
    else if (priceFilter === 'premium') filtered = filtered.filter(d => d.price > 60);
    const el = document.getElementById('explore-grid');
    el.innerHTML = filtered.length
      ? filtered.map(d => dealCardHTML(d)).join('')
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
          <div class="detail-meta-item"><div class="detail-meta-label">Best time</div><div class="detail-meta-val">${escHtmlApp(d.best)}</div></div>
          <div class="detail-meta-item"><div class="detail-meta-label">Location</div><div class="detail-meta-val">${escHtmlApp(d.location)}</div></div>
        </div>
      </div>
      <div class="detail-sidebar">
        <div class="sidebar-price">${d.price === 0 ? 'Free' : '$' + d.price}</div>
        <div class="sidebar-price-sub">${d.price > 0 ? 'per person' : ''}</div>
        <button class="sidebar-btn primary" onclick="go('planner')">Add to plan</button>
        <button class="sidebar-btn secondary" id="save-deal-btn" onclick="toggleSaveDeal(this)">Save deal ♡</button>
      </div>`;
    go('detail');
  }

  function toggleSaveDeal(btn) {
    const saved = btn.textContent.includes('✓');
    btn.textContent = saved ? 'Save deal ♡' : 'Saved ✓';
    btn.style.borderColor = saved ? '' : 'var(--green)';
    btn.style.color       = saved ? '' : 'var(--green)';
  }

  function buildSaved() {
    const el = document.getElementById('saved-list');
    if (savedPlans.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🗓</div>
          <h3>No saved plans yet</h3>
          <p>Generate a date plan and save it here for easy access.</p>
          <button class="btn-pink" onclick="go('planner')">Plan your first date →</button>
        </div>`;
    } else {
      el.innerHTML = savedPlans.map(p => `
        <div class="saved-plan-card" onclick="go('results')">
          <div class="spc-icon">${p.emoji}</div>
          <div class="spc-body">
            <div class="spc-name">${p.name}</div>
            <div class="spc-meta"><span>📅 ${p.date}</span><span>🛑 ${p.stops} stops</span></div>
          </div>
          <div class="spc-right">
            <div class="spc-cost">${p.cost}</div>
            <div class="spc-stops">total</div>
          </div>
        </div>`).join('');
    }
  }

  // ============================================================
  // PROFILE PAGE
  // ============================================================
  async function buildProfile() {
    const { data: { session } } = await db.auth.getSession();
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

    if (!newPass || newPass.length < 6) {
      showProfileMsg(msgEl, 'err', 'Password must be at least 6 characters.');
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
  const today = new Date();
  const pi = document.getElementById('p-date');
  if (pi) {
    pi.value = today.toISOString().split('T')[0];
    pi.min   = today.toISOString().split('T')[0];
  }

  loadDealsAndCategories().then(() => {
    buildHomeTrending();
    buildExplore();
  });

  // Check if already logged in on page load.
  // If a supplier lands on index.html while already signed in,
  // silently bounce them to their dashboard.
  db.auth.getSession().then(async ({ data: { session } }) => {
    updateNavForAuth(session?.user ?? null);
    if (session?.user) {
      const supplier = await isSupplierEmail(session.user.email);
      if (supplier) {
        window.location.href = 'supplier-dashboard.html';
      }
    }
  });
