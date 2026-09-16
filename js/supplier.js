// supplier.js — Supplier Dashboard Logic
// Depends on: supabase.js (db must be defined first)

// The founder account can view this dashboard without being a whitelisted
// supplier, so you can see exactly what suppliers see without adding
// yourself to the whitelist (which would hijack your own logins).
const SUPPLIER_ADMIN_EMAIL = 'elisazhu.ys@gmail.com';

// ============================================================
// AUTH GUARD — redirect if not logged in or not whitelisted
// ============================================================
async function initSupplierDashboard() {
  let session;
  try {
    ({ data: { session } } = await db.auth.getSession());
  } catch (err) {
    console.error('Dashboard boot: could not check session:', err);
    showBootFailure('Could not connect to Datify. Check your internet connection and refresh the page.');
    return;
  }

  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  // Check whitelist
  let data, whitelistError;
  try {
    ({ data, error: whitelistError } = await db
      .from('supplier_whitelist')
      .select('email, business_name, seller_id')
      .eq('email', session.user.email)
      .single());
  } catch (err) {
    console.error('Dashboard boot: whitelist check failed:', err);
    showBootFailure('Could not verify your supplier account. Check your connection and refresh.');
    return;
  }

  const isAdmin = session.user.email === SUPPLIER_ADMIN_EMAIL;

  if ((whitelistError || !data) && !isAdmin) {
    // Valid Datify user but NOT a supplier — send them home
    window.location.href = 'index.html';
    return;
  }

  // Show user email + Seller ID in nav
  const navEl = document.getElementById('nav-user-email');
  if (navEl) navEl.textContent = session.user.email;
  const sellerIdEl = document.getElementById('nav-seller-id');
  if (sellerIdEl && data && data.seller_id) {
    sellerIdEl.textContent = data.seller_id;
    sellerIdEl.style.display = '';
  }
  if (isAdmin && (!data || whitelistError)) {
    // Shown as a note under the page heading rather than crammed into the
    // nav badge, which made the top bar cluttered.
    const note  = document.getElementById('admin-preview-note');
    const email = document.getElementById('admin-preview-email');
    if (email) email.textContent = session.user.email;
    if (note)  note.style.display = 'flex';
  }

  // Load data — failures here shouldn't leave the page stuck on
  // "Loading…" forever with no explanation.
  try {
    await loadCategories();
    await loadPublicHolidays();
    wireHolidayQuestion();
    await loadMyDeals();
  } catch (err) {
    console.error('Dashboard boot: failed to load data:', err);
    showBootFailure('Could not load your deals/categories. Check your connection and refresh.');
  }
}

function showBootFailure(msg) {
  let el = document.getElementById('boot-error-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-error-banner';
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;background:#FDEAEA;color:#B42318;padding:10px 16px;text-align:center;font-size:13px;font-weight:600';
    document.body.prepend(el);
  }
  el.textContent = msg;
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled error:', e.reason);
  showBootFailure('Something went wrong. Try refreshing the page.');
});

async function supplierLogout() {
  await db.auth.signOut();
  window.location.href = 'index.html';
}

// ============================================================
// CATEGORIES
// ============================================================
let categories = [];

async function loadCategories() {
  const { data, error } = await db
    .from('categories')
    .select('*')
    .order('name');

  if (error) {
    console.error('Failed to load categories:', error);
    const el = document.getElementById('cat-chips');
    if (el) el.innerHTML = '<span style="font-size:13px;color:var(--red)">Could not load categories — refresh to try again.</span>';
    return;
  }

  categories = data || [];
  renderCategoryChips();
  renderCategorySelect();
}

function renderCategoryChips() {
  const el = document.getElementById('cat-chips');
  if (categories.length === 0) {
    el.innerHTML = '<span style="font-size:13px;color:var(--muted)">No categories yet. Add one above.</span>';
    return;
  }
  el.innerHTML = categories.map(c => `
    <span style="display:inline-flex;align-items:center;gap:6px;
      background:var(--pink-light);color:var(--pink);border:1px solid var(--border);
      border-radius:100px;padding:5px 14px;font-size:13px;font-weight:600">
      ${escHtml(c.name)}
      <button
        onclick="deleteCategory('${c.id}')"
        style="background:none;border:none;cursor:pointer;color:var(--muted);
               font-size:16px;line-height:1;padding:0;margin-left:2px"
        title="Remove">&times;</button>
    </span>`).join('');
}

