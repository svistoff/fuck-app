const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const config = require('./config');
const { db } = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const { rotateActive } = require('./rotation');
const { CONTACT_ORDER, normalizeValue } = require('./contacts');
const V = require('./views');
const A = require('./views_admin');

fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });

// ── Prepared queries ─────────────────────────────────────────
const Q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insertUser: db.prepare('INSERT INTO users (email, name) VALUES (?, ?)'),
  updateUserOnboard: db.prepare('UPDATE users SET name=?, age=?, gender=? WHERE id=?'),

  profileByUser: db.prepare('SELECT * FROM profiles WHERE user_id = ?'),
  profileById: db.prepare('SELECT * FROM profiles WHERE id = ?'),
  insertProfile: db.prepare(`INSERT INTO profiles (user_id, name, age, district, short_desc, full_desc)
                             VALUES (?, ?, ?, ?, ?, ?)`),
  updateProfile: db.prepare(`UPDATE profiles SET name=?, age=?, district=?, short_desc=?, full_desc=?,
                             updated_at=strftime('%s','now') WHERE id=?`),
  setStatus: db.prepare("UPDATE profiles SET status=?, updated_at=strftime('%s','now') WHERE id=?"),
  setPin: db.prepare('UPDATE profiles SET pinned=?, pin_order=? WHERE id=?'),
  adminUpdateProfile: db.prepare(`UPDATE profiles SET name=?, age=?, district=?, short_desc=?, full_desc=?, status=?,
                                  updated_at=strftime('%s','now') WHERE id=?`),

  activePinned: db.prepare("SELECT * FROM profiles WHERE status='active' AND pinned=1 ORDER BY pin_order, id"),
  activeUnpinned: db.prepare("SELECT * FROM profiles WHERE status='active' AND pinned=0 ORDER BY id"),
  allProfilesAdmin: db.prepare(`SELECT p.*, (SELECT COUNT(1) FROM photos ph WHERE ph.profile_id=p.id) AS photos_cnt
                                FROM profiles p ORDER BY p.id DESC`),

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
  insertPage: db.prepare(`INSERT INTO seo_pages (slug, title, h1, meta_description, keywords, body_html, published)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`),
  updatePage: db.prepare(`UPDATE seo_pages SET slug=?, title=?, h1=?, meta_description=?, keywords=?, body_html=?,
                          published=?, updated_at=strftime('%s','now') WHERE id=?`),
  deletePage: db.prepare('DELETE FROM seo_pages WHERE id = ?'),

  allSettings: db.prepare('SELECT key, value FROM settings'),
  setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),

  countGender: db.prepare("SELECT COUNT(1) AS c FROM users WHERE gender = ?"),
  countStatus: db.prepare("SELECT COUNT(1) AS c FROM profiles WHERE status = ?"),
};

// ── Helpers ──────────────────────────────────────────────────
function getSettings() {
  const o = {};
  for (const r of Q.allSettings.all()) o[r.key] = r.value;
  return o;
}
function loadProfileCards(rows, limit, offset) {
  const slice = rows.slice(offset, offset + limit);
  return slice.map((p) => ({
    ...p,
    main_photo: Q.mainPhoto.get(p.id)?.filename || null,
    contacts: Q.contactsByProfile.all(p.id),
  }));
}
function catalogOrder() {
  const pinned = Q.activePinned.all();
  const rotated = rotateActive(Q.activeUnpinned.all());
  return pinned.concat(rotated);
}
function saveContacts(profileId, body) {
  Q.clearContacts.run(profileId);
  for (const type of CONTACT_ORDER) {
    const raw = body[`contact_${type}`];
    const val = normalizeValue(type, raw);
    if (val) Q.insertContact.run(profileId, type, val);
  }
}
function deletePhotoFiles(profileId) {
  for (const r of Q.photoFilenames.all(profileId)) {
    try { fs.unlinkSync(path.join(config.UPLOAD_DIR, r.filename)); } catch {}
  }
}

// ── App ──────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(auth.attachUser);

