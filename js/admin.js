// admin.js — Deal approval queue. Restricted to the founder account;
// RLS on the `deals` table is the real enforcement (deals_admin_update
// policy checks the JWT email server-side) — this client-side check is
// just to redirect non-admins away before they see an empty/broken page.
const ADMIN_EMAIL = 'elisazhu.ys@gmail.com';

let adminDeals = [];

// Approved, dated deals — the expiry panel's own dataset. It can't reuse
// adminDeals because that follows the queue's status dropdown, which starts
// on "pending"; expiry only ever concerns deals that are already live.
let expiringDeals = [];

async function initAdmin() {
  let session;
  try {
    ({ data: { session } } = await db.auth.getSession());
  } catch (err) {
    console.error('Admin boot: could not check session:', err);
    showAdminBootFailure('Could not connect to Datify. Check your connection and refresh.');
    return;
  }

  if (!session || session.user.email !== ADMIN_EMAIL) {
    window.location.href = 'index.html';
    return;
  }

  const navEl = document.getElementById('nav-user-email');
  if (navEl) navEl.textContent = session.user.email;

  try {
    await Promise.all([loadAdminDeals(), loadExpiring(), loadReviews()]);
  } catch (err) {
    console.error('Admin boot: failed to load deals:', err);
    showAdminBootFailure('Could not load the approval queue. Check your connection and refresh.');
  }
}

function showAdminBootFailure(msg) {
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
  showAdminBootFailure('Something went wrong. Try refreshing the page.');
});

async function adminLogout() {
  await db.auth.signOut();
  window.location.href = 'index.html';
}

