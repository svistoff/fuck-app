const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const config = require('./config');
const { db } = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const images = require('./images');
const { rotateActive } = require('./rotation');
const { CONTACT_ORDER, normalizeValue } = require('./contacts');
const V = require('./views');
const A = require('./views_admin');
const { isDisposable } = require('./disposable');

fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

// ── Prepared queries ─────────────────────────────────────────
const Q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insertUser: db.prepare('INSERT INTO users (email, name) VALUES (?, ?)'),
  updateUserOnboard: db.prepare('UPDATE users SET name=?, age=? WHERE id=?'),

  profileByUser: db.prepare('SELECT * FROM profiles WHERE user_id = ?'),
  profileById: db.prepare('SELECT * FROM profiles WHERE id = ?'),
  insertProfile: db.prepare(`INSERT INTO profiles (user_id, name, age, district, height, weight, bust, outcall, short_desc, full_desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  insertProfileManual: db.prepare(`INSERT INTO profiles (user_id, name, age, district, height, weight, bust, outcall, short_desc, full_desc) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateProfile: db.prepare(`UPDATE profiles SET name=?, age=?, district=?, height=?, weight=?, bust=?, outcall=?, short_desc=?, full_desc=?, updated_at=strftime('%s','now') WHERE id=?`),
  setStatus: db.prepare("UPDATE profiles SET status=?, updated_at=strftime('%s','now') WHERE id=?"),
  setPin: db.prepare('UPDATE profiles SET pinned=?, pin_order=? WHERE id=?'),
  adminUpdateProfile: db.prepare(`UPDATE profiles SET name=?, age=?, district=?, height=?, weight=?, bust=?, outcall=?, short_desc=?, full_desc=?, status=?, updated_at=strftime('%s','now') WHERE id=?`),

  activePinned: db.prepare("SELECT * FROM profiles WHERE status='active' AND pinned=1 ORDER BY pin_order, id"),
  activeUnpinned: db.prepare("SELECT * FROM profiles WHERE status='active' AND pinned=0 AND bumped_at=0 ORDER BY id"),
  activeBumped: db.prepare("SELECT * FROM profiles WHERE status='active' AND pinned=0 AND bumped_at>0 ORDER BY bumped_at DESC"),
  allProfilesAdmin: db.prepare(`SELECT p.*, (SELECT COUNT(1) FROM photos ph WHERE ph.profile_id=p.id) AS photos_cnt FROM profiles p ORDER BY p.id DESC`),

  contactsByProfile: db.prepare('SELECT type, value FROM contacts WHERE profile_id = ?'),
  clearContacts: db.prepare('DELETE FROM contacts WHERE profile_id = ?'),
  insertContact: db.prepare('INSERT INTO contacts (profile_id, type, value) VALUES (?, ?, ?)'),

  photosByProfile: db.prepare('SELECT * FROM photos WHERE profile_id = ? ORDER BY is_main DESC, sort_order, id'),
  mainPhoto: db.prepare('SELECT filename FROM photos WHERE profile_id = ? ORDER BY is_main DESC, sort_order, id LIMIT 1'),
  countPhotos: db.prepare('SELECT COUNT(1) AS c FROM photos WHERE profile_id = ?'),
  insertPhoto: db.prepare('INSERT INTO photos (profile_id, filename, sort_order, is_main) VALUES (?, ?, ?, ?)'),
  photoById: db.prepare('SELECT * FROM photos WHERE id = ?'),
  deletePhoto: db.prepare('DELETE FROM photos WHERE id = ?'),
  photoFilenames: db.prepare('SELECT filename FROM photos WHERE profile_id = ?'),

  pageBySlug: db.prepare('SELECT * FROM seo_pages WHERE slug = ? AND published = 1'),
  pageById: db.prepare('SELECT * FROM seo_pages WHERE id = ?'),
  allPages: db.prepare('SELECT * FROM seo_pages ORDER BY id DESC'),
  publishedPages: db.prepare('SELECT slug, updated_at FROM seo_pages WHERE published = 1'),
  insertPage: db.prepare(`INSERT INTO seo_pages (slug, title, h1, meta_description, keywords, body_html, published) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  updatePage: db.prepare(`UPDATE seo_pages SET slug=?, title=?, h1=?, meta_description=?, keywords=?, body_html=?, published=?, updated_at=strftime('%s','now') WHERE id=?`),
  deletePage: db.prepare('DELETE FROM seo_pages WHERE id = ?'),

  allSettings: db.prepare('SELECT key, value FROM settings'),
  setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),

  banners: db.prepare('SELECT * FROM banners ORDER BY sort_order, id'),
  activeBanners: db.prepare("SELECT * FROM banners WHERE active=1 AND (expires_at=0 OR expires_at>strftime('%s','now')) ORDER BY slot, sort_order, id"),
  addBannerView: db.prepare('UPDATE banners SET views = views + 1 WHERE id = ?'),
  addBannerClick: db.prepare('UPDATE banners SET clicks = clicks + 1 WHERE id = ?'),
  updateBannerMeta: db.prepare('UPDATE banners SET link_url=?, title=?, slot=?, expires_at=? WHERE id=?'),
  resetBannerStats: db.prepare('UPDATE banners SET views=0, clicks=0 WHERE id = ?'),
  bannerById: db.prepare('SELECT * FROM banners WHERE id = ?'),
  insertBanner: db.prepare('INSERT INTO banners (filename, link_url, title, slot, expires_at) VALUES (?, ?, ?, ?, ?)'),
  toggleBanner: db.prepare('UPDATE banners SET active = 1 - active WHERE id = ?'),
  deleteBanner: db.prepare('DELETE FROM banners WHERE id = ?'),

  countUsers: db.prepare('SELECT COUNT(1) AS c FROM users'),
  countStatus: db.prepare('SELECT COUNT(1) AS c FROM profiles WHERE status = ?'),
  countBanners: db.prepare('SELECT COUNT(1) AS c FROM banners'),
  countBlocked: db.prepare('SELECT COUNT(1) AS c FROM users WHERE blocked = 1'),
  countAppeals: db.prepare('SELECT COUNT(1) AS c FROM appeals WHERE resolved = 0'),

  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  setUserDevice: db.prepare('UPDATE users SET device_id = ? WHERE id = ?'),
  blockUser: db.prepare('UPDATE users SET blocked = 1 WHERE id = ?'),
  unblockUser: db.prepare('UPDATE users SET blocked = 0 WHERE id = ?'),
  hideUserProfile: db.prepare("UPDATE profiles SET status='hidden' WHERE user_id = ? AND status='active'"),
  showUserProfile: db.prepare("UPDATE profiles SET status='active' WHERE user_id = ? AND status='hidden'"),

  isDeviceBlocked: db.prepare('SELECT 1 FROM blocked_devices WHERE device_id = ?'),
  blockDevice: db.prepare('INSERT INTO blocked_devices (device_id) VALUES (?) ON CONFLICT(device_id) DO NOTHING'),
  unblockDevice: db.prepare('DELETE FROM blocked_devices WHERE device_id = ?'),

  setMainPhoto: db.prepare('UPDATE photos SET is_main = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE profile_id = ?'),

  setUserGender: db.prepare('UPDATE users SET name=?, age=?, gender=? WHERE id=?'),
  bumpProfile: db.prepare("UPDATE profiles SET bumped_at=strftime('%s','now') WHERE id=?"),
  insertReport: db.prepare('INSERT INTO reports (profile_id, user_id, reason) VALUES (?, ?, ?)'),
  allReports: db.prepare(`SELECT r.*, p.name AS profile_name FROM reports r LEFT JOIN profiles p ON p.id=r.profile_id ORDER BY r.resolved, r.id DESC`),
  reportsByUser: db.prepare('SELECT * FROM reports WHERE user_id = ? ORDER BY id DESC LIMIT 20'),
  resolveReport: db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?'),
  deleteReport: db.prepare('DELETE FROM reports WHERE id = ?'),
  countReports: db.prepare('SELECT COUNT(1) AS c FROM reports WHERE resolved = 0'),
  insertAppeal: db.prepare('INSERT INTO appeals (user_id, email, message) VALUES (?, ?, ?)'),
  allAppeals: db.prepare('SELECT * FROM appeals ORDER BY resolved, id DESC'),
  resolveAppeal: db.prepare('UPDATE appeals SET resolved = 1 WHERE id = ?'),
  deleteAppeal: db.prepare('DELETE FROM appeals WHERE id = ?'),
};

// ── Helpers ──────────────────────────────────────────────────
function bannerEvery() {
  const v = Number(getSettings().banner_every);
  return Number.isFinite(v) && v >= 1 ? v : 10;
}
function countViews(id) { try { Q.addBannerView.run(id); } catch {} }
function getSettings() {
  const o = {};
  for (const r of Q.allSettings.all()) o[r.key] = r.value;
  return o;
}
function isOnboarded(u) { return !!(u && u.name && u.age && u.gender); }
function loadProfileCards(rows, limit, offset) {
  return rows.slice(offset, offset + limit).map((p) => ({
    ...p, main_photo: Q.mainPhoto.get(p.id)?.filename || null, contacts: Q.contactsByProfile.all(p.id),
  }));
}
function catalogOrder() {
  // Порядок: закреплённые админом (корона) → недавно поднятые → остальные (ротация раз в 15 мин)
  return Q.activePinned.all()
    .concat(Q.activeBumped.all())
    .concat(rotateActive(Q.activeUnpinned.all()));
}
const BUMP_COOLDOWN = 12 * 3600; // 12 часов
function bumpInfoFor(profile) {
  if (!profile) return { canBump: false, waitText: '' };
  const now = Math.floor(Date.now() / 1000);
  const left = (profile.bumped_at || 0) + BUMP_COOLDOWN - now;
  if (left <= 0) return { canBump: true, waitText: '' };
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
  return { canBump: false, waitText: h > 0 ? `${h} ч ${m} мин` : `${m} мин` };
}
function saveContacts(profileId, body) {
  Q.clearContacts.run(profileId);
  for (const type of CONTACT_ORDER) {
    const val = normalizeValue(type, body[`contact_${type}`]);
    if (val) Q.insertContact.run(profileId, type, val);
  }
}
function numOrNull(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n);
}
// Поля анкеты из формы (общие для кабинета и админки)
function profileFieldsFromBody(body) {
  return {
    name: String(body.name || '').trim().slice(0, 64),
    age: numOrNull(body.age, 18, 99),
    district: String(body.district || '').trim().slice(0, 60),
    height: numOrNull(body.height, 120, 220),
    weight: numOrNull(body.weight, 30, 200),
    bust: numOrNull(body.bust, 1, 10),
    outcall: body.outcall ? 1 : 0,
    short_desc: String(body.short_desc || '').trim().slice(0, config.SHORT_DESC_MAX),
    full_desc: String(body.full_desc || '').trim(),
  };
}
function deletePhotoFiles(profileId) {
  for (const r of Q.photoFilenames.all(profileId)) {
    try { fs.unlinkSync(path.join(config.UPLOAD_DIR, r.filename)); } catch {}
  }
}
async function addPhotos(profileId, files) {
  let count = Q.countPhotos.get(profileId).c;
  for (const f of files || []) {
    if (count >= config.MAX_PHOTOS) { try { fs.unlinkSync(f.path); } catch {} continue; }
    const finalName = await images.processUpload(f, config.UPLOAD_DIR); // сжатие + удаление EXIF
    Q.insertPhoto.run(profileId, finalName, count, count === 0 ? 1 : 0);
    count++;
  }
}
function slugify(s) {
  return String(s || '').trim().toLowerCase().replace(/\.html?$/, '')
    .replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
function parseHtmlMeta(html, fallbackSlug) {
  const pick = (re) => (html.match(re) || [])[1];
  const title = (pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || fallbackSlug).trim();
  const mdTag = (html.match(/<meta[^>]+name=["']description["'][^>]*>/i) || [])[0] || '';
  const meta_description = (mdTag.match(/content=["']([^"']*)["']/i) || [])[1] || '';
  const h1 = (pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || title).replace(/<[^>]+>/g, '').trim();
  const bodyInner = pick(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return { title, meta_description, h1, body_html: (bodyInner != null ? bodyInner : html).trim() };
}

// ── App ──────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(auth.attachUser);

// Бренд из настроек -> в рендер
app.use((req, _res, next) => {
  const s = getSettings();
  V.setSite({
    name: config.SITE_NAME, logo: s.logo || null, favicon: s.favicon || null,
    analytics: s.analytics_html || '', city: config.CITY_NAME, cityPrep: s.city_prepositional || '',
  });
  next();
});

app.use('/css', express.static(path.join(config.ROOT, 'public/css')));
app.use('/js', express.static(path.join(config.ROOT, 'public/js')));
app.use('/img', express.static(path.join(config.ROOT, 'public/img')));
app.use('/uploads', express.static(config.UPLOAD_DIR, { maxAge: '365d', immutable: true, index: false }));

// Device-cookie (мягкий сигнал для блокировки по устройству)
app.use((req, res, next) => {
  let did = req.cookies.did;
  if (!did) {
    did = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    res.cookie('did', did, { maxAge: 5 * 365 * 24 * 3600 * 1000, sameSite: 'lax', path: '/', httpOnly: true });
  }
  req.did = did;
  // запоминаем устройство залогиненного пользователя — чтобы блок аккаунта мог захватить и устройство
  if (req.user && req.user.device_id !== did) Q.setUserDevice.run(did, req.user.id);
  next();
});

// Блок-гейт: заблокированный аккаунт/устройство видит только экран апелляции
const BLOCK_ALLOW = new Set(['/blocked', '/appeal']);
app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) return next();             // у админки своя авторизация
  if (BLOCK_ALLOW.has(req.path)) return next();
  const blocked = (req.user && req.user.blocked) || (req.did && Q.isDeviceBlocked.get(req.did));
  if (blocked) return res.redirect('/blocked');
  next();
});

// ── Multer ───────────────────────────────────────────────────
const diskStorage = multer.diskStorage({
  destination: (_r, _f, cb) => cb(null, config.UPLOAD_DIR),
  filename: (_r, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.(jpe?g|png|webp|gif|svg|ico)$/) || ['.jpg'])[0];
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const uploadImg = multer({ storage: diskStorage, limits: { fileSize: 15 * 1024 * 1024, files: config.MAX_PHOTOS },
  fileFilter: (_r, f, cb) => cb(null, /^image\//.test(f.mimetype)) });
const uploadPages = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 100 } });

// ── Публичные страницы ───────────────────────────────────────
const CATALOG_PAGE = 24;
app.get('/', (req, res) => {
  const all = catalogOrder();
  res.send(V.homePage({
    user: req.user, profiles: loadProfileCards(all, CATALOG_PAGE, 0),
    banners: Q.activeBanners.all(), hasMore: all.length > CATALOG_PAGE,
    settings: getSettings(), feedOpts: { every: bannerEvery(), startIndex: 0, onShow: countViews },
  }));
});
// Клик по баннеру: считаем и уводим на целевой адрес
app.get('/b/:id', (req, res) => {
  const b = Q.bannerById.get(Number(req.params.id));
  if (!b || !b.link_url) return res.redirect('/');
  try { Q.addBannerClick.run(b.id); } catch {}
  res.redirect(302, b.link_url);
});
// Старый адрес каталога больше не нужен — редирект на главную (сохраняем ссылки и SEO)
app.get('/catalog', (_req, res) => res.redirect(301, '/'));
// Подгрузка следующих страниц ленты при прокрутке (возвращает HTML-фрагмент)
app.get('/catalog/more', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const all = catalogOrder();
  const offset = (page - 1) * CATALOG_PAGE;
  const slice = loadProfileCards(all, CATALOG_PAGE, offset);
  res.json({
    html: V.feed(slice, Q.activeBanners.all(), { every: bannerEvery(), startIndex: offset, onShow: countViews }),
    more: all.length > offset + CATALOG_PAGE,
  });
});
app.get('/profile/:id', (req, res) => {
  const p = Q.profileById.get(Number(req.params.id));
  if (!p || p.status === 'deleted') return res.status(404).send(V.notFoundPage(req.user));
  res.send(V.profilePage({ user: req.user, profile: p, photos: Q.photosByProfile.all(p.id), contacts: Q.contactsByProfile.all(p.id) }));
});

// ── Встраиваемый виджет (iframe на других сайтах) ────────────
app.get('/embed', (req, res) => {
  const count = Math.min(10, Math.max(1, Number(req.query.count) || 5));
  const cards = loadProfileCards(catalogOrder(), count, 0);
  res.removeHeader('X-Frame-Options'); // разрешаем встраивание где угодно
  res.send(V.embedPage({ profiles: cards, ref: req.query.ref || '' }));
});

// ── Авторизация (magic link) с лимитом и honeypot ────────────
const rl = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const win = 15 * 60 * 1000;
  const arr = (rl.get(ip) || []).filter((t) => now - t < win);
  arr.push(now); rl.set(ip, arr);
  return arr.length > 5;
}
app.get('/auth', (req, res) => res.send(V.authEnterPage({ next: req.query.next })));
app.post('/auth', async (req, res) => {
  if (req.body.website) return res.send(V.authSentPage(String(req.body.email || ''))); // honeypot: молча игнор
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.send(V.authEnterPage({ next: req.body.next, error: 'Введите корректный email.' }));
  }
  if (isDisposable(email)) {
    return res.send(V.authEnterPage({ next: req.body.next, error: 'Одноразовые почтовые ящики не принимаются. Укажите постоянный email.' }));
  }
  if (rateLimited(req.ip)) {
    return res.send(V.authEnterPage({ next: req.body.next, error: 'Слишком много запросов. Попробуйте через несколько минут.' }));
  }
  const token = auth.createLoginToken(email);
  const link = `${config.BASE_URL}/auth/verify?token=${encodeURIComponent(token)}&next=${encodeURIComponent(req.body.next || '/')}`;
  try { await mailer.sendMagicLink(email, link); }
  catch (e) { console.error('mail error', e); return res.send(V.authEnterPage({ next: req.body.next, error: 'Не удалось отправить письмо. Попробуйте позже.' })); }
  res.send(V.authSentPage(email));
});
app.get('/auth/verify', (req, res) => {
  const email = auth.consumeLoginToken(String(req.query.token || ''));
  if (!email) return res.send(V.authEnterPage({ error: 'Ссылка недействительна или истекла. Запросите новую.' }));
  let user = Q.userByEmail.get(email);
  if (!user) { Q.insertUser.run(email, ''); user = Q.userByEmail.get(email); }
  auth.setUserSession(res, user.id);
  if (req.did) Q.setUserDevice.run(req.did, user.id);
  res.cookie('age_ok', '1', { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax', path: '/' });
  const next = String(req.query.next || '');
  if (user.blocked) return res.redirect('/blocked');
  if (!isOnboarded(user)) return res.redirect('/onboarding');
  res.redirect(next && next.startsWith('/') ? next : '/me');
});
app.post('/logout', (req, res) => { auth.clearUserSession(res); res.redirect('/'); });

// ── Блокировка + апелляция ───────────────────────────────────
app.get('/blocked', (req, res) => {
  res.send(V.blockedPage({ email: req.user?.email || '' }));
});
app.post('/appeal', (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 2000);
  if (!message) return res.send(V.blockedPage({ email: req.body.email || '', error: 'Напишите сообщение.' }));
  Q.insertAppeal.run(req.user?.id || null, String(req.body.email || req.user?.email || '').slice(0, 200), message);
  res.send(V.blockedPage({ sent: true }));
});

// ── Онбординг (без пола) ─────────────────────────────────────
app.get('/onboarding', auth.requireUser, (req, res) => {
  if (isOnboarded(req.user)) return res.redirect('/me');
  res.send(V.onboardingPage({ user: req.user }));
});
app.post('/onboarding', auth.requireUser, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 64);
  const age = Number(req.body.age);
  const gender = req.body.gender === 'male' ? 'male' : (req.body.gender === 'female' ? 'female' : null);
  if (!name || !age || age < 18 || age > 99 || !gender) {
    return res.send(V.onboardingPage({ user: req.user, error: 'Заполните имя, возраст (от 18) и пол.' }));
  }
  Q.setUserGender.run(name, age, gender, req.user.id);
  res.redirect(gender === 'female' ? '/me' : '/');
});

// ── Личный кабинет / анкета ──────────────────────────────────
app.get('/me', auth.requireUser, (req, res) => {
  if (!isOnboarded(req.user)) return res.redirect('/onboarding');
  // Мужчины анкету не размещают — им отдельный кабинет
  if (req.user.gender === 'male') {
    return res.send(V.maleCabinetPage({ user: req.user, myReports: Q.reportsByUser.all(req.user.id) }));
  }
  const profile = Q.profileByUser.get(req.user.id);
  res.send(V.profileFormPage({
    user: req.user, profile,
    contacts: profile ? Q.contactsByProfile.all(profile.id) : [],
    photos: profile ? Q.photosByProfile.all(profile.id) : [],
    mode: profile ? 'edit' : 'create',
    bumpInfo: bumpInfoFor(profile),
  }));
});
// Поднять анкету (раз в 12 часов)
app.post('/profile/bump', auth.requireUser, (req, res) => {
  const profile = Q.profileByUser.get(req.user.id);
  if (profile && bumpInfoFor(profile).canBump) Q.bumpProfile.run(profile.id);
  res.redirect('/me');
});
// Жалоба на анкету — только зарегистрированные мужчины
app.post('/profile/:id/report', auth.requireUser, (req, res) => {
  if (req.user.gender !== 'male') return res.redirect('/profile/' + req.params.id);
  const p = Q.profileById.get(Number(req.params.id));
  const reason = String(req.body.reason || '').trim().slice(0, 1000);
  if (p && reason) Q.insertReport.run(p.id, req.user.id, reason);
  res.send(V.layout({
    title: 'Жалоба отправлена', bodyClass: 'centered', user: req.user,
    body: `<div class="card-panel narrow"><h1>Жалоба отправлена</h1>
      <p>Спасибо, администратор рассмотрит её.</p>
      <a class="btn btn-primary" href="/">К анкетам</a></div>`,
  }));
});
function loadOwnProfile(req, _res, next) { req.profile = req.user ? Q.profileByUser.get(req.user.id) : null; next(); }

app.post('/profile', auth.requireUser, loadOwnProfile, (req, res) => {
  const f = profileFieldsFromBody(req.body);
  if (!f.name) {
    return res.send(V.profileFormPage({ user: req.user, profile: req.profile,
      contacts: req.profile ? Q.contactsByProfile.all(req.profile.id) : [],
      photos: req.profile ? Q.photosByProfile.all(req.profile.id) : [],
      mode: req.profile ? 'edit' : 'create', error: 'Укажите имя.' }));
  }
  let id;
  if (req.profile) {
    Q.updateProfile.run(f.name, f.age, f.district, f.height, f.weight, f.bust, f.outcall, f.short_desc, f.full_desc, req.profile.id);
    id = req.profile.id;
  } else {
    id = Q.insertProfile.run(req.user.id, f.name, f.age, f.district, f.height, f.weight, f.bust, f.outcall, f.short_desc, f.full_desc).lastInsertRowid;
  }
  saveContacts(id, req.body);
  res.redirect('/me');
});
app.post('/profile/photos', auth.requireUser, loadOwnProfile, uploadImg.array('photos', config.MAX_PHOTOS), async (req, res) => {
  if (req.profile) await addPhotos(req.profile.id, req.files);
  res.redirect('/me');
});
app.post('/profile/photos/:id/main', auth.requireUser, loadOwnProfile, (req, res) => {
  const ph = Q.photoById.get(Number(req.params.id));
  if (ph && req.profile && ph.profile_id === req.profile.id) Q.setMainPhoto.run(ph.id, req.profile.id);
  res.redirect('/me');
});
app.post('/profile/photos/:id/delete', auth.requireUser, loadOwnProfile, (req, res) => {
  const ph = Q.photoById.get(Number(req.params.id));
  if (ph && req.profile && ph.profile_id === req.profile.id) {
    try { fs.unlinkSync(path.join(config.UPLOAD_DIR, ph.filename)); } catch {}
    Q.deletePhoto.run(ph.id);
  }
  res.json({ ok: true });
});
app.post('/profile/hide', auth.requireUser, loadOwnProfile, (req, res) => {
  if (req.profile) Q.setStatus.run(req.profile.status === 'hidden' ? 'active' : 'hidden', req.profile.id);
  res.redirect('/me');
});
app.post('/profile/delete', auth.requireUser, loadOwnProfile, (req, res) => {
  if (req.profile) { deletePhotoFiles(req.profile.id); Q.setStatus.run('deleted', req.profile.id); }
  res.redirect('/me');
});

// ── SEO ──────────────────────────────────────────────────────
app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${config.BASE_URL}/sitemap.xml\n`));
app.get('/sitemap.xml', (_req, res) => {
  const urls = [`${config.BASE_URL}/`, `${config.BASE_URL}/catalog`];
  for (const p of Q.activePinned.all().concat(Q.activeUnpinned.all())) urls.push(`${config.BASE_URL}/profile/${p.id}`);
  for (const pg of Q.publishedPages.all()) urls.push(`${config.BASE_URL}/${pg.slug}`);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>`);
});

// ── Админка ──────────────────────────────────────────────────
app.get('/admin/login', (_req, res) => res.send(A.adminLoginPage()));
app.post('/admin/login', (req, res) => {
  const ok = req.body.username === config.ADMIN_USER && auth.verifyPassword(req.body.password || '', config.ADMIN_PASS_HASH);
  if (!ok) return res.send(A.adminLoginPage('Неверный логин или пароль.'));
  auth.setAdminSession(res); res.redirect('/admin');
});
app.post('/admin/logout', (req, res) => { auth.clearAdminSession(res); res.redirect('/admin/login'); });
app.use('/admin', auth.requireAdmin);

app.get('/admin', (_req, res) => res.send(A.adminDashboardPage({
  users: Q.countUsers.get().c, active: Q.countStatus.get('active').c,
  hidden: Q.countStatus.get('hidden').c, deleted: Q.countStatus.get('deleted').c,
  banners: Q.countBanners.get().c, blocked: Q.countBlocked.get().c, appeals: Q.countAppeals.get().c,
  reports: Q.countReports.get().c,
})));

app.get('/admin/profiles', (_req, res) => res.send(A.adminProfilesPage(Q.allProfilesAdmin.all())));
app.get('/admin/profiles/new', (_req, res) => res.send(A.adminProfileEditPage(null, [], [])));
app.post('/admin/profiles', (req, res) => {
  const f = profileFieldsFromBody(req.body);
  if (!f.name) return res.redirect('/admin/profiles/new');
  const id = Q.insertProfileManual.run(f.name, f.age, f.district, f.height, f.weight, f.bust, f.outcall, f.short_desc, f.full_desc).lastInsertRowid;
  saveContacts(id, req.body);
  res.redirect('/admin/profiles/' + id);
});
app.get('/admin/profiles/:id', (req, res) => {
  const p = Q.profileById.get(Number(req.params.id));
  if (!p) return res.redirect('/admin/profiles');
  if (p.user_id) p.user_blocked = Q.userById.get(p.user_id)?.blocked ? 1 : 0;
  res.send(A.adminProfileEditPage(p, Q.photosByProfile.all(p.id), Q.contactsByProfile.all(p.id)));
});
app.post('/admin/profiles/:id', (req, res) => {
  const p = Q.profileById.get(Number(req.params.id));
  if (p) {
    const f = profileFieldsFromBody(req.body);
    const status = ['active', 'hidden', 'deleted'].includes(req.body.status) ? req.body.status : p.status;
    Q.adminUpdateProfile.run(f.name, f.age, f.district, f.height, f.weight, f.bust, f.outcall, f.short_desc, f.full_desc, status, p.id);
    saveContacts(p.id, req.body);
    if (status === 'deleted') deletePhotoFiles(p.id);
  }
  res.redirect('/admin/profiles/' + req.params.id);
});
app.post('/admin/profiles/:id/photos', uploadImg.array('photos', config.MAX_PHOTOS), async (req, res) => {
  const p = Q.profileById.get(Number(req.params.id));
  if (p) await addPhotos(p.id, req.files);
  res.redirect('/admin/profiles/' + req.params.id);
});
app.post('/admin/profiles/:id/photos/:pid/main', (req, res) => {
  const ph = Q.photoById.get(Number(req.params.pid));
  if (ph) Q.setMainPhoto.run(ph.id, ph.profile_id);
  res.redirect('/admin/profiles/' + req.params.id);
});
app.post('/admin/profiles/:id/pin', (req, res) => {
  const p = Q.profileById.get(Number(req.params.id));
  if (p) Q.setPin.run(p.pinned ? 0 : 1, p.pinned ? 0 : Math.floor(Date.now() / 1000), p.id);
  res.redirect('/admin/profiles');
});
app.post('/admin/profiles/:id/delete', (req, res) => {
  const p = Q.profileById.get(Number(req.params.id));
  if (p) { deletePhotoFiles(p.id); Q.setStatus.run('deleted', p.id); }
  res.redirect('/admin/profiles');
});
app.post('/admin/profiles/:id/photos/:pid/delete', (req, res) => {
  const ph = Q.photoById.get(Number(req.params.pid));
  if (ph) { try { fs.unlinkSync(path.join(config.UPLOAD_DIR, ph.filename)); } catch {} Q.deletePhoto.run(ph.id); }
  res.redirect('/admin/profiles/' + req.params.id);
});

// Блокировка пользователей + апелляции
app.post('/admin/users/:id/block', (req, res) => {
  const u = Q.userById.get(Number(req.params.id));
  if (u) { Q.blockUser.run(u.id); Q.hideUserProfile.run(u.id); if (u.device_id) Q.blockDevice.run(u.device_id); }
  res.redirect(req.get('referer') || '/admin/profiles');
});
app.post('/admin/users/:id/unblock', (req, res) => {
  const u = Q.userById.get(Number(req.params.id));
  if (u) { Q.unblockUser.run(u.id); Q.showUserProfile.run(u.id); if (u.device_id) Q.unblockDevice.run(u.device_id); }
  res.redirect(req.get('referer') || '/admin/appeals');
});
app.get('/admin/reports', (_req, res) => res.send(A.adminReportsPage(Q.allReports.all())));
app.post('/admin/reports/:id/resolve', (req, res) => { Q.resolveReport.run(Number(req.params.id)); res.redirect('/admin/reports'); });
app.post('/admin/reports/:id/delete', (req, res) => { Q.deleteReport.run(Number(req.params.id)); res.redirect('/admin/reports'); });
// Удалить анкету по жалобе
app.post('/admin/reports/:id/remove-profile', (req, res) => {
  const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
  if (rep && rep.profile_id) {
    const p = Q.profileById.get(rep.profile_id);
    if (p) { deletePhotoFiles(p.id); Q.setStatus.run('deleted', p.id); }
    Q.resolveReport.run(rep.id);
  }
  res.redirect('/admin/reports');
});
app.get('/admin/appeals', (_req, res) => res.send(A.adminAppealsPage(Q.allAppeals.all())));
app.post('/admin/appeals/:id/resolve', (req, res) => { Q.resolveAppeal.run(Number(req.params.id)); res.redirect('/admin/appeals'); });
app.post('/admin/appeals/:id/delete', (req, res) => { Q.deleteAppeal.run(Number(req.params.id)); res.redirect('/admin/appeals'); });

// Баннеры
app.get('/admin/banners', (_req, res) => res.send(A.adminBannersPage(Q.banners.all(), bannerEvery())));
function parseExpiry(v) {
  if (!v) return 0;
  const t = Date.parse(v + 'T23:59:59');
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}
app.post('/admin/banners', uploadImg.single('image'), (req, res) => {
  if (req.file) {
    Q.insertBanner.run(req.file.filename, String(req.body.link_url || '').trim(),
      String(req.body.title || '').trim(), Number(req.body.slot) || 0, parseExpiry(req.body.expires_at));
  }
  res.redirect('/admin/banners');
});
app.post('/admin/banners/:id/update', (req, res) => {
  Q.updateBannerMeta.run(String(req.body.link_url || '').trim(), String(req.body.title || '').trim(),
    Number(req.body.slot) || 0, parseExpiry(req.body.expires_at), Number(req.params.id));
  res.redirect('/admin/banners');
});
app.post('/admin/banners/:id/reset-stats', (req, res) => { Q.resetBannerStats.run(Number(req.params.id)); res.redirect('/admin/banners'); });
app.post('/admin/banners/frequency', (req, res) => {
  const n = Math.max(1, Number(req.body.banner_every) || 10);
  Q.setSetting.run('banner_every', String(n));
  res.redirect('/admin/banners');
});
app.post('/admin/banners/:id/toggle', (req, res) => { Q.toggleBanner.run(Number(req.params.id)); res.redirect('/admin/banners'); });
app.post('/admin/banners/:id/delete', (req, res) => {
  const b = Q.bannerById.get(Number(req.params.id));
  if (b) { try { fs.unlinkSync(path.join(config.UPLOAD_DIR, b.filename)); } catch {} Q.deleteBanner.run(b.id); }
  res.redirect('/admin/banners');
});

// SEO-страницы
app.get('/admin/pages', (_req, res) => res.send(A.adminPagesPage(Q.allPages.all())));
app.get('/admin/pages/new', (_req, res) => res.send(A.adminPageEditPage(null)));
app.post('/admin/pages', (req, res) => {
  const b = req.body; const slug = slugify(b.slug);
  if (!slug || !b.title) return res.send(A.adminPageEditPage({ ...b }));
  try { Q.insertPage.run(slug, b.title, b.h1 || '', b.meta_description || '', b.keywords || '', b.body_html || '', b.published ? 1 : 0); }
  catch { return res.send(A.adminPageEditPage({ ...b, slug })); }
  res.redirect('/admin/pages');
});
app.post('/admin/pages/bulk', uploadPages.array('pages', 100), (req, res) => {
  for (const f of req.files || []) {
    const slug = slugify(f.originalname);
    if (!slug) continue;
    const html = f.buffer.toString('utf8');
    const m = parseHtmlMeta(html, slug);
    try { Q.insertPage.run(slug, m.title, m.h1, m.meta_description, '', m.body_html, 1); } catch {}
  }
  res.redirect('/admin/pages');
});
app.get('/admin/pages/:id', (req, res) => {
  const p = Q.pageById.get(Number(req.params.id));
  if (!p) return res.redirect('/admin/pages');
  res.send(A.adminPageEditPage(p));
});
app.post('/admin/pages/:id', (req, res) => {
  const b = req.body; const slug = slugify(b.slug);
  Q.updatePage.run(slug, b.title, b.h1 || '', b.meta_description || '', b.keywords || '', b.body_html || '', b.published ? 1 : 0, Number(req.params.id));
  res.redirect('/admin/pages/' + req.params.id);
});
app.post('/admin/pages/:id/delete', (req, res) => { Q.deletePage.run(Number(req.params.id)); res.redirect('/admin/pages'); });

// Настройки
app.get('/admin/settings', (_req, res) => res.send(A.adminSettingsPage(getSettings())));
app.post('/admin/settings', (req, res) => {
  for (const k of ['home_title', 'home_description', 'home_keywords', 'home_intro', 'city_prepositional', 'analytics_html']) {
    Q.setSetting.run(k, String(req.body[k] || ''));
  }
  res.redirect('/admin/settings');
});
app.post('/admin/settings/brand', uploadImg.fields([{ name: 'logo', maxCount: 1 }, { name: 'favicon', maxCount: 1 }]), (req, res) => {
  if (req.files?.logo?.[0]) Q.setSetting.run('logo', req.files.logo[0].filename);
  if (req.files?.favicon?.[0]) Q.setSetting.run('favicon', req.files.favicon[0].filename);
  res.redirect('/admin/settings');
});
app.post('/admin/settings/logo/delete', (_req, res) => { Q.setSetting.run('logo', ''); res.redirect('/admin/settings'); });
app.post('/admin/settings/favicon/delete', (_req, res) => { Q.setSetting.run('favicon', ''); res.redirect('/admin/settings'); });

// ── SEO посадочные (catch-all, в самом конце) ────────────────
app.get('/:slug', (req, res) => {
  const slug = String(req.params.slug || '');
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(404).send(V.notFoundPage(req.user));
  const page = Q.pageBySlug.get(slug);
  if (!page) return res.status(404).send(V.notFoundPage(req.user));
  res.send(V.landingPage({ user: req.user, pageRow: page }));
});
app.use((req, res) => res.status(404).send(V.notFoundPage(req.user)));

app.listen(config.PORT, () => {
  console.log(`${config.SITE_NAME} → http://localhost:${config.PORT}  (база: ${config.DB_PATH})`);
  if (!config.ADMIN_PASS_HASH) console.warn('⚠  ADMIN_PASS_HASH не задан — вход в админку недоступен (см. README).');
  if (!images.hasSharp()) console.warn('⚠  sharp не установлен — фото без сжатия и без вырезания EXIF.');
});
