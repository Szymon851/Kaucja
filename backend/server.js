const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

let users = [
  {
    id: 1,
    name: 'Jan Kowalski',
    phone: '500 600 700',
    defaultAddress: 'ul. Zielona 12, Warszawa',
    balance: 0
  }
];

// status: Pending | Collected | Completed | Cancelled | Failed
let pickups = [];
let nextPickupId = 1;

const PRICE_PET = 0.5;
const PRICE_GLASS = 1.0;

function now() {
  return new Date().toISOString();
}

function toInt(value) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function getPickup(id) {
  return pickups.find(p => p.id === parseInt(id, 10));
}

function publicStats() {
  const completed = pickups.filter(p => p.status === 'Completed');
  return {
    total: pickups.length,
    pending: pickups.filter(p => p.status === 'Pending').length,
    collected: pickups.filter(p => p.status === 'Collected').length,
    completed: completed.length,
    cancelled: pickups.filter(p => p.status === 'Cancelled').length,
    failed: pickups.filter(p => p.status === 'Failed').length,
    totalPet: completed.reduce((sum, p) => sum + (p.pet || 0), 0),
    totalGlass: completed.reduce((sum, p) => sum + (p.glass || 0), 0),
    totalPaid: roundMoney(completed.reduce((sum, p) => sum + (p.amount || 0), 0))
  };
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Kaucja API działa',
    prices: { pet: PRICE_PET, glass: PRICE_GLASS },
    stats: publicStats()
  });
});

app.get('/api/stats', (req, res) => {
  res.json(publicStats());
});

app.get('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  res.json(user);
});

app.get('/api/pickups', (req, res) => {
  const status = req.query.status;
  const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;
  let result = pickups;

  if (status) result = result.filter(p => p.status === status);
  if (userId) result = result.filter(p => p.userId === userId);

  res.json(result);
});

app.get('/api/pickups/user/:userId', (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  res.json(pickups.filter(p => p.userId === userId));
});

app.post('/api/pickups', (req, res) => {
  const body = req.body || {};
  const userId = body.userId ? parseInt(body.userId, 10) : 1;
  const user = users.find(u => u.id === userId);

  if (!user) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  if (!body.address || !String(body.address).trim()) {
    return res.status(400).json({ error: 'Adres odbioru jest wymagany' });
  }
  if (!body.phone || !String(body.phone).trim()) {
    return res.status(400).json({ error: 'Telefon jest wymagany' });
  }

  const pickup = {
    id: nextPickupId++,
    userId,
    customerName: user.name,
    phone: String(body.phone).trim(),
    address: String(body.address).trim(),
    preferredDate: body.preferredDate || '',
    note: body.note ? String(body.note).trim() : '',
    status: 'Pending',
    createdAt: now(),
    updatedAt: now(),
    collectedAt: null,
    completedAt: null,
    cancelledAt: null,
    failedAt: null,
    courierNote: '',
    estimatedPet: toInt(body.estimatedPet),
    estimatedGlass: toInt(body.estimatedGlass),
    pet: 0,
    glass: 0,
    amount: 0
  };

  user.phone = pickup.phone;
  user.defaultAddress = pickup.address;
  pickups.push(pickup);
  res.status(201).json(pickup);
});

app.get('/api/pickups/pending', (req, res) => {
  res.json(pickups.filter(p => p.status === 'Pending'));
});

app.get('/api/pickups/collected', (req, res) => {
  res.json(pickups.filter(p => p.status === 'Collected'));
});

app.put('/api/pickups/:id/cancel', (req, res) => {
  const pickup = getPickup(req.params.id);
  if (!pickup) return res.status(404).json({ error: 'Zamówienie nie znalezione' });
  if (pickup.status !== 'Pending') {
    return res.status(400).json({ error: 'Można anulować tylko zamówienie oczekujące' });
  }

  pickup.status = 'Cancelled';
  pickup.cancelledAt = now();
  pickup.updatedAt = now();
  res.json(pickup);
});

app.put('/api/pickups/:id/collect', (req, res) => {
  const pickup = getPickup(req.params.id);
  if (!pickup) return res.status(404).json({ error: 'Zamówienie nie znalezione' });
  if (pickup.status !== 'Pending') {
    return res.status(400).json({ error: 'Zamówienie nie jest oczekujące' });
  }

  pickup.status = 'Collected';
  pickup.collectedAt = now();
  pickup.updatedAt = now();
  pickup.courierNote = req.body && req.body.courierNote ? String(req.body.courierNote).trim() : '';
  res.json(pickup);
});

app.put('/api/pickups/:id/fail', (req, res) => {
  const pickup = getPickup(req.params.id);
  if (!pickup) return res.status(404).json({ error: 'Zamówienie nie znalezione' });
  if (pickup.status !== 'Pending') {
    return res.status(400).json({ error: 'Jako nieudane można oznaczyć tylko zamówienie oczekujące' });
  }

  pickup.status = 'Failed';
  pickup.failedAt = now();
  pickup.updatedAt = now();
  pickup.courierNote = req.body && req.body.courierNote ? String(req.body.courierNote).trim() : 'Nieudany odbiór';
  res.json(pickup);
});

app.put('/api/pickups/:id/settle', (req, res) => {
  const pickup = getPickup(req.params.id);
  if (!pickup) return res.status(404).json({ error: 'Zamówienie nie znalezione' });
  if (pickup.status !== 'Collected') {
    return res.status(400).json({ error: 'Zamówienie nie jest odebrane' });
  }

  const pet = toInt(req.body && req.body.pet);
  const glass = toInt(req.body && req.body.glass);
  if (pet + glass <= 0) {
    return res.status(400).json({ error: 'Podaj ilość PET lub szkła większą od 0' });
  }

  const amount = roundMoney(pet * PRICE_PET + glass * PRICE_GLASS);

  pickup.pet = pet;
  pickup.glass = glass;
  pickup.amount = amount;
  pickup.status = 'Completed';
  pickup.completedAt = now();
  pickup.updatedAt = now();

  const user = users.find(u => u.id === pickup.userId);
  if (user) user.balance = roundMoney(user.balance + amount);

  res.json({ pickup, user, stats: publicStats() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serwer Kaucja działa na porcie ${PORT}`);
});
