'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'ayansh-construction.db');
const PORT = Number(process.env.PORT || 3000);
const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error('Set ADMIN_PASSWORD to a unique password of at least 12 characters before starting the site.');
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT must be a valid port number.');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    featured INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    project_type TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'New',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

const defaultSettings = {
  business_name: 'Ayansh Construction',
  owner: 'Brijendra Singh Chauhan',
  location: 'Lucknow',
  phone: '9450559009',
  email: '',
  about_text: 'We bring clarity to every stage of a build—from the first conversation and careful planning to skilled workmanship and a considered handover. Our focus is straightforward communication, thoughtful details, and dependable delivery.'
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value);
if (db.prepare('SELECT COUNT(*) AS count FROM services').get().count === 0) {
  const insert = db.prepare('INSERT INTO services (title, description, image_url, position) VALUES (?, ?, ?, ?)');
  [
    ['Residential construction', 'Thoughtfully planned homes, built around the way you want to live.', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1000&q=85', 0],
    ['Commercial construction', 'Practical, welcoming spaces designed for teams, customers, and growth.', 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1000&q=85', 1],
    ['Renovation and refurbishment', 'Give an existing space a new chapter with considered upgrades and care.', 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1000&q=85', 2],
    ['Public sector and infrastructure', 'An open invitation to discuss public works and infrastructure needs.', 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1000&q=85', 3]
  ].forEach((row) => insert.run(...row));
}

const statements = {
  settings: db.prepare('SELECT key, value FROM settings'),
  services: db.prepare('SELECT id, title, description, image_url, position FROM services ORDER BY position, id'),
  projects: db.prepare('SELECT id, title, category, location, description, image_url, featured FROM projects ORDER BY featured DESC, id DESC'),
  enquiries: db.prepare('SELECT id, name, email, phone, project_type, description, status, created_at FROM enquiries ORDER BY id DESC'),
  session: db.prepare('SELECT csrf_token, expires_at FROM sessions WHERE token_hash = ?'),
  createSession: db.prepare('INSERT INTO sessions (token_hash, csrf_token, expires_at) VALUES (?, ?, ?)'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
};

function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const adminSalt = crypto.randomBytes(16);
const adminHash = crypto.scryptSync(ADMIN_PASSWORD, adminSalt, 64);
function passwordMatches(password) {
  const candidate = crypto.scryptSync(password, adminSalt, 64);
  return crypto.timingSafeEqual(candidate, adminHash);
}

function readCookie(req, name) {
  const cookies = req.headers.cookie || '';
  for (const entry of cookies.split(';')) {
    const index = entry.indexOf('=');
    if (index !== -1 && entry.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(entry.slice(index + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

function getSession(req) {
  const token = readCookie(req, 'ayansh_session');
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = statements.session.get(tokenHash);
  if (!session || session.expires_at <= Date.now()) {
    statements.deleteSession.run(tokenHash);
    return null;
  }
  return { tokenHash, csrfToken: session.csrf_token };
}

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    const error = new Error('Request body must be a valid JSON object.');
    error.status = 400;
    throw error;
  }
}

function text(value, label, max, required = true) {
  if (typeof value !== 'string') throw inputError(`${label} must be text.`);
  const clean = value.trim();
  if (required && !clean) throw inputError(`${label} is required.`);
  if (clean.length > max) throw inputError(`${label} must be ${max} characters or fewer.`);
  return clean;
}

function imageUrl(value) {
  const result = text(value ?? '', 'Image URL', 2048, false);
  if (result && !/^https:\/\/[^\s]+$/i.test(result)) throw inputError('Image URL must start with https://.');
  return result;
}

function settingsObject() {
  return Object.fromEntries(statements.settings.all().map(({ key, value }) => [key, value]));
}

function validateOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host && ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function requireAdmin(req, res, session, stateChanging) {
  if (!session) {
    json(res, 401, { error: 'Please sign in to continue.' });
    return false;
  }
  if (stateChanging && (!validateOrigin(req) || !safeEqual(req.headers['x-csrf-token'] || '', session.csrfToken))) {
    json(res, 403, { error: 'This request could not be verified. Refresh the page and try again.' });
    return false;
  }
  return true;
}

const loginAttempts = new Map();
function loginLimited(ip) {
  const attempts = loginAttempts.get(ip);
  if (!attempts || attempts.until <= Date.now()) {
    loginAttempts.delete(ip);
    return false;
  }
  return attempts.count >= 8;
}

function publicSiteData() {
  const projects = statements.projects.all();
  return {
    settings: settingsObject(),
    services: statements.services.all(),
    projects,
    featuredProject: projects.find((project) => project.featured === 1) || null
  };
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function saveService(data, id) {
  const values = [
    text(data.title, 'Title', 100),
    text(data.description, 'Description', 1000),
    imageUrl(data.image_url)
  ];
  if (id) {
    const result = db.prepare('UPDATE services SET title = ?, description = ?, image_url = ? WHERE id = ?').run(...values, id);
    if (!result.changes) return false;
  } else {
    const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM services').get().position;
    db.prepare('INSERT INTO services (title, description, image_url, position) VALUES (?, ?, ?, ?)').run(...values, position);
  }
  return true;
}

function saveProject(data, id) {
  const values = [
    text(data.title, 'Title', 120),
    text(data.category, 'Category', 100),
    text(data.location, 'Location', 120),
    text(data.description, 'Description', 1200),
    imageUrl(data.image_url)
  ];
  if (id) {
    const result = db.prepare('UPDATE projects SET title = ?, category = ?, location = ?, description = ?, image_url = ? WHERE id = ?').run(...values, id);
    if (!result.changes) return false;
  } else {
    db.prepare('INSERT INTO projects (title, category, location, description, image_url) VALUES (?, ?, ?, ?, ?)').run(...values);
  }
  return true;
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return json(res, 400, { error: 'The request path is invalid.' });
  }
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/site') return json(res, 200, publicSiteData());
  if (method === 'POST' && pathname === '/api/enquiries') {
    if (!validateOrigin(req)) return json(res, 403, { error: 'This request could not be verified.' });
    const data = await readJson(req);
    const name = text(data.name, 'Name', 100);
    const email = text(data.email, 'Email', 254).toLowerCase();
    const phone = text(data.phone ?? '', 'Phone', 40, false);
    const projectType = text(data.project_type, 'Project type', 100);
    const description = text(data.description, 'Project description', 3000);
    if (!validEmail(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    db.prepare('INSERT INTO enquiries (name, email, phone, project_type, description, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      name, email, phone, projectType, description, new Date().toISOString()
    );
    return json(res, 201, { message: 'Thank you. Your enquiry has been sent successfully.' });
  }

  if (method === 'POST' && pathname === '/api/admin/login') {
    if (!validateOrigin(req)) return json(res, 403, { error: 'This request could not be verified.' });
    const ip = req.socket.remoteAddress || 'unknown';
    if (loginLimited(ip)) return json(res, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' });
    const data = await readJson(req);
    const password = typeof data.password === 'string' ? data.password : '';
    if (password.length > 200) return json(res, 400, { error: 'Password must be 200 characters or fewer.' });
    if (!passwordMatches(password)) {
      const previous = loginAttempts.get(ip);
      const count = previous && previous.until > Date.now() ? previous.count + 1 : 1;
      loginAttempts.set(ip, { count, until: Date.now() + 15 * 60 * 1000 });
      return json(res, 401, { error: 'The password was not recognized.' });
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    statements.deleteExpired.run(Date.now());
    statements.createSession.run(tokenHash, csrfToken, Date.now() + SESSION_MS);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return json(res, 200, { csrfToken }, {
      'Set-Cookie': `ayansh_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`
    });
  }

  if (pathname.startsWith('/api/admin/')) {
    const session = getSession(req);
    if (!requireAdmin(req, res, session, method !== 'GET' && method !== 'HEAD')) return;
    if (method === 'POST' && pathname === '/api/admin/logout') {
      statements.deleteSession.run(session.tokenHash);
      return json(res, 200, { message: 'You have been signed out.' }, {
        'Set-Cookie': 'ayansh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
      });
    }
    if (method === 'GET' && pathname === '/api/admin/data') {
      return json(res, 200, {
        ...publicSiteData(),
        enquiries: statements.enquiries.all(),
        csrfToken: session.csrfToken
      });
    }

    const enquiryMatch = pathname.match(/^\/api\/admin\/enquiries\/(\d+)$/);
    if (enquiryMatch && method === 'PATCH') {
      const data = await readJson(req);
      const status = text(data.status, 'Status', 30);
      if (!['New', 'In progress', 'Contacted', 'Closed'].includes(status)) return json(res, 400, { error: 'Choose a valid follow-up status.' });
      const result = db.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(status, Number(enquiryMatch[1]));
      return result.changes ? json(res, 200, { message: 'Enquiry updated.' }) : json(res, 404, { error: 'Enquiry not found.' });
    }
    if (enquiryMatch && method === 'DELETE') {
      const result = db.prepare('DELETE FROM enquiries WHERE id = ?').run(Number(enquiryMatch[1]));
      return result.changes ? json(res, 200, { message: 'Enquiry deleted.' }) : json(res, 404, { error: 'Enquiry not found.' });
    }

    if (pathname === '/api/admin/services/reorder' && method === 'POST') {
      const data = await readJson(req);
      if (!Array.isArray(data.ids) || data.ids.length > 100 || !data.ids.every(Number.isSafeInteger)) return json(res, 400, { error: 'Provide a valid service order.' });
      const known = db.prepare('SELECT id FROM services').all().map((row) => row.id);
      if (data.ids.length !== known.length || new Set(data.ids).size !== known.length || data.ids.some((id) => !known.includes(id))) {
        return json(res, 400, { error: 'The service order must include every service exactly once.' });
      }
      const update = db.prepare('UPDATE services SET position = ? WHERE id = ?');
      db.exec('BEGIN');
      try {
        data.ids.forEach((id, index) => update.run(index, id));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return json(res, 200, { message: 'Service order updated.' });
    }
    if (pathname === '/api/admin/services' && method === 'POST') {
      const data = await readJson(req);
      saveService(data);
      return json(res, 201, { message: 'Service added.' });
    }
    const serviceMatch = pathname.match(/^\/api\/admin\/services\/(\d+)$/);
    if (serviceMatch && method === 'PUT') {
      const data = await readJson(req);
      return saveService(data, Number(serviceMatch[1]))
        ? json(res, 200, { message: 'Service updated.' })
        : json(res, 404, { error: 'Service not found.' });
    }
    if (serviceMatch && method === 'DELETE') {
      const result = db.prepare('DELETE FROM services WHERE id = ?').run(Number(serviceMatch[1]));
      return result.changes ? json(res, 200, { message: 'Service deleted.' }) : json(res, 404, { error: 'Service not found.' });
    }

    if (pathname === '/api/admin/projects' && method === 'POST') {
      const data = await readJson(req);
      saveProject(data);
      return json(res, 201, { message: 'Project added.' });
    }
    const projectMatch = pathname.match(/^\/api\/admin\/projects\/(\d+)$/);
    if (projectMatch && method === 'PUT') {
      const data = await readJson(req);
      return saveProject(data, Number(projectMatch[1]))
        ? json(res, 200, { message: 'Project updated.' })
        : json(res, 404, { error: 'Project not found.' });
    }
    if (projectMatch && method === 'DELETE') {
      const result = db.prepare('DELETE FROM projects WHERE id = ?').run(Number(projectMatch[1]));
      return result.changes ? json(res, 200, { message: 'Project deleted.' }) : json(res, 404, { error: 'Project not found.' });
    }
    const featuredMatch = pathname.match(/^\/api\/admin\/projects\/(\d+)\/featured$/);
    if (featuredMatch && method === 'POST') {
      const id = Number(featuredMatch[1]);
      if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) return json(res, 404, { error: 'Project not found.' });
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE projects SET featured = 0').run();
        db.prepare('UPDATE projects SET featured = 1 WHERE id = ?').run(id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return json(res, 200, { message: 'Featured project updated.' });
    }

    if (pathname === '/api/admin/settings' && method === 'PATCH') {
      const data = await readJson(req);
      const next = {
        business_name: text(data.business_name, 'Business name', 120),
        owner: text(data.owner, 'Owner name', 120),
        location: text(data.location, 'Location', 120),
        phone: text(data.phone, 'Phone', 40),
        email: text(data.email ?? '', 'Email', 254, false),
        about_text: text(data.about_text, 'About text', 2000)
      };
      if (next.email && !validEmail(next.email)) return json(res, 400, { error: 'Enter a valid business email address.' });
      const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      Object.entries(next).forEach(([key, value]) => upsert.run(key, value));
      return json(res, 200, { message: 'Site settings saved.' });
    }
    return json(res, 404, { error: 'Admin endpoint not found.' });
  }

  if (method === 'GET' && pathname === '/admin') {
    return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'));
  }
  if (method === 'GET' && pathname === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  if (method === 'GET') {
    const requested = path.resolve(PUBLIC_DIR, `.${pathname}`);
    if (!requested.startsWith(`${PUBLIC_DIR}${path.sep}`)) return json(res, 404, { error: 'Not found.' });
    return serveFile(res, requested);
  }
  return json(res, 404, { error: 'Not found.' });
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return json(res, 404, { error: 'Not found.' });
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
  res.writeHead(200, {
    'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://images.unsplash.com https: data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    const status = error.status || 500;
    if (status >= 500) console.error('Request failed:', error);
    json(res, status, { error: status >= 500 ? 'The server could not complete this request.' : error.message });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Ayansh Construction is running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