app.use('/css', express.static(path.join(config.ROOT, 'public/css')));
app.use('/js', express.static(path.join(config.ROOT, 'public/js')));
app.use('/img', express.static(path.join(config.ROOT, 'public/img')));
app.use('/uploads', express.static(config.UPLOAD_DIR, {
  maxAge: '365d', immutable: true, index: false,
}));

// ── Публичные страницы ───────────────────────────────────────
app.get('/', (req, res) => {
  const cards = loadProfileCards(catalogOrder(), 8, 0);
  res.send(V.homePage({ user: req.user, profiles: cards, settings: getSettings() }));
});

app.get('/catalog', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 24;
  const all = catalogOrder();
  const cards = loadProfileCards(all, limit, (page - 1) * limit);
  res.send(V.catalogPage({ user: req.user, profiles: cards, page, hasMore: all.length > page * limit }));
});

app.get('/profile/:id', (req, res) => {
  const p = Q.profileById.get(Number(req.params.id));
  if (!p || p.status === 'deleted') return res.status(404).send(V.notFoundPage(req.user));
  res.send(V.profilePage({
    user: req.user, profile: p,
    photos: Q.photosByProfile.all(p.id),
    contacts: Q.contactsByProfile.all(p.id),
  }));
});

// ── Авторизация (magic link) ─────────────────────────────────
app.get('/auth', (req, res) => res.send(V.authEnterPage({ next: req.query.next })));

app.post('/auth', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.send(V.authEnterPage({ next: req.body.next, error: 'Введите корректный email.' }));
  }
  const token = auth.createLoginToken(email);
  const link = `${config.BASE_URL}/auth/verify?token=${encodeURIComponent(token)}&next=${encodeURIComponent(req.body.next || '/')}`;
  try {
    await mailer.sendMagicLink(email, link);
  } catch (e) {
    console.error('mail error', e);
    return res.send(V.authEnterPage({ next: req.body.next, error: 'Не удалось отправить письмо. Попробуйте позже.' }));
  }
  res.send(V.authSentPage(email));
});

app.get('/auth/verify', (req, res) => {
  const email = auth.consumeLoginToken(String(req.query.token || ''));
  if (!email) return res.send(V.authEnterPage({ error: 'Ссылка недействительна или истекла. Запросите новую.' }));
  let user = Q.userByEmail.get(email);
  if (!user) {
    Q.insertUser.run(email, '');
    user = Q.userByEmail.get(email);
  }
  auth.setUserSession(res, user.id);
  res.cookie('age_ok', '1', { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax', path: '/' });
  const next = String(req.query.next || '');
  if (!user.gender) return res.redirect('/onboarding');
  res.redirect(next && next.startsWith('/') ? next : '/me');
});

app.post('/logout', (req, res) => { auth.clearUserSession(res); res.redirect('/'); });

// ── Онбординг ────────────────────────────────────────────────
app.get('/onboarding', auth.requireUser, (req, res) => {
  if (req.user.gender) return res.redirect('/me');
  res.send(V.onboardingPage({ user: req.user }));
});
app.post('/onboarding', auth.requireUser, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 64);
  const age = Number(req.body.age);
  const gender = req.body.gender === 'female' ? 'female' : req.body.gender === 'male' ? 'male' : null;
  if (!name || !age || age < 18 || age > 99 || !gender) {
    return res.send(V.onboardingPage({ user: req.user, error: 'Заполните все поля. Возраст от 18.' }));
  }
  Q.updateUserOnboard.run(name, age, gender, req.user.id);
  res.redirect('/me');
});

// ── Личный кабинет / анкета ──────────────────────────────────
app.get('/me', auth.requireUser, (req, res) => {
  if (!req.user.gender) return res.redirect('/onboarding');
  if (req.user.gender !== 'female') return res.send(V.maleHomePage({ user: req.user }));
  const profile = Q.profileByUser.get(req.user.id);
  res.send(V.profileFormPage({
    user: req.user,
    profile,
    contacts: profile ? Q.contactsByProfile.all(profile.id) : [],
    photos: profile ? Q.photosByProfile.all(profile.id) : [],
    mode: profile ? 'edit' : 'create',
  }));
});