async function loadAdminDeals() {
  const tbody  = document.getElementById('admin-deals-tbody');
  const filter = document.getElementById('admin-filter').value;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">Loading…</td></tr>';

  let query = db.from('deals').select('*, categories(name)').order('created_at', { ascending: false });
  if (filter !== 'all') query = query.eq('status', filter);

  const { data, error } = await query;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--red)">${escHtml(error.message)}</td></tr>`;
    return;
  }

  adminDeals = data || [];

  // Look up supplier emails for display. Requires the
  // profiles_admin_select_all policy (admin can read all profiles).
  const supplierIds = [...new Set(adminDeals.map(d => d.supplier_id).filter(Boolean))];
  let emailById = {};
  if (supplierIds.length) {
    const { data: profiles } = await db.from('profiles').select('id, email').in('id', supplierIds);
    (profiles || []).forEach(p => { emailById[p.id] = p.email; });
  }

  await updateAdminStats();

  if (adminDeals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">No deals in this view.</td></tr>`;
    return;
  }

  tbody.innerHTML = adminDeals.map(d => {
    const thumb = d.image_url
      ? `<div class="deal-thumb"><img src="${escHtml(d.image_url)}" alt=""></div>`
      : `<div class="deal-thumb">🎁</div>`;
    const status    = d.status || 'pending';
    const statusCls = status === 'approved' ? 'approval-approved' : status === 'rejected' ? 'approval-rejected' : 'approval-pending';
    const statusTxt = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending';
    const supplierEmail = emailById[d.supplier_id] || d.supplier_id;

    return `<tr>
      <td>${thumb}</td>
      <td style="font-weight:600;max-width:180px">${escHtml(d.title)}</td>
      <td style="color:var(--muted);font-size:13px">${escHtml(supplierEmail)}</td>
      <td style="color:var(--muted)">${escHtml(d.categories?.name || '—')}</td>
      <td>$${Number(d.price).toFixed(2)}</td>
      <td><span class="status-pill ${statusCls}">${statusTxt}</span></td>
      <td>
        <div class="td-actions">
          <button class="btn-sm-outline" onclick="viewAdminDeal('${d.id}')">View</button>
          <button class="btn-sm-outline" onclick="setVenueUrl('${d.id}')" title="${d.venue_url ? escHtml(d.venue_url) : 'No venue link yet'}">Link${d.venue_url ? ' &check;' : ''}</button>
          ${status !== 'approved' ? `<button class="btn-sm" onclick="setDealStatus('${d.id}','approved')">Approve</button>` : ''}
          ${status !== 'rejected' ? `<button class="btn-sm-danger" onclick="setDealStatus('${d.id}','rejected')">Reject</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function viewAdminDeal(id) {
  const d = adminDeals.find(x => x.id === id);
  if (!d) return;
  alert(
    `${d.title}\n\n${d.description || '(no description)'}\n\n` +
    `Price: $${Number(d.price).toFixed(2)}${d.original_price ? ' (was $' + Number(d.original_price).toFixed(2) + ')' : ''}\n` +
    `Location: ${d.location || '—'}\nVibe: ${d.vibe || '—'}\nActivity: ${d.activity_type || '—'}\n` +
    `Dates: ${d.ongoing ? 'Ongoing' : (d.start_date || '—') + ' to ' + (d.end_date || '—')}`
  );
}

// The 19 curated deals have no supplier, so they never show up on the
// supplier dashboard and there is nowhere else to give them a venue link.
// A prompt is crude, but it matches viewAdminDeal()'s alert() and it is the
// fastest way to walk a list of 19.
async function setVenueUrl(id) {
  const d = adminDeals.find(x => x.id === id);
  if (!d) return;
  const msgEl = document.getElementById('admin-msg');

  const answer = prompt(
    `Venue link for "${d.title}"\n\n` +
    `Where a visitor should land when they want this deal - the venue's own ` +
    `booking or deal page, not the blog we found it on.\n\n` +
    `Clear the box and press OK to remove it.`,
    d.venue_url || ''
  );
  if (answer === null) return;               // cancelled

  const url = answer.trim();
  // The same rule the deals_venue_url_scheme constraint enforces, checked
  // here so a typo comes back as a sentence instead of a Postgres error.
  if (url && !/^https?:\/\//i.test(url)) {
    showMsg(msgEl, 'error', 'A venue link has to start with http:// or https://');
    return;
  }

  const { error } = await db.from('deals').update({ venue_url: url || null }).eq('id', id);
  if (error) {
    showMsg(msgEl, 'error', error.message);
    return;
  }
  showMsg(msgEl, 'success', url ? 'Venue link saved.' : 'Venue link removed.');
  setTimeout(() => (msgEl.style.display = 'none'), 2000);
  await loadAdminDeals();
}

async function setDealStatus(id, status) {
  const msgEl = document.getElementById('admin-msg');
  const { error } = await db.from('deals').update({ status }).eq('id', id);
  if (error) {
    showMsg(msgEl, 'error', error.message);
    return;
  }
  showMsg(msgEl, 'success', `Deal ${status}.`);
  setTimeout(() => (msgEl.style.display = 'none'), 2000);
  await loadAdminDeals();
}

async function updateAdminStats() {
  const [{ count: pending }, { count: approved }, { count: rejected }] = await Promise.all([
    db.from('deals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('deals').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    db.from('deals').select('id', { count: 'exact', head: true }).eq('status', 'rejected')
  ]);
  document.getElementById('stat-pending').textContent  = pending  ?? '—';
  document.getElementById('stat-approved').textContent = approved ?? '—';
  document.getElementById('stat-rejected').textContent = rejected ?? '—';
}

// ============================================================
// TO STAY OR NOT TO STAY — internal keep-or-drop verdicts
//
// Lives in its own table, not on `deals`: deals_public_read returns every
// column, so an opinion about a named venue would be readable from the public
// API even if it were never rendered. `deal_reviews` has one policy, founder
// only. Nothing here should ever reach the customer site.
//
// The question is "is this a real saving", NOT "is this cheap". A $98 buffet
// honestly priced at $98 passes; a headline discount off a price nobody was
// ever charged fails. Affordability is what the price filters are for.
// ============================================================

let dealReviews = [];

async function loadReviews() {
  const { data, error } = await db.from('deal_reviews')
    .select('deal_id, verdict, headline, notes, real_cost, deals(title)');

  if (error) {
    document.getElementById('review-tbody').innerHTML =
      `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--red)">${escHtml(error.message)}</td></tr>`;
    return;
  }
  dealReviews = data || [];
  renderReviews();
}

function renderReviews() {
  const tbody  = document.getElementById('review-tbody');
  const filter = document.getElementById('review-filter').value;

  const flagged = dealReviews.filter(r => r.verdict === 'n').length;
  document.getElementById('review-summary').textContent =
    dealReviews.length ? `— ${flagged} of ${dealReviews.length} flagged` : '';

  // Flagged first, then by title. Sorted here rather than in the query so the
  // order is guaranteed by whatever renders it.
  const rows = dealReviews
    .filter(r => filter === 'all' || r.verdict === filter)
    .sort((a, b) => a.verdict.localeCompare(b.verdict)
                 || (a.deals?.title || '').localeCompare(b.deals?.title || ''));

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--muted)">Nothing in this view.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const no  = r.verdict === 'n';
    const pill = no ? 'status-expired' : 'status-active';
    return `<tr>
      <td><button class="btn-sm-outline" style="padding:2px 8px;font-size:14px;line-height:1.2"
            aria-expanded="false" onclick="toggleReview(this,'${r.deal_id}')">+</button></td>
      <td style="font-weight:600;max-width:260px">${escHtml(r.deals?.title || '—')}</td>
      <td><span class="status-pill ${pill}">${no ? 'N' : 'Y'}</span></td>
      <td style="color:var(--muted);font-size:13px">${escHtml(r.real_cost || '—')}</td>
    </tr>
    <tr id="rv-${r.deal_id}" style="display:none">
      <td></td>
      <td colspan="3" style="padding-bottom:18px">
        <div style="font-weight:700;margin-bottom:6px">${escHtml(r.headline)}</div>
        <div style="color:var(--muted);font-size:13px;line-height:1.6;max-width:70ch">${escHtml(r.notes)}</div>
      </td>
    </tr>`;
  }).join('');
}

