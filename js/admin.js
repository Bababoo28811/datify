// admin.js — Deal approval queue. Restricted to the founder account;
// RLS on the `deals` table is the real enforcement (deals_admin_update
// policy checks the JWT email server-side) — this client-side check is
// just to redirect non-admins away before they see an empty/broken page.
const ADMIN_EMAIL = 'elisazhu.ys@gmail.com';

let adminDeals = [];

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
    await loadAdminDeals();
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
