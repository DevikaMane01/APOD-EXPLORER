require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

// cache settings, seems enough for now
const CACHE_MAX_ITEMS = Number(process.env.CACHE_MAX_ITEMS) || 200;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 1000 * 60 * 60 * 24;

class LruTtlCache {
  constructor({ max = 200, ttl = 24 * 60 * 60 * 1000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.map = new Map();
  }

  _isExpired(entry) {
    return !entry || (entry.expiresAt && Date.now() > entry.expiresAt);
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (this._isExpired(entry)) {
      this.map.delete(key); // remove expired item
      return undefined;
    }

    this.map.delete(key);
    this.map.set(key, entry); // refresh recency
    return entry.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);

    const expiresAt = this.ttl > 0 ? Date.now() + this.ttl : null;
    this.map.set(key, { value, expiresAt });

    // enforce max size, simple LRU
    while (this.map.size > this.max) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  size() {
    // clean expired entries first
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

// helper to pick only the fields we care about, works fine
function simplifyApod(data) {
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

// simple wrapper for calling NASA API
async function callNasa(params = {}) {
  const endpoint = 'https://api.nasa.gov/planetary/apod';
  const q = { api_key: NASA_API_KEY, ...params };
  try {
    const resp = await axios.get(endpoint, { params: q, timeout: 10000 });
    return resp.data;
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const text = err.response.statusText || JSON.stringify(err.response.data);
      throw new Error(`NASA API responded ${status}: ${text}`);
    }
    throw new Error(`Failed to call NASA API: ${err.message}`);
  }
}

// validate date string, simple check
function isValidDateString(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

const publicPath = path.join(__dirname, '..', '..', 'public');
app.use(express.static(publicPath));

// health check route, works fine
app.get('/api/health', (req, res) => {
  return res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cache: { entries: cache.size(), ttl_ms: CACHE_TTL_MS, max_items: CACHE_MAX_ITEMS },
    using_demo_key: NASA_API_KEY === 'DEMO_KEY',
  });
});

// today's APOD
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

// APOD by date
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
    return res.status(502).json({ error: 'Bad Gateway', message: err.message });
  }
});

// recent APODs, up to 50
app.get('/api/apod/recent', async (req, res) => {
  const parsed = parseInt(req.query.count || '10', 10);
  if (Number.isNaN(parsed) || parsed <= 0) return res.status(400).json({ error: 'Bad Request', message: 'Invalid count. Must be a positive integer.' });

  const count = Math.min(50, parsed);

  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const startDate = new Date(today.getTime() - (count - 1) * 86400000);
  const start = startDate.toISOString().slice(0, 10);

  const key = `apod:range:${start}:${end}`;

  try {
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    const data = await callNasa({ start_date: start, end_date: end });
    const arr = Array.isArray(data) ? data : [data];
    const list = arr.slice().reverse().map(simplifyApod); // reverse so newest first
    cache.set(key, list);
    return res.json(list);
  } catch (err) {
    console.error(`GET /api/apod/recent?count=${count} error:`, err.message);
    return res.status(502).json({ error: 'Bad Gateway', message: err.message });
  }
});

// catch-all for unknown API routes
app.use('/api', (req, res) => {
  return res.status(404).json({ error: 'Not Found', message: 'API route not found' });
});

// global error handler, should catch anything
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err && err.message ? err.message : 'Unknown error' });
});

// start server
app.listen(PORT, () => {
  console.log(`APOD backend listening: http://localhost:${PORT}`);
  if (NASA_API_KEY === 'DEMO_KEY') {
    console.warn(' Using NASA DEMO_KEY. Requests may be rate-limited. Set NASA_API_KEY in .env to use your own key.');
  }
});