function renderCategorySelect() {
  const sel = document.getElementById('f-category');
  const current = sel.value;
  sel.innerHTML = '<option value="">Select…</option>' +
    categories.map(c =>
      `<option value="${c.id}" ${c.id === current ? 'selected' : ''}>${escHtml(c.name)}</option>`
    ).join('');
}

async function addCategory() {
  const input  = document.getElementById('new-cat-input');
  const msgEl  = document.getElementById('cat-msg');
  const name   = input.value.trim();
  if (!name) return;

  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    showMsg(msgEl, 'error', 'Your session expired — please sign in again.');
    setTimeout(() => (window.location.href = 'index.html'), 1500);
    return;
  }

  const { error } = await db.from('categories').insert({
    name,
    supplier_id: session.user.id
  });

  if (error) {
    showMsg(msgEl, 'error', error.message);
    return;
  }

  input.value = '';
  showMsg(msgEl, 'success', `"${name}" added!`);
  setTimeout(() => (msgEl.style.display = 'none'), 2200);
  await loadCategories();
}

async function deleteCategory(id) {
  if (!confirm('Delete this category? Deals using it will be unlinked.')) return;
  const { error } = await db.from('categories').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  await loadCategories();
}

// ============================================================
// DEALS — load & render table
// ============================================================
let allDeals = [];
let editingId = null;

// Today's date in Singapore as YYYY-MM-DD (toISOString() is UTC).
function sgToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
}

// Where a deal is in its life, worked out from its dates. Suppliers never
// set this directly, so it can't disagree with the dates they entered.
function dealPhase(d, today) {
  if (d.start_date && d.start_date > today) return 'scheduled';
  if (!d.ongoing && d.end_date && d.end_date < today) return 'expired';
  return 'active';
}

