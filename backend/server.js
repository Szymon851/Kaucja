const express = require('express');
const cors = require('cors');

const app = express();

// CORS ustawiony globalnie na '*' aby GitHub Pages mogło łączyć się z Renderem
app.use(cors({ origin: '*' }));
app.use(express.json());

// Dodatkowe, ręczne nagłówki CORS (na wszelki wypadek dla preflight)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============================================================
// BAZA DANYCH W PAMIĘCI RAM
// ============================================================
let users = [
  { id: 1, name: 'Jan Kowalski', balance: 0 }
];

// status: 'Pending' | 'Collected' | 'Completed'
let pickups = [];
let nextPickupId = 1;

// Ceny rozliczeniowe
const PRICE_PET = 0.5;   // 0.50 zł za sztukę
const PRICE_GLASS = 1.0; // 1.00 zł za sztukę

// ============================================================
// ENDPOINTY
// ============================================================

// --- Stan serwera (health check dla Render) ---
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Kaucja API działa' });
});

// --- KLIENT: pobierz dane użytkownika (saldo) ---
app.get('/api/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = users.find(u => u.id === id);
  if (!user) {
    return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  }
  res.json(user);
});

// --- KLIENT: pobierz wszystkie zamówienia użytkownika ---
app.get('/api/pickups/user/:userId', (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const userPickups = pickups.filter(p => p.userId === userId);
  res.json(userPickups);
});

// --- KLIENT: zamów kuriera (utwórz nowe zamówienie) ---
app.post('/api/pickups', (req, res) => {
  const userId = req.body && req.body.userId ? parseInt(req.body.userId, 10) : 1;
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  }

  const pickup = {
    id: nextPickupId++,
    userId: userId,
    status: 'Pending',
    createdAt: new Date().toISOString(),
    pet: 0,
    glass: 0,
    amount: 0
  };
  pickups.push(pickup);
  res.status(201).json(pickup);
});

// --- KURIER: pobierz zamówienia oczekujące ---
app.get('/api/pickups/pending', (req, res) => {
  res.json(pickups.filter(p => p.status === 'Pending'));
});

// --- KURIER: oznacz jako odebrane ---
app.put('/api/pickups/:id/collect', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pickup = pickups.find(p => p.id === id);
  if (!pickup) {
    return res.status(404).json({ error: 'Zamówienie nie znalezione' });
  }
  if (pickup.status !== 'Pending') {
    return res.status(400).json({ error: 'Zamówienie nie jest oczekujące' });
  }
  pickup.status = 'Collected';
  pickup.collectedAt = new Date().toISOString();
  res.json(pickup);
});

// --- ADMIN: pobierz zamówienia odebrane (do rozliczenia) ---
app.get('/api/pickups/collected', (req, res) => {
  res.json(pickups.filter(p => p.status === 'Collected'));
});

// --- ADMIN: rozlicz zamówienie ---
app.put('/api/pickups/:id/settle', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pickup = pickups.find(p => p.id === id);
  if (!pickup) {
    return res.status(404).json({ error: 'Zamówienie nie znalezione' });
  }
  if (pickup.status !== 'Collected') {
    return res.status(400).json({ error: 'Zamówienie nie jest odebrane' });
  }

  const pet = req.body && req.body.pet ? parseInt(req.body.pet, 10) : 0;
  const glass = req.body && req.body.glass ? parseInt(req.body.glass, 10) : 0;

  const amount = pet * PRICE_PET + glass * PRICE_GLASS;

  pickup.pet = pet;
  pickup.glass = glass;
  pickup.amount = amount;
  pickup.status = 'Completed';
  pickup.completedAt = new Date().toISOString();

  const user = users.find(u => u.id === pickup.userId);
  if (user) {
    user.balance = Math.round((user.balance + amount) * 100) / 100;
  }

  res.json({ pickup, user });
});

// ============================================================
// START SERWERA
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serwer Kaucja działa na porcie ${PORT}`);
});