function requireFemaleProfileOwner(req, res, next) {
  if (!req.user || req.user.gender !== 'female') return res.status(403).send(V.notFoundPage(req.user));
  req.profile = Q.profileByUser.get(req.user.id);
  next();
}

app.post('/profile', auth.requireUser, requireFemaleProfileOwner, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 64);
  const age = Number(req.body.age) || null;
  const district = String(req.body.district || '').trim().slice(0, 80);
  const short_desc = String(req.body.short_desc || '').trim().slice(0, config.SHORT_DESC_MAX);
  const full_desc = String(req.body.full_desc || '').trim();
  if (!name) {
    return res.send(V.profileFormPage({ user: req.user, profile: req.profile,
      contacts: req.profile ? Q.contactsByProfile.all(req.profile.id) : [],
      photos: req.profile ? Q.photosByProfile.all(req.profile.id) : [],
      mode: req.profile ? 'edit' : 'create', error: 'Укажите имя.' }));
  }
  let profileId;
  if (req.profile) {
    Q.updateProfile.run(name, age, district, short_desc, full_desc, req.profile.id);
    profileId = req.profile.id;
  } else {
    const info = Q.insertProfile.run(req.user.id, name, age, district, short_desc, full_desc);
    profileId = info.lastInsertRowid;
  }
  saveContacts(profileId, req.body);
  res.redirect('/me');
});

