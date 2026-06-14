// ============================================================
// KONFIGURACJA
// ============================================================
const API_URL = 'https://kaucja-backend.onrender.com';
const CURRENT_USER_ID = 1;
const REFRESH_INTERVAL = 8000;

let refreshTimer = null;
let currentView = 'home';
let clientOrdersCache = [];
let courierOrdersCache = [];
let completedOrdersCache = [];

// ============================================================
// POMOCNICZE
// ============================================================
function fmtMoney(value) {
  const n = Number(value) || 0;
  return n.toFixed(2) + ' zł';
}

function fmtDate(iso) {
  if (!iso) return 'brak terminu';
  return new Date(iso).toLocaleString('pl-PL');
}

function esc(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusLabel(status) {
  switch (status) {
    case 'Pending': return { text: 'Oczekujące', cls: 'badge-pending' };
    case 'Collected': return { text: 'Odebrane', cls: 'badge-collected' };
    case 'Completed': return { text: 'Zakończone', cls: 'badge-completed' };
    case 'Cancelled': return { text: 'Anulowane', cls: 'badge-cancelled' };
    case 'Failed': return { text: 'Nieudane', cls: 'badge-failed' };
    default: return { text: status || 'Nieznany', cls: '' };
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Pojedyncza próba żądania z limitem czasu (AbortController)
async function singleFetch(path, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL + path, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    if (!res.ok) {
      let msg = 'Błąd serwera (' + res.status + ')';
      try {
        const data = await res.json();
        if (data && data.error) msg = data.error;
      } catch (e) { /* odpowiedź nie jest JSON-em */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }

    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Żądania GET są bezpieczne do ponawiania - obsługa zimnego startu Render.
// Żądań zmieniających dane (POST/PUT) NIE ponawiamy, by uniknąć duplikatów.
async function apiFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const maxAttempts = method === 'GET' ? 4 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await singleFetch(path, options, 65000);
      setConnecting(false);
      return result;
    } catch (e) {
      const isServerWaking = e.name === 'AbortError' || !e.status || e.status >= 500;
      if (attempt < maxAttempts && isServerWaking) {
        setConnecting(true);
        await sleep(attempt * 2500);
        continue;
      }
      setConnecting(false);
      throw e;
    }
  }
}

let connecting = false;
function setConnecting(state) {
  if (connecting === state) return;
  connecting = state;
  const el = document.getElementById('apiStatus');
  if (!el) return;
  if (state) {
    el.textContent = 'Łączę z serwerem (do ~1 min przy pierwszym uruchomieniu)...';
    el.className = 'api-status';
  }
}

function mapsUrl(address) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address || '');
}

function countByStatus(orders, status) {
  return orders.filter(o => o.status === status).length;
}

function orderCardDetails(o) {
  return `
    <div class="order-grid">
      <div><strong>Klient:</strong> ${esc(o.customerName || 'Klient #' + o.userId)}</div>
      <div><strong>Telefon:</strong> <a href="tel:${esc(o.phone)}">${esc(o.phone || 'brak')}</a></div>
      <div><strong>Adres:</strong> ${esc(o.address || 'brak')}</div>
      <div><strong>Termin:</strong> ${fmtDate(o.preferredDate)}</div>
      <div><strong>Szacunek:</strong> PET ${o.estimatedPet || 0}, szkło ${o.estimatedGlass || 0}</div>
      <div><strong>Utworzono:</strong> ${fmtDate(o.createdAt)}</div>
    </div>
    ${o.note ? `<div class="order-meta"><strong>Notatka:</strong> ${esc(o.note)}</div>` : ''}
    ${o.courierNote ? `<div class="order-meta"><strong>Notatka kuriera:</strong> ${esc(o.courierNote)}</div>` : ''}
  `;
}

// ============================================================
// NAWIGACJA
// ============================================================
function showView(view) {
  currentView = view;

  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  loadView(view);
  startAutoRefresh();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.hidden) return;
    loadView(currentView);
  }, REFRESH_INTERVAL);
}

function loadView(view) {
  if (view === 'home') loadHome();
  if (view === 'client') loadClient();
  if (view === 'courier') loadCourier();
  if (view === 'admin') loadAdmin();
}