function toggleReview(btn, dealId) {
  const row  = document.getElementById('rv-' + dealId);
  const open = row.style.display === 'none';
  row.style.display = open ? 'table-row' : 'none';
  btn.textContent = open ? '−' : '+';
  btn.setAttribute('aria-expanded', String(open));
}

// ============================================================
// EXPIRY TRACKER
//
// Nothing on the server retires a deal: the read policies simply stop
// returning it once end_date passes (in Singapore time). That is the right
// design — the row keeps its data and a renewed deal only needs a new date —
// but it means the catalogue shrinks silently. This panel is the warning.
// ============================================================

// How much notice counts as urgent. Two weeks rather than one: renewing a deal
// means getting an answer out of a venue, and a week doesn't leave room for
// that. Six deals sharing a 30 Sep end date would all have read as fine on a
// 7-day band, which is the exact situation this panel exists to catch.
const WARN_DAYS = 14;

// Duplicated from supplier.js on purpose: admin.html doesn't load that file,
// and the two pages must agree on what "today" is. 'en-CA' formats as
// YYYY-MM-DD, which compares correctly as a plain string against a date column.
function sgToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
}

// Whole days between two YYYY-MM-DD strings. Both are read as UTC midnight so
// a DST shift in the viewer's zone can't turn 7 days into 6.
function daysUntil(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

function addDays(iso, days) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  // Clamp to the target month's length: 31 Jan + 1 month is 28 Feb, not 3 Mar.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

async function loadExpiring() {
  const { data, error } = await db.from('deals')
    .select('id, title, region, end_date, ongoing')
    .eq('status', 'approved')
    .not('end_date', 'is', null)
    .order('end_date', { ascending: true });

  if (error) {
    document.getElementById('expiry-tbody').innerHTML =
      `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--red)">${escHtml(error.message)}</td></tr>`;
    return;
  }

  // `ongoing` is filtered here rather than in the query so that a NULL counts
  // as "not ongoing" — .eq('ongoing', false) would drop those rows silently.
  expiringDeals = (data || []).filter(d => !d.ongoing);
  renderExpiring();
}

function renderExpiring() {
  const tbody = document.getElementById('expiry-tbody');
  const today = sgToday();
  const limit = addDays(today, Number(document.getElementById('expiry-window').value));

  // No lower bound: deals that already lapsed belong at the top of this list.
  // They're invisible on the live site and are the likeliest to just need a
  // new date, so they're the most valuable rows here — not noise to hide.
  // Sorted here rather than trusting the query's ORDER BY: soonest-first is
  // the whole point of the list, so the function that renders it should be the
  // one guaranteeing it. ISO dates compare correctly as strings.
  const rows = expiringDeals
    .filter(d => d.end_date <= limit)
    .sort((a, b) => a.end_date.localeCompare(b.end_date));

  document.getElementById('stat-lapsed').textContent =
    expiringDeals.filter(d => d.end_date < today).length;
  document.getElementById('stat-expiring').textContent =
    expiringDeals.filter(d => d.end_date >= today && daysUntil(today, d.end_date) <= WARN_DAYS).length;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--muted)">Nothing expiring in this window.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(d => {
    const n = daysUntil(today, d.end_date);
    const whenTxt = n < 0 ? `Lapsed ${-n}d ago` : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`;
    const whenCls = n < 0 ? 'status-expired' : n <= WARN_DAYS ? 'approval-pending' : 'status-active';

    return `<tr>
      <td style="font-weight:600;max-width:220px">${escHtml(d.title)}</td>
      <td style="color:var(--muted)">${escHtml(d.region || '—')}</td>
      <td style="color:var(--muted);font-size:13px;white-space:nowrap">${escHtml(d.end_date)}</td>
      <td style="white-space:nowrap"><span class="status-pill ${whenCls}">${whenTxt}</span></td>
      <td>
        <div class="td-actions">
          <button class="btn-sm-outline" onclick="extendDeal('${d.id}',1)">+1 mo</button>
          <button class="btn-sm-outline" onclick="extendDeal('${d.id}',3)">+3 mo</button>
          <button class="btn-sm-outline" onclick="markOngoing('${d.id}')">Ongoing</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function extendDeal(id, months) {
  const msgEl = document.getElementById('expiry-msg');
  const deal  = expiringDeals.find(x => x.id === id);
  if (!deal) return;

  // Count forward from today when the deal has already lapsed, otherwise from
  // its current end date. Adding a month to a date three weeks gone would
  // produce a "new" end date still in the past.
  const today = sgToday();
  const base  = deal.end_date > today ? deal.end_date : today;
  const next  = addMonths(base, months);

  const { error } = await db.from('deals').update({ end_date: next }).eq('id', id);
  if (error) {
    showMsg(msgEl, 'error', error.message);
    return;
  }
  showMsg(msgEl, 'success', `"${deal.title}" now runs to ${next}.`);
  setTimeout(() => (msgEl.style.display = 'none'), 3000);
  await loadExpiring();
}

async function markOngoing(id) {
  const msgEl = document.getElementById('expiry-msg');
  const deal  = expiringDeals.find(x => x.id === id);
  if (!deal) return;
  if (!confirm(`Mark "${deal.title}" as ongoing?\n\nIt will stop expiring and drop off this list. Its end date will be cleared.`)) return;

  // end_date is cleared alongside the flag to match what the supplier form
  // saves (supplier.js sets end_date to null whenever Ongoing is ticked),
  // so the two write paths can't leave the row in disagreeing states.
  const { error } = await db.from('deals').update({ ongoing: true, end_date: null }).eq('id', id);
  if (error) {
    showMsg(msgEl, 'error', error.message);
    return;
  }
  showMsg(msgEl, 'success', `"${deal.title}" is now ongoing.`);
  setTimeout(() => (msgEl.style.display = 'none'), 3000);
  await loadExpiring();
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showMsg(el, type, text) {
  el.textContent = text;
  el.className   = `msg msg-${type === 'error' ? 'error' : 'success'}`;
  el.style.display = 'block';
}

initAdmin();