// Загрузка фото
const storage = multer.diskStorage({
  destination: (_r, _f, cb) => cb(null, config.UPLOAD_DIR),
  filename: (_r, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.(jpe?g|png|webp|gif)$/) || ['.jpg'])[0];
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: config.MAX_PHOTOS },
  fileFilter: (_r, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

app.post('/profile/photos', auth.requireUser, requireFemaleProfileOwner, upload.array('photos', config.MAX_PHOTOS), (req, res) => {
  if (!req.profile) return res.redirect('/me');
  let count = Q.countPhotos.get(req.profile.id).c;
  for (const f of req.files || []) {
    if (count >= config.MAX_PHOTOS) { try { fs.unlinkSync(f.path); } catch {} continue; }
    Q.insertPhoto.run(req.profile.id, f.filename, count, count === 0 ? 1 : 0);
    count++;
  }
  res.redirect('/me');
});

app.post('/profile/photos/:id/delete', auth.requireUser, requireFemaleProfileOwner, (req, res) => {
  const ph = Q.photoById.get(Number(req.params.id));
  if (ph && req.profile && ph.profile_id === req.profile.id) {
    try { fs.unlinkSync(path.join(config.UPLOAD_DIR, ph.filename)); } catch {}
    Q.deletePhoto.run(ph.id);
  }
  res.json({ ok: true });
});

app.post('/profile/hide', auth.requireUser, requireFemaleProfileOwner, (req, res) => {
  if (req.profile) Q.setStatus.run(req.profile.status === 'hidden' ? 'active' : 'hidden', req.profile.id);
  res.redirect('/me');
});
app.post('/profile/delete', auth.requireUser, requireFemaleProfileOwner, (req, res) => {
  if (req.profile) { deletePhotoFiles(req.profile.id); Q.setStatus.run('deleted', req.profile.id); }
  res.redirect('/me');
});

// ── SEO ──────────────────────────────────────────────────────
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${config.BASE_URL}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (_req, res) => {
  const urls = [`${config.BASE_URL}/`, `${config.BASE_URL}/catalog`];
  for (const p of Q.activePinned.all().concat(Q.activeUnpinned.all())) urls.push(`${config.BASE_URL}/profile/${p.id}`);
  for (const pg of Q.publishedPages.all()) urls.push(`${config.BASE_URL}/${pg.slug}`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') + `\n</urlset>`;
  res.type('application/xml').send(xml);
});

// ── Админка ──────────────────────────────────────────────────
app.get('/admin/login', (req, res) => res.send(A.adminLoginPage()));
app.post('/admin/login', (req, res) => {
  const ok = req.body.username === config.ADMIN_USER &&
    auth.verifyPassword(req.body.password || '', config.ADMIN_PASS_HASH);
  if (!ok) return res.send(A.adminLoginPage('Неверный логин или пароль.'));
  auth.setAdminSession(res);
  res.redirect('/admin');
});
app.post('/admin/logout', (req, res) => { auth.clearAdminSession(res); res.redirect('/admin/login'); });

app.use('/admin', auth.requireAdmin); // всё ниже — только для админа

app.get('/admin', (_req, res) => {
  res.send(A.adminDashboardPage({
    men: Q.countGender.get('male').c,
    women: Q.countGender.get('female').c,
    active: Q.countStatus.get('active').c,
    hidden: Q.countStatus.get('hidden').c,
    deleted: Q.countStatus.get('deleted').c,
  }));
});
app.get('/admin/profiles', (_req, res) => res.send(A.adminProfilesPage(Q.allProfilesAdmin.all())));
app.get('/admin/profiles/:id', (req, res) => {
  const p = Q.profileById.get(Number(req.params.id));
  if (!p) return res.redirect('/admin/profiles');
  res.send(A.adminProfileEditPage(p, Q.photosByProfile.all(p.id)));
});
app.post('/admin/profiles/:id', (req, res) => {
  const p = Q.profileById.get(Number(req.params.id));
  if (p) {
    const status = ['active', 'hidden', 'deleted'].includes(req.body.status) ? req.body.status : p.status;
    Q.adminUpdateProfile.run(
      String(req.body.name || '').slice(0, 64), Number(req.body.age) || null,
      String(req.body.district || '').slice(0, 80), String(req.body.short_desc || '').slice(0, config.SHORT_DESC_MAX),
      String(req.body.full_desc || ''), status, p.id);
    if (status === 'deleted') deletePhotoFiles(p.id);
  }
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

app.get('/admin/pages', (_req, res) => res.send(A.adminPagesPage(Q.allPages.all())));
app.get('/admin/pages/new', (_req, res) => res.send(A.adminPageEditPage(null)));
app.post('/admin/pages', (req, res) => {
  const b = req.body;
  const slug = String(b.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug || !b.title) return res.send(A.adminPageEditPage({ ...b }));
  try {
    Q.insertPage.run(slug, b.title, b.h1 || '', b.meta_description || '', b.keywords || '', b.body_html || '', b.published ? 1 : 0);
  } catch (e) { return res.send(A.adminPageEditPage({ ...b, slug })); }
  res.redirect('/admin/pages');
});
app.get('/admin/pages/:id', (req, res) => {
  const p = Q.pageById.get(Number(req.params.id));
  if (!p) return res.redirect('/admin/pages');
  res.send(A.adminPageEditPage(p));
});
app.post('/admin/pages/:id', (req, res) => {
  const b = req.body;
  const slug = String(b.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  Q.updatePage.run(slug, b.title, b.h1 || '', b.meta_description || '', b.keywords || '', b.body_html || '', b.published ? 1 : 0, Number(req.params.id));
  res.redirect('/admin/pages/' + req.params.id);
});
app.post('/admin/pages/:id/delete', (req, res) => { Q.deletePage.run(Number(req.params.id)); res.redirect('/admin/pages'); });

app.get('/admin/settings', (_req, res) => res.send(A.adminSettingsPage(getSettings())));
app.post('/admin/settings', (req, res) => {
  for (const k of ['home_title', 'home_description', 'home_keywords', 'home_intro']) {
    Q.setSetting.run(k, String(req.body[k] || ''));
  }
  res.redirect('/admin/settings');
});

// ── SEO посадочные страницы (catch-all, в самом конце) ───────
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
  if (!config.ADMIN_PASS_HASH) console.warn('⚠  ADMIN_PASS_HASH не задан — вход в админку недоступен. Сгенерируй хеш (см. README).');
});