function fmtShortDate(iso) {
  return new Date(iso + 'T12:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

// ============================================================
// PUBLIC HOLIDAYS — if a deal's dates and days cover a holiday, the
// supplier has to say whether it's valid that day before saving.
// ============================================================
let PUBLIC_HOLIDAYS = [];   // [{ day: 'YYYY-MM-DD', name }]
// Don't ask about holidays on an untouched blank form; wait until the
// supplier has filled in dates/days (or tries to save, or is editing).
let holidayQuestionArmed = false;
// The supplier's answers so far, kept across re-renders: { date: true/false }.
let holidayAnswers = {};
const DOW_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];

async function loadPublicHolidays() {
  try {
    const { data } = await db.from('public_holidays').select('day, name').order('day');
    PUBLIC_HOLIDAYS = data || [];
  } catch (err) {
    // Not fatal: the question just won't appear.
    console.error('Could not load public holidays:', err);
  }
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00');
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('en-CA').format(d);
}

// Holidays the deal as currently filled in would run over.
// No end date / ongoing = look a year ahead.
function holidaysCovered() {
  const today   = sgToday();
  const ongoing = document.getElementById('f-ongoing').checked;
  const start   = document.getElementById('f-start-date').value || today;
  const endVal  = document.getElementById('f-end-date').value;
  const from    = start > today ? start : today;   // past holidays don't matter
  const to      = (!ongoing && endVal) ? endVal : addDays(from, 365);
  const days    = [...document.querySelectorAll('input[name="f-day"]:checked')].map(cb => cb.value);
  return PUBLIC_HOLIDAYS.filter(h => {
    if (h.day < from || h.day > to) return false;
    const dow = DOW_KEYS[new Date(h.day + 'T12:00').getDay()];
    return !days.length || days.length === 7 || days.includes(dow);
  });
}

// Re-check whenever anything that affects the answer changes.
function wireHolidayQuestion() {
  const onChange = () => { holidayQuestionArmed = true; refreshHolidayQuestion(); };
  ['f-start-date', 'f-end-date', 'f-ongoing'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', onChange));
  document.querySelectorAll('input[name="f-day"]').forEach(cb =>
    cb.addEventListener('change', onChange));
}

function refreshHolidayQuestion() {
  const box = document.getElementById('ph-question');
  if (!box) return;
  const hits = holidayQuestionArmed ? holidaysCovered() : [];
  if (!hits.length) { box.style.display = 'none'; return; }

  const label = h => {
    const d = new Date(h.day + 'T12:00');
    return `${escHtml(h.name)} <span class="ph-date">${d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')}</span>`;
  };
  document.getElementById('ph-q-text').textContent =
    `This deal runs over ${hits.length === 1 ? 'a public holiday' : hits.length + ' public holidays'}. Is it valid on each one?`;
  document.getElementById('ph-rows').innerHTML = hits.map(h => {
    const a = holidayAnswers[h.day];
    return `<div class="ph-row">
      <div class="ph-name">${label(h)}</div>
      <div class="ph-opts">
        <label class="slot-chip"><input type="radio" name="ph-${h.day}" value="yes" data-day="${h.day}" ${a === true ? 'checked' : ''}><span>Valid</span></label>
        <label class="slot-chip"><input type="radio" name="ph-${h.day}" value="no" data-day="${h.day}" ${a === false ? 'checked' : ''}><span>Not valid</span></label>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('#ph-rows input[type=radio]').forEach(r =>
    r.addEventListener('change', () => { holidayAnswers[r.dataset.day] = r.value === 'yes'; }));
  // Shortcuts only earn their space when there's a long list.
  document.getElementById('ph-bulk').style.display = hits.length > 2 ? '' : 'none';
  box.style.display = '';
}

// "All valid" / "None valid" shortcut buttons.
function setAllHolidays(valid) {
  holidaysCovered().forEach(h => { holidayAnswers[h.day] = valid; });
  refreshHolidayQuestion();
}

const SLOT_LABELS = { morning: 'Morning', midday: 'Lunch', afternoon: 'Afternoon', evening: 'Evening', late: 'Late night' };

async function loadMyDeals() {
  const tbody = document.getElementById('deals-tbody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--muted)">Loading…</td></tr>';

  const { data: { session } } = await db.auth.getSession();

  const { data, error } = await db
    .from('deals')
    .select('*, categories(name)')
    .eq('supplier_id', session.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--red)">${error.message}</td></tr>`;
    return;
  }

  allDeals = data || [];
  updateStats();

  if (allDeals.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--muted)">No deals yet — add your first one!</td></tr>';
    return;
  }

  const today = sgToday();
  tbody.innerHTML = allDeals.map(d => {
    const phase      = dealPhase(d, today);
    const statusCls  = 'status-' + phase;
    const statusTxt  = phase === 'scheduled' ? `Scheduled · live ${fmtShortDate(d.start_date)}`
                     : phase === 'expired'   ? 'Expired' : 'Active';
    const endsTxt    = d.ongoing ? 'Ongoing' : (d.end_date || '—');
    const thumb      = d.image_url
      ? `<div class="deal-thumb"><img src="${escHtml(d.image_url)}" alt=""></div>`
      : `<div class="deal-thumb">🎁</div>`;

    const approval    = d.status || 'pending';
    const approvalCls = approval === 'approved' ? 'approval-approved' : approval === 'rejected' ? 'approval-rejected' : 'approval-pending';
    const approvalTxt = approval === 'approved' ? 'Approved' : approval === 'rejected' ? 'Rejected' : 'Pending review';

    return `<tr>
      <td>${thumb}</td>
      <td style="font-weight:600;max-width:180px">${escHtml(d.title)}</td>
      <td style="color:var(--muted)">${escHtml(d.categories?.name || '—')}</td>
      <td>$${Number(d.price).toFixed(2)}</td>
      <td style="font-size:13px;color:var(--muted)">${escHtml(endsTxt)}</td>
      <td><span class="status-pill ${statusCls}">${statusTxt}</span></td>
      <td><span class="status-pill ${approvalCls}">${approvalTxt}</span></td>
      <td>
        <div class="td-actions">
          <button class="btn-sm-outline" onclick="startEdit('${d.id}')">Edit</button>
          <button class="btn-sm-danger"  onclick="deleteDeal('${d.id}')">Delete</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function updateStats() {
  const today     = sgToday();
  const count     = ph => allDeals.filter(d => dealPhase(d, today) === ph).length;
  const active    = count('active');
  const expired   = count('expired');
  document.getElementById('stat-active').textContent  = active;
  document.getElementById('stat-scheduled').textContent = count('scheduled');
  document.getElementById('stat-total').textContent   = allDeals.length;
  document.getElementById('stat-expired').textContent = expired;
}

// ============================================================
// DEALS — add / edit / delete
// ============================================================
function startEdit(id) {
  const deal = allDeals.find(d => d.id === id);
  if (!deal) return;
  editingId = id;

  document.getElementById('form-heading').textContent    = 'Edit Deal';
  document.getElementById('cancel-edit-btn').style.display = 'block';
  document.getElementById('submit-btn').textContent      = 'Save Changes';
  document.getElementById('editing-id').value            = id;

  document.getElementById('f-title').value        = deal.title          || '';
  document.getElementById('f-desc').value         = deal.description    || '';
  document.getElementById('f-price').value        = deal.price          ?? '';
  document.getElementById('f-orig-price').value   = deal.original_price ?? '';
  document.getElementById('f-location').value     = deal.location       || '';
  document.getElementById('f-category').value     = deal.category_id    || '';
  document.getElementById('f-vibe').value         = deal.vibe           || '';
  document.getElementById('f-activity').value     = deal.activity_type  || '';
  document.getElementById('f-price-unit').value   = deal.price_unit     || 'per person';
  document.getElementById('f-hours').value        = deal.opening_hours  || '';
  document.getElementById('f-start-date').value   = deal.start_date     || '';
  document.getElementById('f-end-date').value     = deal.end_date       || '';
  document.getElementById('f-ongoing').checked    = deal.ongoing        || false;
  document.querySelectorAll('input[name="f-slot"]').forEach(cb => {
    cb.checked = (deal.time_slots || []).includes(cb.value);
  });
  document.querySelectorAll('input[name="f-day"]').forEach(cb => {
    cb.checked = (deal.days || []).includes(cb.value);
  });
  holidayAnswers = { ...(deal.holiday_validity || {}) };
  document.getElementById('img-url-input').value  = deal.image_url      || '';

  if (deal.image_url) {
    const area    = document.getElementById('img-area');
    const preview = document.getElementById('img-preview');
    preview.src   = deal.image_url;
    area.classList.add('has-img');
  }

  toggleOngoing(document.getElementById('f-ongoing'));
  holidayQuestionArmed = true;
  refreshHolidayQuestion();
  document.querySelector('.card:has(#deal-form)').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingId = null;
  document.getElementById('form-heading').textContent      = 'Add New Deal';
  document.getElementById('cancel-edit-btn').style.display = 'none';
  document.getElementById('submit-btn').textContent        = 'Add Deal';
  document.getElementById('editing-id').value             = '';
  document.getElementById('deal-form').reset();
  document.getElementById('end-date-wrap').style.display  = 'block';
  holidayQuestionArmed = false;
  holidayAnswers = {};
  refreshHolidayQuestion();
  removeImg();
  document.getElementById('form-msg').style.display = 'none';
}

async function deleteDeal(id) {
  if (!confirm('Delete this deal? This cannot be undone.')) return;
  const msgEl = document.getElementById('table-msg');
  const { error } = await db.from('deals').delete().eq('id', id);
  if (error) { showMsg(msgEl, 'error', error.message); return; }
  await loadMyDeals();
}

async function submitDeal(e) {
  e.preventDefault();
  const btn   = document.getElementById('submit-btn');
  const msgEl = document.getElementById('form-msg');
  msgEl.style.display = 'none';
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error('Your session expired — please sign in again.');

    // Upload new image if one was selected
    let imageUrl = document.getElementById('img-url-input').value || null;
    const fileInput = document.getElementById('img-input');
    if (fileInput.files[0]) {
      imageUrl = await uploadImage(fileInput.files[0], session.user.id);
      if (!imageUrl) throw new Error('Image upload failed. Check your storage bucket.');
    }

    const ongoing = document.getElementById('f-ongoing').checked;
    const startDate = document.getElementById('f-start-date').value || null;
    const endDate   = ongoing ? null : (document.getElementById('f-end-date').value || null);
    if (startDate && endDate && endDate < startDate) {
      throw new Error('End date is before the start date.');
    }
    // Nothing ticked = works any time of day.
    const slots = [...document.querySelectorAll('input[name="f-slot"]:checked')].map(cb => cb.value);
    // Nothing ticked (or all seven) = every day.
    const days  = [...document.querySelectorAll('input[name="f-day"]:checked')].map(cb => cb.value);

    // Holiday answers: every holiday the deal covers needs one. Answers for
    // holidays it no longer covers are dropped.
    holidayQuestionArmed = true;
    refreshHolidayQuestion();
    const covered = holidaysCovered();
    const missing = covered.filter(h => typeof holidayAnswers[h.day] !== 'boolean');
    if (missing.length) {
      throw new Error(`Please say whether the deal is valid on ${missing.length === 1 ? missing[0].name : missing.length + ' of the public holidays'}.`);
    }
    const holidayValidity = {};
    covered.forEach(h => { holidayValidity[h.day] = holidayAnswers[h.day]; });

    const payload = {
      supplier_id:    session.user.id,
      title:          document.getElementById('f-title').value.trim(),
      description:    document.getElementById('f-desc').value.trim()  || null,
      price:          parseFloat(document.getElementById('f-price').value) || 0,
      original_price: parseFloat(document.getElementById('f-orig-price').value) || null,
      location:       document.getElementById('f-location').value.trim() || null,
      category_id:    document.getElementById('f-category').value        || null,
      vibe:           document.getElementById('f-vibe').value             || null,
      activity_type:  document.getElementById('f-activity').value.trim() || null,
      price_unit:     document.getElementById('f-price-unit').value || 'per person',
      opening_hours:  document.getElementById('f-hours').value.trim() || null,
      start_date:     startDate,
      end_date:       endDate,
      time_slots:     slots.length ? slots : null,
      days:           days.length && days.length < 7 ? days : null,
      holiday_validity: holidayValidity,
      ongoing,
      image_url:      imageUrl,
      updated_at:     new Date().toISOString()
    };

    let error;
    if (editingId) {
      ({ error } = await db.from('deals').update(payload).eq('id', editingId));
    } else {
      ({ error } = await db.from('deals').insert(payload));
    }

    if (error) throw error;

    const scheduledNote = startDate && startDate > sgToday()
      ? ` It'll go live on ${fmtShortDate(startDate)} once approved.` : '';
    const doneMsg = (editingId ? '✓ Deal updated!' : '✓ Deal added!') + scheduledNote;
    // cancelEdit() hides the message box, so reset the form first.
    cancelEdit();
    showMsg(msgEl, 'success', doneMsg);
    await loadMyDeals();
    setTimeout(() => (msgEl.style.display = 'none'), scheduledNote ? 6000 : 2500);

  } catch (err) {
    showMsg(msgEl, 'error', err.message || 'Something went wrong.');
  } finally {
    btn.disabled    = false;
    btn.textContent = editingId ? 'Save Changes' : 'Add Deal';
  }
}

// ============================================================
// IMAGE UPLOAD (Supabase Storage bucket: "deal-images")
// ============================================================
async function uploadImage(file, userId) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${userId}/${Date.now()}.${ext}`;

  const barWrap = document.getElementById('upload-bar-wrap');
  const bar     = document.getElementById('upload-bar');
  barWrap.style.display = 'block';
  bar.style.width = '40%';

  const { data, error } = await db.storage
    .from('deal-images')
    .upload(path, file, { cacheControl: '3600', upsert: false });

  bar.style.width = '100%';
  setTimeout(() => (barWrap.style.display = 'none'), 600);

  if (error) { console.error('Upload error:', error); return null; }

  const { data: { publicUrl } } = db.storage
    .from('deal-images')
    .getPublicUrl(path);

  return publicUrl;
}

function previewImg(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const area    = document.getElementById('img-area');
    const preview = document.getElementById('img-preview');
    preview.src   = e.target.result;
    area.classList.add('has-img');
  };
  reader.readAsDataURL(file);
}

function removeImg(e) {
  if (e) e.stopPropagation();
  const area    = document.getElementById('img-area');
  const preview = document.getElementById('img-preview');
  const input   = document.getElementById('img-input');
  preview.src   = '';
  area.classList.remove('has-img');
  input.value   = '';
  document.getElementById('img-url-input').value = '';
}

function toggleOngoing(cb) {
  document.getElementById('end-date-wrap').style.display = cb.checked ? 'none' : 'block';
}

// ============================================================
// UTILS
// ============================================================
function showMsg(el, type, text) {
  el.textContent = text;
  el.className   = `msg msg-${type === 'error' ? 'error' : 'success'}`;
  el.style.display = 'block';
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// BOOT
// ============================================================
initSupplierDashboard();
