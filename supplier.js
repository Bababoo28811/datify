// supplier.js — Supplier Dashboard Logic
// Depends on: supabase.js (db must be defined first)

// ============================================================
// AUTH GUARD — redirect if not logged in or not whitelisted
// ============================================================
async function initSupplierDashboard() {
  const { data: { session } } = await db.auth.getSession();

  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  // Check whitelist
  const { data, error } = await db
    .from('supplier_whitelist')
    .select('email, business_name')
    .eq('email', session.user.email)
    .single();

  if (error || !data) {
    // Valid Datify user but NOT a supplier — send them home
    window.location.href = 'index.html';
    return;
  }

  // Show user email in nav
  const navEl = document.getElementById('nav-user-email');
  if (navEl) navEl.textContent = session.user.email;

  // Load data
  await loadCategories();
  await loadMyDeals();
}

async function supplierLogout() {
  await db.auth.signOut();
  window.location.href = 'index.html';
}

// ============================================================
// CATEGORIES
// ============================================================
let categories = [];

async function loadCategories() {
  const { data } = await db
    .from('categories')
    .select('*')
    .order('name');

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

async function loadMyDeals() {
  const tbody = document.getElementById('deals-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">Loading…</td></tr>';

  const { data, error } = await db
    .from('deals')
    .select('*, categories(name)')
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--red)">${error.message}</td></tr>`;
    return;
  }

  allDeals = data || [];
  updateStats();

  if (allDeals.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">No deals yet — add your first one!</td></tr>';
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  tbody.innerHTML = allDeals.map(d => {
    const active     = d.ongoing || !d.end_date || d.end_date >= today;
    const statusCls  = active ? 'status-active' : 'status-expired';
    const statusTxt  = active ? 'Active' : 'Expired';
    const endsTxt    = d.ongoing ? 'Ongoing' : (d.end_date || '—');
    const thumb      = d.image_url
      ? `<div class="deal-thumb"><img src="${escHtml(d.image_url)}" alt=""></div>`
      : `<div class="deal-thumb">🎁</div>`;

    return `<tr>
      <td>${thumb}</td>
      <td style="font-weight:600;max-width:180px">${escHtml(d.title)}</td>
      <td style="color:var(--muted)">${escHtml(d.categories?.name || '—')}</td>
      <td>$${Number(d.price).toFixed(2)}</td>
      <td style="font-size:13px;color:var(--muted)">${escHtml(endsTxt)}</td>
      <td><span class="status-pill ${statusCls}">${statusTxt}</span></td>
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
  const today   = new Date().toISOString().split('T')[0];
  const active  = allDeals.filter(d => d.ongoing || !d.end_date || d.end_date >= today).length;
  const expired = allDeals.filter(d => !d.ongoing && d.end_date && d.end_date < today).length;
  document.getElementById('stat-active').textContent  = active;
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
  document.getElementById('f-start-date').value   = deal.start_date     || '';
  document.getElementById('f-end-date').value     = deal.end_date       || '';
  document.getElementById('f-ongoing').checked    = deal.ongoing        || false;
  document.getElementById('img-url-input').value  = deal.image_url      || '';

  if (deal.image_url) {
    const area    = document.getElementById('img-area');
    const preview = document.getElementById('img-preview');
    preview.src   = deal.image_url;
    area.classList.add('has-img');
  }

  toggleOngoing(document.getElementById('f-ongoing'));
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

    // Upload new image if one was selected
    let imageUrl = document.getElementById('img-url-input').value || null;
    const fileInput = document.getElementById('img-input');
    if (fileInput.files[0]) {
      imageUrl = await uploadImage(fileInput.files[0], session.user.id);
      if (!imageUrl) throw new Error('Image upload failed. Check your storage bucket.');
    }

    const ongoing = document.getElementById('f-ongoing').checked;

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
      start_date:     document.getElementById('f-start-date').value       || null,
      end_date:       ongoing ? null : (document.getElementById('f-end-date').value || null),
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

    showMsg(msgEl, 'success', editingId ? '✓ Deal updated!' : '✓ Deal added!');
    cancelEdit();
    await loadMyDeals();
    setTimeout(() => (msgEl.style.display = 'none'), 2500);

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
