const crypto = require('crypto');
const config = require('./config');
const { db } = require('./db');

// ── Пароль админа (scrypt, без внешних зависимостей) ─────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(calc, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Подписанные cookie-сессии (без внешних зависимостей) ─────
function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function unsign(value) {
  if (!value || !value.includes('.')) return null;
  const [data, sig] = value.split('.');
  const expected = crypto.createHmac('sha256', config.SESSION_SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.BASE_URL.startsWith('https'),
  maxAge: 30 * 24 * 3600 * 1000, // 30 дней
  path: '/',
};

function setUserSession(res, userId) {
  res.cookie('sid', sign({ uid: userId, exp: Date.now() + COOKIE_OPTS.maxAge }), COOKIE_OPTS);
}
function setAdminSession(res) {
  res.cookie('asid', sign({ admin: true, exp: Date.now() + 12 * 3600 * 1000 }), COOKIE_OPTS);
}
function clearUserSession(res) { res.clearCookie('sid', { path: '/' }); }
function clearAdminSession(res) { res.clearCookie('asid', { path: '/' }); }

// Кладёт req.user (или null) в каждый запрос
const qUserById = db.prepare('SELECT * FROM users WHERE id = ?');
function attachUser(req, _res, next) {
  req.user = null;
  const s = unsign(req.cookies?.sid);
  if (s?.uid) req.user = qUserById.get(s.uid) || null;
  next();
}
function requireUser(req, res, next) {
  if (!req.user) return res.redirect('/auth?next=' + encodeURIComponent(req.originalUrl));
  next();
}
function requireAdmin(req, res, next) {
  const s = unsign(req.cookies?.asid);
  if (!s?.admin) return res.redirect('/admin/login');
  next();
}

// ── Magic-link токены ────────────────────────────────────────
const qInsertToken = db.prepare('INSERT INTO login_tokens (token, email, expires_at) VALUES (?, ?, ?)');
const qGetToken = db.prepare('SELECT * FROM login_tokens WHERE token = ?');
const qUseToken = db.prepare('UPDATE login_tokens SET used = 1 WHERE token = ?');

function createLoginToken(email) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + 30 * 60; // 30 минут
  qInsertToken.run(token, email, expires);
  return token;
}
function consumeLoginToken(token) {
  const row = qGetToken.get(token);
  if (!row || row.used) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  qUseToken.run(token);
  return row.email;
}

module.exports = {
  hashPassword, verifyPassword,
  setUserSession, setAdminSession, clearUserSession, clearAdminSession,
  attachUser, requireUser, requireAdmin,
  createLoginToken, consumeLoginToken,
};
