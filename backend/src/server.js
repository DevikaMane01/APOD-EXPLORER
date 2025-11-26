// backend/src/server.js
// Minimal, robust Express server for NASA APOD Explorer
// - In-memory LRU cache with TTL + max size
// - REST endpoints: /api/apod/today, /api/apod?date=YYYY-MM-DD, /api/apod/recent?count=10, /api/health
// - Serve static frontend from ../public
// - Reads NASA_API_KEY from process.env (use .env via dotenv)

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();

// ---------- Configuration ----------
const PORT = Number(process.env.PORT) || 5000;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

// Cache configuration — tune these values as needed
const CACHE_MAX_ITEMS = Number(process.env.CACHE_MAX_ITEMS) || 200; // max number entries
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 1000 * 60 * 60 * 24; // 24 hours

// ---------- Simple In-memory LRU Cache with TTL ----------
class LruTtlCache {
  constructor({ max = 200, ttl = 24 * 60 * 60 * 1000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    // Map preserves insertion order. We'll treat the end as most-recently-used.
    this.map = new Map(); // key => { value, expiresAt }
  }

  _isExpired(entry) {
    return !entry || (entry.expiresAt && Date.now() > entry.expiresAt);
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) {
      this.map.delete(key);
      return undefined;
    }
    // mark as recently used: delete and re-set to move to end
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    // if already exists remove to update ordering
    if (this.map.has(key)) this.map.delete(key);

    const expiresAt = this.ttl > 0 ? Date.now() + this.ttl : null;
    this.map.set(key, { value, expiresAt });

    // evict oldest while over capacity
    while (this.map.size > this.max) {
      // oldest item is first key
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }

  has(key) {
    return this.get(key) !== undefined; // get moves to MRU
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  size() {
    // remove expired entries lazily
    for (const [k, entry] of Array.from(this.map.entries())) {
      if (this._isExpired(entry)) this.map.delete(k);
    }
    return this.map.size;
  }

  keys() {
    return Array.from(this.map.keys());
  }
}

const cache = new LruTtlCache({ max: CACHE_MAX_ITEMS, ttl: CACHE_TTL_MS });

// ---------- Helpers ----------
function simplifyApod(data) {
  // keep fields useful to UI
  return {
    date: data.date,
    title: data.title,
    media_type: data.media_type,
    url: data.url,
    hdurl: data.hdurl || null,
    explanation: data.explanation,
    copyright: data.copyright || null,
    service_version: data.service_version || null,
  };
}

async function callNasa(params = {}) {
  const endpoint = 'https://api.nasa.gov/planetary/apod';
  const q = { api_key: NASA_API_KEY, ...params };
  try {
    const resp = await axios.get(endpoint, { params: q, timeout: 10000 });
    return resp.data;
  } catch (err) {
    // surface clear error messages
    if (err.response) {
      const status = err.response.status;
      const text = err.response.statusText || JSON.stringify(err.response.data);
      throw new Error(`NASA API responded ${status}: ${text}`);
    }
    throw new Error(`Failed to call NASA API: ${err.message}`);
  }
}

// Validate YYYY-MM-DD
function isValidDateString(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

// Serve static frontend from project/public
const publicPath = path.join(__dirname, '..', '..', 'public');
app.use(express.static(publicPath));

// ---------- REST Endpoints ----------

// Health endpoint
app.get('/api/health', (req, res) => {
  return res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cache: { entries: cache.size(), ttl_ms: CACHE_TTL_MS, max_items: CACHE_MAX_ITEMS },
    using_demo_key: NASA_API_KEY === 'DEMO_KEY',
  });
});

// GET /api/apod/today
app.get('/api/apod/today', async (req, res) => {
  const key = 'apod:today';
  try {
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    const data = await callNasa({});
    const simplified = simplifyApod(data);
    cache.set(key, simplified);
    return res.json(simplified);
  } catch (err) {
    console.error('GET /api/apod/today error:', err.message);
    return res.status(502).json({ error: 'Bad Gateway', message: err.message });
  }
});

// GET /api/apod?date=YYYY-MM-DD
app.get('/api/apod', async (req, res) => {
  const date = (req.query.date || '').trim();
  if (!date) return res.status(400).json({ error: 'Bad Request', message: 'Missing required query param: date=YYYY-MM-DD' });
  if (!isValidDateString(date)) return res.status(400).json({ error: 'Bad Request', message: 'Invalid date format. Use YYYY-MM-DD' });

  const key = `apod:date:${date}`;
  try {
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    const data = await callNasa({ date });
    const simplified = simplifyApod(data);
    cache.set(key, simplified);
    return res.json(simplified);
  } catch (err) {
    console.error(`GET /api/apod?date=${date} error:`, err.message);
    // If NASA returns 400 for too-old date, forward as 404/400 depending
    return res.status(502).json({ error: 'Bad Gateway', message: err.message });
  }
});

// GET /api/apod/recent?count=10
app.get('/api/apod/recent', async (req, res) => {
  const parsed = parseInt(req.query.count || '10', 10);
  if (Number.isNaN(parsed) || parsed <= 0) return res.status(400).json({ error: 'Bad Request', message: 'Invalid count. Must be a positive integer.' });

  // limit count to prevent large requests
  const count = Math.min(50, parsed);

  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const startDate = new Date(today.getTime() - (count - 1) * 86400000);
  const start = startDate.toISOString().slice(0, 10);

  const key = `apod:range:${start}:${end}`;

  try {
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    // NASA supports start_date & end_date (returns array)
    const data = await callNasa({ start_date: start, end_date: end });
    // ensure array (single-day returns object)
    const arr = Array.isArray(data) ? data : [data];
    // return newest first
    const list = arr.slice().reverse().map(simplifyApod);
    cache.set(key, list);
    return res.json(list);
  } catch (err) {
    console.error(`GET /api/apod/recent?count=${count} error:`, err.message);
    return res.status(502).json({ error: 'Bad Gateway', message: err.message });
  }
});

// Fallback for unknown API routes (clean 404 for /api/*)
app.use('/api', (req, res) => {
  return res.status(404).json({ error: 'Not Found', message: 'API route not found' });
});

// IMPORTANT: do not add a wildcard route like app.get('*') that collides with path-to-regexp patterns.
// The static file serving above will serve files from public/ (including index.html).
// If you want client-side routing later, add a safe fallback only for non-API routes.

// Global error handler (catches unhandled exceptions)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err && err.message ? err.message : 'Unknown error' });
});

// Start listening
app.listen(PORT, () => {
  console.log(`APOD backend listening: http://localhost:${PORT}`);
  if (NASA_API_KEY === 'DEMO_KEY') {
    console.warn('⚠️ Using NASA DEMO_KEY. Requests may be rate-limited. Set NASA_API_KEY in .env to use your own key.');
  }
});