// ============================================================
// HOME
// ============================================================
async function loadHome() {
  await checkApiStatus();
  await loadStats('homeStats');
}

async function checkApiStatus() {
  const el = document.getElementById('apiStatus');
  try {
    await apiFetch('/');
    el.textContent = 'API online';
    el.className = 'api-status online';
  } catch (e) {
    el.textContent = 'API offline';
    el.className = 'api-status offline';
  }
}

async function loadStats(targetId) {
  try {
    const s = await apiFetch('/api/stats');
    const target = document.getElementById(targetId);
    if (!target) return;

    if (targetId === 'adminStats') {
      target.innerHTML = `
        <div class="stat-card"><span>Do rozliczenia</span><strong>${s.collected}</strong></div>
        <div class="stat-card"><span>Zakończone</span><strong>${s.completed}</strong></div>
        <div class="stat-card"><span>PET</span><strong>${s.totalPet}</strong></div>
        <div class="stat-card"><span>Szkło</span><strong>${s.totalGlass}</strong></div>`;
      return;
    }

    target.innerHTML = `
      <div class="stat-card"><span>Oczekujące</span><strong>${s.pending}</strong></div>
      <div class="stat-card"><span>Odebrane</span><strong>${s.collected}</strong></div>
      <div class="stat-card"><span>Zakończone</span><strong>${s.completed}</strong></div>
      <div class="stat-card"><span>Wypłacono</span><strong>${fmtMoney(s.totalPaid)}</strong></div>`;
  } catch (e) {
    showToast('Nie udało się pobrać statystyk');
  }
}

// ============================================================
// KLIENT
// ============================================================
async function loadClient() {
  try {
    const user = await apiFetch('/api/users/' + CURRENT_USER_ID);
    document.getElementById('clientBalance').textContent = fmtMoney(user.balance);

    const address = document.getElementById('pickupAddress');
    const phone = document.getElementById('pickupPhone');
    if (!address.value) address.value = user.defaultAddress || '';
    if (!phone.value) phone.value = user.phone || '';
  } catch (e) {
    document.getElementById('clientBalance').textContent = '— zł';
  }

  try {
    clientOrdersCache = await apiFetch('/api/pickups/user/' + CURRENT_USER_ID);
    renderClientOrders();
  } catch (e) {
    document.getElementById('clientOrders').innerHTML = '<p class="empty">Nie udało się pobrać zamówień.</p>';
  }
}

function renderClientOrders() {
  const container = document.getElementById('clientOrders');
  const filter = document.getElementById('clientStatusFilter').value;
  let orders = [...clientOrdersCache];
  if (filter !== 'all') orders = orders.filter(o => o.status === filter);

  document.getElementById('clientSummary').textContent =
    `Zamówienia: ${clientOrdersCache.length}, oczekujące: ${countByStatus(clientOrdersCache, 'Pending')}, zakończone: ${countByStatus(clientOrdersCache, 'Completed')}`;

  if (orders.length === 0) {
    container.innerHTML = '<p class="empty">Brak zamówień dla wybranego filtra.</p>';
    return;
  }

  orders.sort((a, b) => b.id - a.id);
  container.innerHTML = orders.map(o => {
    const s = statusLabel(o.status);
    const settled = o.status === 'Completed'
      ? `<div class="order-meta"><strong>Rozliczenie:</strong> PET ${o.pet}, szkło ${o.glass}, kwota ${fmtMoney(o.amount)}</div>`
      : '';
    const actions = o.status === 'Pending'
      ? `<div class="order-actions"><button class="btn btn-danger btn-small" onclick="cancelOrder(${o.id})">Anuluj zamówienie</button></div>`
      : '';

    return `
      <div class="order-card">
        <div class="order-head">
          <span class="order-id">Zamówienie #${o.id}</span>
          <span class="badge ${s.cls}">${s.text}</span>
        </div>
        ${orderCardDetails(o)}
        ${settled}
        ${actions}
      </div>`;
  }).join('');
}

