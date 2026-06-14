// ============================================================
// KONFIGURACJA - podmień na adres swojego backendu na Render.com
// ============================================================
const API_URL = 'https://twoj-backend.onrender.com';

// Stały klient (MVP) - user id: 1
const CURRENT_USER_ID = 1;

// Auto-odświeżanie aktywnego widoku co X ms
const REFRESH_INTERVAL = 5000;
let refreshTimer = null;
let currentView = 'home';

// ============================================================
// POMOCNICZE
// ============================================================
function fmtMoney(value) {
  const n = Number(value) || 0;
  return n.toFixed(2) + ' zł';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('pl-PL');
}

function statusLabel(status) {
  switch (status) {
    case 'Pending': return { text: 'Oczekujące', cls: 'badge-pending' };
    case 'Collected': return { text: 'Odebrane', cls: 'badge-collected' };
    case 'Completed': return { text: 'Zakończone', cls: 'badge-completed' };
    default: return { text: status, cls: '' };
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 2800);
}

async function apiFetch(path, options) {
  const res = await fetch(API_URL + path, options);
  if (!res.ok) {
    let msg = 'Błąd serwera (' + res.status + ')';
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

// ============================================================
// NAWIGACJA (SPA)
// ============================================================
function showView(view) {
  currentView = view;

  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById('view-' + view);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  loadView(view);
  startAutoRefresh();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (currentView === 'home') return;
  refreshTimer = setInterval(() => loadView(currentView), REFRESH_INTERVAL);
}

function loadView(view) {
  if (view === 'client') loadClient();
  else if (view === 'courier') loadCourier();
  else if (view === 'admin') loadAdmin();
}

// ============================================================
// WIDOK KLIENTA
// ============================================================
async function loadClient() {
  try {
    const user = await apiFetch('/api/users/' + CURRENT_USER_ID);
    document.getElementById('clientBalance').textContent = fmtMoney(user.balance);
  } catch (e) {
    document.getElementById('clientBalance').textContent = '— zł';
  }

  try {
    const orders = await apiFetch('/api/pickups/user/' + CURRENT_USER_ID);
    renderClientOrders(orders);
  } catch (e) {
    document.getElementById('clientOrders').innerHTML =
      '<p class="empty">Nie udało się pobrać zamówień.</p>';
  }
}

function renderClientOrders(orders) {
  const container = document.getElementById('clientOrders');
  if (!orders || orders.length === 0) {
    container.innerHTML = '<p class="empty">Brak zamówień.</p>';
    return;
  }

  orders.sort((a, b) => b.id - a.id);
  container.innerHTML = orders.map(o => {
    const s = statusLabel(o.status);
    const settled = o.status === 'Completed'
      ? `<div class="order-meta">PET: ${o.pet} · Szkło: ${o.glass} · Kwota: ${fmtMoney(o.amount)}</div>`
      : '';
    return `
      <div class="order-card">
        <div class="order-head">
          <span class="order-id">Zamówienie #${o.id}</span>
          <span class="badge ${s.cls}">${s.text}</span>
        </div>
        <div class="order-date">Utworzono: ${fmtDate(o.createdAt)}</div>
        ${settled}
      </div>`;
  }).join('');
}

async function orderCourier() {
  const btn = document.getElementById('orderCourierBtn');
  btn.disabled = true;
  try {
    await apiFetch('/api/pickups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: CURRENT_USER_ID })
    });
    showToast('Zamówiono kuriera!');
    loadClient();
  } catch (e) {
    showToast(e.message);
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// WIDOK KURIERA
// ============================================================
async function loadCourier() {
  try {
    const orders = await apiFetch('/api/pickups/pending');
    renderCourierOrders(orders);
  } catch (e) {
    document.getElementById('courierOrders').innerHTML =
      '<p class="empty">Nie udało się pobrać zamówień.</p>';
  }
}

function renderCourierOrders(orders) {
  const container = document.getElementById('courierOrders');
  if (!orders || orders.length === 0) {
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
        <div class="order-date">Klient ID: ${o.userId} · ${fmtDate(o.createdAt)}</div>
        <button class="btn btn-success" onclick="collectOrder(${o.id})">✓ Odebrano</button>
      </div>`;
  }).join('');
}

async function collectOrder(id) {
  try {
    await apiFetch('/api/pickups/' + id + '/collect', { method: 'PUT' });
    showToast('Oznaczono jako odebrane');
    loadCourier();
  } catch (e) {
    showToast(e.message);
  }
}

// ============================================================
// WIDOK ADMINA / MAGAZYNU
// ============================================================
async function loadAdmin() {
  try {
    const orders = await apiFetch('/api/pickups/collected');
    renderAdminOrders(orders);
  } catch (e) {
    document.getElementById('adminOrders').innerHTML =
      '<p class="empty">Nie udało się pobrać zamówień.</p>';
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
        <div class="order-date">Klient ID: ${o.userId} · ${fmtDate(o.collectedAt)}</div>
        <div class="settle-form">
          <div class="field">
            <label>Ilość PET (0.50 zł)</label>
            <input type="number" min="0" value="0" id="pet-${o.id}" />
          </div>
          <div class="field">
            <label>Ilość Szkła (1.00 zł)</label>
            <input type="number" min="0" value="0" id="glass-${o.id}" />
          </div>
          <button class="btn btn-warn" onclick="settleOrder(${o.id})">💰 Rozlicz</button>
        </div>
      </div>`;
  }).join('');
}

async function settleOrder(id) {
  const pet = parseInt(document.getElementById('pet-' + id).value, 10) || 0;
  const glass = parseInt(document.getElementById('glass-' + id).value, 10) || 0;
  try {
    const result = await apiFetch('/api/pickups/' + id + '/settle', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pet, glass })
    });
    const amount = result && result.pickup ? result.pickup.amount : 0;
    showToast('Rozliczono: ' + fmtMoney(amount) + ' dodano do salda');
    loadAdmin();
  } catch (e) {
    showToast(e.message);
  }
}

// ============================================================
// INICJALIZACJA
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => showView(el.dataset.view));
  });

  document.getElementById('logoHome').addEventListener('click', () => showView('home'));
  document.getElementById('orderCourierBtn').addEventListener('click', orderCourier);

  showView('home');
});