async function createPickup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    await apiFetch('/api/pickups', {
      method: 'POST',
      body: JSON.stringify({
        userId: CURRENT_USER_ID,
        address: document.getElementById('pickupAddress').value,
        phone: document.getElementById('pickupPhone').value,
        preferredDate: document.getElementById('pickupDate').value,
        estimatedPet: document.getElementById('estimatedPet').value,
        estimatedGlass: document.getElementById('estimatedGlass').value,
        note: document.getElementById('pickupNote').value
      })
    });

    document.getElementById('estimatedPet').value = 0;
    document.getElementById('estimatedGlass').value = 0;
    document.getElementById('pickupNote').value = '';
    showToast('Zamówiono kuriera');
    loadClient();
  } catch (e) {
    showToast(e.message);
  } finally {
    btn.disabled = false;
  }
}

async function cancelOrder(id) {
  try {
    await apiFetch('/api/pickups/' + id + '/cancel', { method: 'PUT' });
    showToast('Zamówienie anulowane');
    loadClient();
  } catch (e) {
    showToast(e.message);
  }
}

// ============================================================
// KURIER
// ============================================================
async function loadCourier() {
  try {
    courierOrdersCache = await apiFetch('/api/pickups/pending');
    renderCourierOrders();
  } catch (e) {
    document.getElementById('courierOrders').innerHTML = '<p class="empty">Nie udało się pobrać zamówień.</p>';
  }
}

function renderCourierOrders() {
  const container = document.getElementById('courierOrders');
  const q = document.getElementById('courierSearch').value.toLowerCase().trim();
  let orders = [...courierOrdersCache];
  if (q) {
    orders = orders.filter(o =>
      String(o.id).includes(q) ||
      String(o.address || '').toLowerCase().includes(q) ||
      String(o.phone || '').toLowerCase().includes(q)
    );
  }

  document.getElementById('courierCount').textContent = `${orders.length} zleceń`;

  if (orders.length === 0) {
    container.innerHTML = '<p class="empty">Brak oczekujących zamówień.</p>';
    return;
  }

  orders.sort((a, b) => a.id - b.id);
  container.innerHTML = orders.map(o => {
    const s = statusLabel(o.status);
    return `
      <div class="order-card">
        <div class="order-head">
          <span class="order-id">Zamówienie #${o.id}</span>
          <span class="badge ${s.cls}">${s.text}</span>
        </div>
        ${orderCardDetails(o)}
        <div class="order-actions">
          <a class="btn btn-light btn-small" href="${mapsUrl(o.address)}" target="_blank" rel="noopener">Mapa</a>
          <a class="btn btn-light btn-small" href="tel:${esc(o.phone)}">Zadzwoń</a>
          <button class="btn btn-success btn-small" onclick="collectOrder(${o.id})">Odebrano</button>
          <button class="btn btn-danger btn-small" onclick="failOrder(${o.id})">Nieudany odbiór</button>
        </div>
      </div>`;
  }).join('');
}

async function collectOrder(id) {
  const courierNote = prompt('Notatka kuriera (opcjonalnie):') || '';
  try {
    await apiFetch('/api/pickups/' + id + '/collect', {
      method: 'PUT',
      body: JSON.stringify({ courierNote })
    });
    showToast('Oznaczono jako odebrane');
    loadCourier();
  } catch (e) {
    showToast(e.message);
  }
}

async function failOrder(id) {
  const courierNote = prompt('Powód nieudanego odbioru:', 'Klient nieobecny') || 'Nieudany odbiór';
  try {
    await apiFetch('/api/pickups/' + id + '/fail', {
      method: 'PUT',
      body: JSON.stringify({ courierNote })
    });
    showToast('Oznaczono jako nieudane');
    loadCourier();
  } catch (e) {
    showToast(e.message);
  }
}

// ============================================================
// ADMIN
// ============================================================
async function loadAdmin() {
  await loadStats('adminStats');

  try {
    const collected = await apiFetch('/api/pickups/collected');
    renderAdminOrders(collected);
  } catch (e) {
    document.getElementById('adminOrders').innerHTML = '<p class="empty">Nie udało się pobrać zamówień.</p>';
  }

  try {
    completedOrdersCache = await apiFetch('/api/pickups?status=Completed');
    renderCompletedOrders();
  } catch (e) {
    document.getElementById('completedOrders').innerHTML = '<p class="empty">Nie udało się pobrać historii.</p>';
  }
}

function renderAdminOrders(orders) {
  const container = document.getElementById('adminOrders');
  if (!orders || orders.length === 0) {
    container.innerHTML = '<p class="empty">Brak zamówień do rozliczenia.</p>';
    return;
  }

  orders.sort((a, b) => a.id - b.id);
  container.innerHTML = orders.map(o => {
    const s = statusLabel(o.status);
    return `
      <div class="order-card">
        <div class="order-head">
          <span class="order-id">Zamówienie #${o.id}</span>
          <span class="badge ${s.cls}">${s.text}</span>
        </div>
        ${orderCardDetails(o)}
        <div class="settle-form">
          <div class="field">
            <label>Ilość PET (0.50 zł)</label>
            <input type="number" min="0" value="${o.estimatedPet || 0}" id="pet-${o.id}" />
          </div>
          <div class="field">
            <label>Ilość szkła (1.00 zł)</label>
            <input type="number" min="0" value="${o.estimatedGlass || 0}" id="glass-${o.id}" />
          </div>
          <button class="btn btn-warn" onclick="settleOrder(${o.id})">Rozlicz</button>
        </div>
      </div>`;
  }).join('');
}

function renderCompletedOrders() {
  const container = document.getElementById('completedOrders');
  const q = document.getElementById('adminHistorySearch').value.toLowerCase().trim();
  let orders = [...completedOrdersCache];

  if (q) {
    orders = orders.filter(o =>
      String(o.id).includes(q) ||
      String(o.address || '').toLowerCase().includes(q) ||
      String(o.phone || '').toLowerCase().includes(q)
    );
  }

  if (orders.length === 0) {
    container.innerHTML = '<p class="empty">Brak zakończonych zamówień.</p>';
    return;
  }

  orders.sort((a, b) => b.id - a.id);
  container.innerHTML = orders.map(o => `
    <div class="order-card">
      <div class="order-head">
        <span class="order-id">Zamówienie #${o.id}</span>
        <span class="badge badge-completed">${fmtMoney(o.amount)}</span>
      </div>
      <div class="order-grid">
        <div><strong>Adres:</strong> ${esc(o.address)}</div>
        <div><strong>Telefon:</strong> ${esc(o.phone)}</div>
        <div><strong>PET:</strong> ${o.pet}</div>
        <div><strong>Szkło:</strong> ${o.glass}</div>
        <div><strong>Zakończono:</strong> ${fmtDate(o.completedAt)}</div>
      </div>
    </div>`).join('');
}

async function settleOrder(id) {
  const pet = parseInt(document.getElementById('pet-' + id).value, 10) || 0;
  const glass = parseInt(document.getElementById('glass-' + id).value, 10) || 0;
  try {
    const result = await apiFetch('/api/pickups/' + id + '/settle', {
      method: 'PUT',
      body: JSON.stringify({ pet, glass })
    });
    showToast('Rozliczono: ' + fmtMoney(result.pickup.amount));
    loadAdmin();
  } catch (e) {
    showToast(e.message);
  }
}

function exportCompletedCsv() {
  if (!completedOrdersCache.length) {
    showToast('Brak danych do eksportu');
    return;
  }

  const header = ['id', 'telefon', 'adres', 'pet', 'szklo', 'kwota', 'data_zakonczenia'];
  const rows = completedOrdersCache.map(o => [
    o.id,
    o.phone || '',
    o.address || '',
    o.pet || 0,
    o.glass || 0,
    o.amount || 0,
    o.completedAt || ''
  ]);

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kaucja-rozliczenia.csv';
  link.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// INICJALIZACJA
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => showView(el.dataset.view));
  });

  document.getElementById('logoHome').addEventListener('click', () => showView('home'));
  document.getElementById('pickupForm').addEventListener('submit', createPickup);
  document.getElementById('clientStatusFilter').addEventListener('change', renderClientOrders);
  document.getElementById('courierSearch').addEventListener('input', renderCourierOrders);
  document.getElementById('adminHistorySearch').addEventListener('input', renderCompletedOrders);
  document.getElementById('exportCsvBtn').addEventListener('click', exportCompletedCsv);
  document.getElementById('refreshClientBtn').addEventListener('click', loadClient);
  document.getElementById('refreshCourierBtn').addEventListener('click', loadCourier);
  document.getElementById('refreshAdminBtn').addEventListener('click', loadAdmin);

  showView('home');
});
