const fs = require('fs');
const path = require('path');
const config = require('./config');
const { CONTACTS, CONTACT_ORDER } = require('./contacts');
const DISTRICTS = require('./districts');

// Параметры анкеты (рост/вес/грудь/выезд/район) одной строкой для карточки
function statsLine(p) {
  const parts = [];
  if (p.height) parts.push(`${esc(p.height)} см`);
  if (p.weight) parts.push(`${esc(p.weight)} кг`);
  if (p.bust) parts.push(`грудь ${esc(p.bust)}`);
  if (p.outcall) parts.push('выезд');
  if (p.district) parts.push(esc(p.district));
  return parts.length ? `<div class="card-meta">${parts.join(' · ')}</div>` : '';
}
// <select> районов с выбранным значением
function districtSelect(value) {
  const opts = ['<option value="">— район —</option>']
    .concat(DISTRICTS.map((d) => `<option value="${attr(d)}"${d === value ? ' selected' : ''}>${esc(d)}</option>`));
  return `<select name="district">${opts.join('')}</select>`;
}

// ── Экранирование ────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function attr(s) { return esc(s); }
function nl2p(s) {
  return esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// ── Иконки мессенджеров (официальные SVG из файлов) ──────────
const ICON_DIR = path.join(config.ROOT, 'public', 'img', 'icons');
const ICON_MODE = { telegram: 'fill', whatsapp: 'fill', instagram: 'fill', phone: 'stroke', max: 'raw' };
const ICONS = {};
function loadIcons() {
  for (const name of Object.keys(ICON_MODE)) {
    try {
      let svg = fs.readFileSync(path.join(ICON_DIR, `${name}.svg`), 'utf8');
      svg = svg.replace(/<title>.*?<\/title>/gs, '').replace(/\srole="[^"]*"/g, '')
               .replace(/\swidth="[^"]*"/g, '').replace(/\sheight="[^"]*"/g, '');
      if (ICON_MODE[name] === 'fill') svg = svg.replace(/<svg /, '<svg fill="currentColor" ');
      ICONS[name] = svg.trim();
    } catch { ICONS[name] = ''; }
  }
}
loadIcons();
function icon(type) { return ICONS[type] || ''; }

// ── Бренд сайта (логотип/фавикон/аналитика/город) из настроек ─
let SITE = {
  name: config.SITE_NAME, logo: null, favicon: null,
  analytics: '', city: config.CITY_NAME, cityPrep: config.CITY_NAME,
};
function setSite(s) { SITE = { ...SITE, ...s }; }
function cityIn() { return SITE.cityPrep || SITE.city || config.CITY_NAME; }

// ── Контактные «чипы» ────────────────────────────────────────
function contactChips(contacts, { big = false } = {}) {
  const items = (contacts || []).map((c) => {
    const def = CONTACTS[c.type];
    if (!def) return '';
    const href = def.buildLink(c.value);
    if (!href) return '';
    const cls = `chip chip--${c.type}${big ? ' chip-lg' : ''}`;
    return `<a class="${cls}" href="${attr(href)}" target="_blank" rel="nofollow noopener"
               aria-label="${attr(def.label)}" title="${attr(def.label)}">${icon(c.type)}</a>`;
  }).filter(Boolean).join('');
  return items ? `<div class="chips">${items}</div>` : '';
}

// ── Шапка ────────────────────────────────────────────────────
function brandMark() {
  if (SITE.logo) return `<img class="brand-logo" src="/uploads/${attr(SITE.logo)}" alt="${attr(SITE.name)}">`;
  return `${esc(SITE.name)}<span class="brand-dot">.</span>`;
}
function header(user) {
  let right;
  if (!user) {
    right = `<a class="btn btn-primary" href="/auth">Регистрация</a>`;
  } else if (user.gender === 'female') {
    right = `<a class="btn btn-ghost" href="/me">Моя анкета</a>`;
  } else {
    right = `<a class="btn btn-ghost" href="/me">Кабинет</a>`;
  }
  return `<header class="site-header">
    <div class="wrap header-row">
      <a class="brand" href="/">${brandMark()}</a>
      <nav class="header-nav">
        ${right}
      </nav>
    </div>
  </header>`;
}
function footer() {
  return `<footer class="site-footer"><div class="wrap">
    <span>${esc(SITE.name)} — знакомства в ${esc(cityIn())}</span>
    <a href="/catalog">Все анкеты</a>
  </div></footer>`;
}

// ── Каркас страницы ──────────────────────────────────────────
function layout({ title, description = '', keywords = '', canonical = '', body = '',
                  user = null, bodyClass = '', ogImage = '', extraHead = '' }) {
  const fullTitle = title || SITE.name;
  const fav = SITE.favicon ? `/uploads/${attr(SITE.favicon)}` : '/img/favicon.svg';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
${description ? `<meta name="description" content="${attr(description)}">` : ''}
${keywords ? `<meta name="keywords" content="${attr(keywords)}">` : ''}
${canonical ? `<link rel="canonical" href="${attr(canonical)}">` : ''}
<meta property="og:title" content="${attr(fullTitle)}">
${description ? `<meta property="og:description" content="${attr(description)}">` : ''}
<meta property="og:type" content="website">
${ogImage ? `<meta property="og:image" content="${attr(ogImage)}">` : ''}
<link rel="icon" href="${fav}">
<link rel="stylesheet" href="/css/styles.css?v=${config.ASSET_VERSION}">
<style>
/* Критическая верстка карточки — встроена в HTML, не зависит от кэша внешнего CSS.
   Карточка: фото слева, текст справа, единым блоком. */
.grid{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr)) !important;gap:14px;margin-top:14px;align-items:stretch}
.grid > .card{position:relative;display:flex !important;flex-direction:row !important;align-items:stretch;min-height:172px;overflow:hidden;background:#fff;border:1px solid #ececf1;border-radius:16px;box-shadow:0 2px 14px rgba(20,24,40,.06);color:#16181d}
.grid > .card > .card-link{position:absolute;inset:0;z-index:1}
.grid > .card > .card-photo{flex:0 0 44% !important;max-width:175px;align-self:stretch;background-size:cover;background-position:center top;background-color:#fff0f2;position:relative}
.grid > .card > .card-photo.no-photo::after{content:'фото скоро';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e6396a;opacity:.55;font-size:.82rem}
.grid > .card > .card-body{flex:1 1 auto !important;min-width:0;padding:12px 14px;display:flex !important;flex-direction:column !important;align-items:flex-start}
.grid > .card > .card-body > .card-name{font-weight:700;font-size:1.02rem}
.grid > .card > .card-body > .card-desc{color:#6b7280;font-size:.9rem;margin-top:4px;overflow-wrap:anywhere}
.grid > .card > .card-body > .card-meta{color:#e6396a;font-size:.82rem;margin-top:6px;line-height:1.35}
.grid > .card > .card-body > .chips{position:relative;z-index:2;margin-top:auto;padding-top:10px;display:flex;flex-wrap:wrap;gap:8px}
.grid > .card-banner{position:relative;display:block;min-height:172px;overflow:hidden;border:1px solid #ececf1;border-radius:16px;box-shadow:0 2px 14px rgba(20,24,40,.06);background:#fff}
.grid > .card-banner > .banner{display:block;width:100%;height:100%}
.grid > .card-banner img{width:100%;height:100%;object-fit:cover;display:block}
</style>
${extraHead}
</head>
<body class="${attr(bodyClass)}">
<script>if(document.cookie.indexOf('age_ok=1')>-1)document.documentElement.classList.add('age-ok');</script>
${header(user)}
<main class="wrap main">${body}</main>
${footer()}
<div class="age-overlay" role="dialog" aria-label="Подтверждение возраста">
  <div class="age-box">
    <h2>Вам есть 18 лет?</h2>
    <p class="muted">Сайт предназначен только для совершеннолетних.</p>
    <div class="row gap" style="justify-content:center">
      <button class="btn btn-primary btn-lg" id="age-yes">Мне есть 18</button>
      <a class="btn btn-soft btn-lg" href="https://www.google.com">Нет</a>
    </div>
  </div>
</div>
<script>(function(){var y=document.getElementById('age-yes');if(y)y.addEventListener('click',function(){document.cookie='age_ok=1; max-age='+(365*24*3600)+'; path=/; samesite=lax';document.documentElement.classList.add('age-ok');});})();</script>
<div class="lightbox" id="lightbox" hidden>
  <button class="lb-close" type="button" aria-label="Закрыть">×</button>
  <button class="lb-prev" type="button" aria-label="Назад">‹</button>
  <img class="lb-img" src="" alt="">
  <button class="lb-next" type="button" aria-label="Вперёд">›</button>
</div>
<script src="/js/app.js?v=${config.ASSET_VERSION}" defer></script>
${SITE.analytics || ''}
</body>
</html>`;
}

// ── Карточки и лента ─────────────────────────────────────────
function profileCard(p) {
  const photoStyle = p.main_photo ? ` style="background-image:url('/uploads/${attr(p.main_photo)}')"` : '';
  return `<div class="card">
    <a class="card-link" href="/profile/${p.id}" aria-label="${attr(p.name)}"></a>
    <div class="card-photo${p.main_photo ? '' : ' no-photo'}"${photoStyle}></div>
    ${p.pinned ? '<span class="crown" title="Проверенная анкета">👑</span>' : ''}
    <div class="card-body">
      <div class="card-name">${esc(p.name)}${p.age ? `, ${esc(p.age)}` : ''}</div>
      ${p.short_desc ? `<div class="card-desc">${esc(p.short_desc)}</div>` : ''}
      ${statsLine(p)}
      ${contactChips(p.contacts)}
    </div>
  </div>`;
}
function bannerCard(b) {
  const img = `<img src="/uploads/${attr(b.filename)}" alt="${attr(b.title || 'Реклама')}" loading="lazy">`;
  // Клик идёт через /b/:id — там считается клик и делается редирект на целевой адрес
  const inner = b.link_url
    ? `<a class="banner" href="/b/${b.id}" target="_blank" rel="nofollow noopener sponsored">${img}</a>`
    : `<div class="banner">${img}</div>`;
  return `<div class="card-banner"><span class="banner-label">Реклама</span>${inner}</div>`;
}

// Выбор баннера для позиции показа n (1-я вставка, 2-я вставка, …):
// если на эту позицию закреплён баннер (slot === n) — берём его,
// иначе случайный из незакреплённых.
function pickBanner(banners, n) {
  const pinned = banners.find((b) => Number(b.slot) === n);
  if (pinned) return pinned;
  const pool = banners.filter((b) => !Number(b.slot));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
// Лента: после каждых 5 анкет — баннер (по кругу, если их несколько)
// Баннер вставляется после каждых N анкет (по кругу, если баннеров несколько)
const BANNER_EVERY_DEFAULT = 10;
// every — через сколько анкет вставлять баннер; startIndex — сколько анкет уже было выше
// (нужно для подгружаемых страниц, чтобы счёт не сбивался); onShow — колбэк для счётчика показов.
function feed(profiles, banners, { every = BANNER_EVERY_DEFAULT, startIndex = 0, onShow = null } = {}) {
  const out = [];
  const step = Math.max(1, Number(every) || BANNER_EVERY_DEFAULT);
  profiles.forEach((p, i) => {
    out.push(profileCard(p));
    const absolute = startIndex + i + 1;
    if (banners && banners.length && absolute % step === 0) {
      const n = absolute / step;                 // порядковый номер вставки
      const b = pickBanner(banners, n);
      if (b) { out.push(bannerCard(b)); if (onShow) onShow(b.id); }
    }
  });
  return out.join('');
}

// ── Публичные страницы ───────────────────────────────────────
// Главная = вся лента анкет с автоподгрузкой (отдельной страницы каталога больше нет).
function homePage({ user, profiles, banners, hasMore, settings, feedOpts = {} }) {
  const intro = settings.home_intro
    || `Простой и быстрый сервис знакомств в ${cityIn()}. Девушки размещают анкеты — вы смотрите и связываетесь напрямую.`;
  const grid = profiles.length
    ? `<div class="grid" id="feed">${feed(profiles, banners, feedOpts)}</div>`
    : `<p class="empty">Пока нет анкет. Загляните позже.</p>`;
  // Первая порция — серверным HTML (для индексации), далее app.js догружает при прокрутке.
  const sentinel = profiles.length
    ? `<div id="feed-sentinel" data-next="2" data-more="${hasMore ? '1' : '0'}"></div>
       <div id="feed-loading" class="feed-loading" hidden>Загрузка…</div>`
    : '';
  const cta = !user
    ? `<div class="hero-actions"><a class="btn btn-primary btn-lg" href="/auth">Регистрация</a></div>`
    : (user.gender === 'female'
        ? `<div class="hero-actions"><a class="btn btn-primary btn-lg" href="/me">Разместить анкету</a></div>`
        : '');
  const body = `
    <section class="hero hero-compact">
      <h1>Знакомства в ${esc(cityIn())}</h1>
      <p class="hero-sub">${esc(intro)}</p>
      ${cta}
    </section>
    ${grid}${sentinel}`;
  return layout({
    title: settings.home_title || `Знакомства в ${cityIn()} — ${SITE.name}`,
    description: settings.home_description || intro,
    keywords: settings.home_keywords || '',
    canonical: config.BASE_URL + '/',
    body, user,
  });
}

function photoCarousel(photos) {
  if (!photos.length) {
    return `<div class="carousel single"><div class="carousel-track"><div class="slide"><img src="/img/placeholder.svg" alt=""></div></div></div>`;
  }
  const slides = photos.map((ph) =>
    `<div class="slide"><img src="/uploads/${attr(ph.filename)}" alt="" loading="lazy" data-full="/uploads/${attr(ph.filename)}"></div>`).join('');
  const single = photos.length === 1 ? ' single' : '';
  const nav = photos.length > 1
    ? `<button class="carousel-btn prev" type="button" aria-label="Назад">‹</button>
       <button class="carousel-btn next" type="button" aria-label="Вперёд">›</button>
       <div class="carousel-dots">${photos.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
    : '';
  return `<div class="carousel${single}" data-carousel><div class="carousel-track">${slides}</div>${nav}</div>`;
}

function statsBlock(p) {
  const rows = [];
  if (p.height) rows.push(['Рост', `${esc(p.height)} см`]);
  if (p.weight) rows.push(['Вес', `${esc(p.weight)} кг`]);
  if (p.bust) rows.push(['Грудь', esc(p.bust)]);
  if (p.district) rows.push(['Район', esc(p.district)]);
  rows.push(['Выезд', p.outcall ? 'да' : 'нет']);
  return `<div class="stats-grid">${rows.map(([k, v]) =>
    `<div class="sg-item"><span class="sg-k">${k}</span><span class="sg-v">${v}</span></div>`).join('')}</div>`;
}

function profilePage({ user, profile, photos, contacts }) {
  const mainPhoto = photos[0] ? `${config.BASE_URL}/uploads/${photos[0].filename}` : '';
  const desc = profile.short_desc || `${profile.name}${profile.age ? `, ${profile.age}` : ''} — анкета в ${cityIn()}.`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Person',
    name: profile.name, address: { '@type': 'PostalAddress', addressLocality: SITE.city },
  };
  if (mainPhoto) ld.image = mainPhoto;
  const reportBlock = (user && user.gender === 'male')
    ? `<div class="report-block">
         <details>
           <summary class="report-toggle">Пожаловаться на анкету</summary>
           <form method="POST" action="/profile/${profile.id}/report" class="report-form">
             <label class="field"><span>Причина жалобы</span>
               <textarea name="reason" rows="3" required placeholder="Опишите, что не так с этой анкетой…"></textarea></label>
             <button class="btn btn-soft">Отправить жалобу</button>
           </form>
         </details>
       </div>`
    : '';
  const body = `
    <a class="back" href="/">← К анкетам</a>
    <article class="profile">
      ${photoCarousel(photos)}
      <div class="profile-head">
        <h1>${esc(profile.name)}${profile.age ? `, ${esc(profile.age)}` : ''}${profile.pinned ? ' <span class="crown-inline" title="Проверенная анкета">👑</span>' : ''}</h1>
        <div class="muted">${profile.district ? esc(profile.district) + ', ' : ''}${esc(SITE.city)}</div>
      </div>
      ${profile.short_desc ? `<p class="lead">${esc(profile.short_desc)}</p>` : ''}
      ${statsBlock(profile)}
      ${profile.full_desc ? `<div class="prose">${nl2p(profile.full_desc)}</div>` : ''}
      <div class="contacts-block">
        <h2>Связаться</h2>
        ${contactChips(contacts, { big: true }) || '<p class="muted">Контакты не указаны.</p>'}
      </div>
      ${reportBlock}
    </article>`;
  return layout({
    title: `${profile.name}${profile.age ? `, ${profile.age}` : ''} — знакомства в ${cityIn()}`,
    description: desc, canonical: `${config.BASE_URL}/profile/${profile.id}`,
    ogImage: mainPhoto, body, user,
    extraHead: `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  });
}

function landingPage({ user, pageRow }) {
  const body = `<article class="prose-page">
    <h1>${esc(pageRow.h1 || pageRow.title)}</h1>
    ${pageRow.body_html || ''}
    <p><a class="btn btn-primary btn-lg" href="/catalog">Смотреть анкеты в ${esc(cityIn())}</a></p>
  </article>`;
  return layout({
    title: pageRow.title, description: pageRow.meta_description || '',
    keywords: pageRow.keywords || '', canonical: `${config.BASE_URL}/${pageRow.slug}`,
    body, user,
  });
}

// ── Встраиваемый виджет (iframe) ─────────────────────────────
function embedPage({ profiles, ref }) {
  const site = config.BASE_URL + (ref ? `/?ref=${encodeURIComponent(ref)}` : '/');
  const cards = profiles.map((p) => {
    const photo = p.main_photo ? `/uploads/${attr(p.main_photo)}` : '/img/placeholder.svg';
    const href = `${config.BASE_URL}/profile/${p.id}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
    return `<a class="ec" href="${attr(href)}" target="_blank" rel="noopener">
      <div class="ec-photo" style="background-image:url('${photo}')"></div>
      <div class="ec-name">${esc(p.name)}${p.age ? `, ${esc(p.age)}` : ''}</div>
    </a>`;
  }).join('');
  // Самодостаточный документ: свои стили, без шапки сайта и без 18+ оверлея
  return `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(SITE.name)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:transparent;color:#16181d}
  .ew{padding:10px}
  .ew-title{font-weight:700;font-size:14px;margin:0 0 8px}
  .ec-row{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory}
  .ec{flex:0 0 120px;scroll-snap-align:start;text-decoration:none;color:inherit}
  .ec-photo{width:120px;height:150px;border-radius:12px;background:#fff0f2 center/cover no-repeat;border:1px solid #ececf1}
  .ec-name{font-size:13px;font-weight:600;margin-top:6px}
  .ew-btn{display:block;text-align:center;margin-top:10px;padding:11px;border-radius:12px;
    background:#ff5a6e;color:#fff;text-decoration:none;font-weight:600;font-size:14px}
</style></head>
<body><div class="ew">
  <p class="ew-title">Знакомства в ${esc(cityIn())}</p>
  <div class="ec-row">${cards || '<span style="color:#6b7280;font-size:13px">Скоро здесь появятся анкеты</span>'}</div>
  <a class="ew-btn" href="${attr(site)}" target="_blank" rel="noopener">Перейти на сайт →</a>
</div></body></html>`;
}

// ── Авторизация ──────────────────────────────────────────────
function authEnterPage({ next, error }) {
  const body = `<div class="card-panel narrow">
    <h1>Размещение анкеты</h1>
    <p class="muted">Введите email — пришлём ссылку для входа. Пароль не нужен.</p>
    ${error ? `<div class="alert">${esc(error)}</div>` : ''}
    <form method="POST" action="/auth">
      <input type="hidden" name="next" value="${attr(next || '/')}">
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="field"><span>Email</span>
        <input type="email" name="email" required placeholder="you@example.com" autocomplete="email">
      </label>
      <button class="btn btn-primary btn-lg full">Получить ссылку</button>
    </form>
  </div>`;
  return layout({ title: 'Вход', body, bodyClass: 'centered' });
}
function authSentPage(email) {
  const body = `<div class="card-panel narrow">
    <h1>Проверьте почту</h1>
    <p>Мы отправили ссылку для входа на <b>${esc(email)}</b>. Откройте письмо и нажмите «Войти».</p>
    <p class="muted">Ссылка действует 30 минут. Не пришло — проверьте папку «Спам».</p>
  </div>`;
  return layout({ title: 'Ссылка отправлена', body, bodyClass: 'centered' });
}

// ── Онбординг (без пола) ─────────────────────────────────────
function onboardingPage({ user, error }) {
  const body = `<div class="card-panel narrow">
    <h1>Несколько слов о себе</h1>
    ${error ? `<div class="alert">${esc(error)}</div>` : ''}
    <form method="POST" action="/onboarding">
      <label class="field"><span>Имя</span>
        <input name="name" required value="${attr(user.name || '')}" placeholder="Как вас зовут"></label>
      <label class="field"><span>Возраст</span>
        <input name="age" type="number" min="18" max="99" required value="${attr(user.age || '')}"></label>
      <div class="field"><span>Пол</span>
        <div class="row gap gender-row">
          <label class="pill"><input type="radio" name="gender" value="female" required${user.gender === 'female' ? ' checked' : ''}> Женский</label>
          <label class="pill"><input type="radio" name="gender" value="male" required${user.gender === 'male' ? ' checked' : ''}> Мужской</label>
        </div>
        <small class="muted">Женщины размещают анкеты. Мужчины смотрят анкеты и могут пожаловаться на нарушение.</small>
      </div>
      <button class="btn btn-primary btn-lg full">Продолжить</button>
    </form>
  </div>`;
  return layout({ title: 'О себе', body, user, bodyClass: 'centered' });
}

// ── Форма анкеты ─────────────────────────────────────────────
function profileFormPage({ user, profile, contacts, photos, mode, error, bumpInfo = { canBump: true, waitText: '' } }) {
  const cmap = {};
  (contacts || []).forEach((c) => { cmap[c.type] = c.value; });
  const contactFields = CONTACT_ORDER.map((type) => {
    const def = CONTACTS[type];
    return `<label class="field"><span>${esc(def.label)} <small class="muted">(${def.inputType === 'phone' ? 'номер' : 'username'})</small></span>
      <input name="contact_${type}" value="${attr(cmap[type] || '')}" placeholder="${attr(def.placeholder)}"></label>`;
  }).join('');
  const photoList = (photos || []).map((ph) =>
    `<div class="photo-thumb${ph.is_main ? ' is-main' : ''}">
       <img src="/uploads/${attr(ph.filename)}" alt="">
       ${ph.is_main ? '<span class="main-badge">Главное</span>'
         : `<form method="POST" action="/profile/photos/${ph.id}/main" class="make-main"><button type="submit" title="Сделать главной">★</button></form>`}
       <button type="button" class="photo-del" data-id="${ph.id}" title="Удалить">×</button>
     </div>`).join('');
  const body = `<div class="card-panel">
    <h1>${mode === 'edit' ? 'Моя анкета' : 'Создание анкеты'}</h1>
    ${error ? `<div class="alert">${esc(error)}</div>` : ''}
    <form method="POST" action="/profile" id="profile-form">
      <label class="field"><span>Имя</span><input name="name" required value="${attr(profile?.name || user.name || '')}"></label>
      <label class="field"><span>Возраст</span><input name="age" type="number" min="18" max="99" value="${attr(profile?.age || user.age || '')}"></label>
      <label class="field"><span>Район</span>${districtSelect(profile?.district || '')}</label>
      <div class="row gap">
        <label class="field"><span>Рост, см</span><input name="height" type="number" min="120" max="220" value="${attr(profile?.height || '')}"></label>
        <label class="field"><span>Вес, кг</span><input name="weight" type="number" min="30" max="200" value="${attr(profile?.weight || '')}"></label>
        <label class="field"><span>Грудь</span><input name="bust" type="number" min="1" max="10" value="${attr(profile?.bust || '')}"></label>
      </div>
      <label class="pill"><input type="checkbox" name="outcall" value="1"${profile?.outcall ? ' checked' : ''}> Выезд</label>
      <label class="field"><span>Краткое описание <small class="muted">(до ${config.SHORT_DESC_MAX} символов)</small></span>
        <textarea name="short_desc" maxlength="${config.SHORT_DESC_MAX}" rows="3"
          placeholder="Люблю путешествия, кофе и прогулки по вечерам.">${esc(profile?.short_desc || '')}</textarea></label>
      <label class="field"><span>Полное описание</span>
        <textarea name="full_desc" rows="6" placeholder="Расскажите о себе…">${esc(profile?.full_desc || '')}</textarea></label>
      <h2 class="sub">Контакты <small class="muted">(любые, по желанию)</small></h2>
      ${contactFields}
      <button class="btn btn-primary btn-lg full">${mode === 'edit' ? 'Сохранить' : 'Опубликовать анкету'}</button>
    </form>
    <h2 class="sub">Фотографии <small class="muted">(1 основное + до ${config.MAX_PHOTOS - 1})</small></h2>
    <div class="photos" id="photos">${photoList || '<p class="muted">Фото пока нет.</p>'}</div>
    ${profile ? `<form id="upload-form" method="POST" action="/profile/photos" enctype="multipart/form-data">
        <input type="file" name="photos" accept="image/*" multiple>
        <button class="btn btn-soft">Загрузить фото</button>
      </form>` : `<p class="muted">Сначала сохраните анкету, затем добавьте фото.</p>`}
    ${mode === 'edit' ? `<div class="bump-block">
      <h2 class="sub">Поднять анкету</h2>
      ${bumpInfo.canBump
        ? `<p class="muted">Анкета поднимется в самый верх списка. Доступно раз в 12 часов.</p>
           <form method="POST" action="/profile/bump"><button class="btn btn-primary">Поднять наверх</button></form>`
        : `<p class="muted">Анкета уже поднята. Следующее поднятие будет доступно через ${esc(bumpInfo.waitText)}.</p>
           <button class="btn btn-soft" disabled>Поднять наверх</button>`}
    </div>` : ''}
    ${mode === 'edit' ? `<div class="row gap danger-zone">
      <form method="POST" action="/profile/hide"><button class="btn btn-soft">${profile.status === 'hidden' ? 'Показать анкету' : 'Скрыть анкету'}</button></form>
      <form method="POST" action="/profile/delete" onsubmit="return confirm('Удалить анкету и все фото?')"><button class="btn btn-danger">Удалить анкету</button></form>
    </div>` : ''}
  </div>`;
  return layout({ title: mode === 'edit' ? 'Моя анкета' : 'Создание анкеты', body, user });
}

// ── Блокировка + апелляция ───────────────────────────────────
function blockedPage({ email, sent, error }) {
  const inner = sent
    ? `<h1>Апелляция отправлена</h1>
       <p>Сообщение получено и будет рассмотрено администратором. Если решение изменится — доступ восстановят.</p>`
    : `<h1>Доступ ограничен</h1>
       <p class="muted">Ваш доступ к сайту заблокирован администратором. Вы можете подать апелляцию — она попадёт администратору на рассмотрение.</p>
       ${error ? `<div class="alert">${esc(error)}</div>` : ''}
       <form method="POST" action="/appeal">
         <input type="hidden" name="email" value="${attr(email || '')}">
         <label class="field"><span>Ваше сообщение</span>
           <textarea name="message" rows="5" required placeholder="Опишите ситуацию…"></textarea></label>
         <button class="btn btn-primary btn-lg full">Подать апелляцию</button>
       </form>`;
  // отдельный простой каркас, без шапки/каталога (доступ закрыт)
  return layout({ title: 'Доступ ограничен', body: `<div class="card-panel narrow">${inner}</div>`, bodyClass: 'centered' });
}

// Кабинет мужчины: анкету не размещает, но может жаловаться со страниц анкет
function maleCabinetPage({ user, myReports }) {
  const list = (myReports || []).map((r) => {
    const when = new Date((r.created_at || 0) * 1000).toLocaleDateString('ru-RU');
    return `<li>Жалоба на анкету #${r.profile_id} от ${esc(when)} — ${r.resolved ? 'рассмотрена' : 'на рассмотрении'}</li>`;
  }).join('');
  const body = `<div class="card-panel narrow">
    <h1>Кабинет</h1>
    <p class="muted">Вы вошли как ${esc(user.name || user.email)}. Анкеты размещают только девушки.</p>
    <p>Если анкета показалась мошеннической — откройте её и нажмите «Пожаловаться на анкету». Жалобу рассмотрит администратор.</p>
    ${list ? `<h2 class="sub">Ваши жалобы</h2><ul class="muted">${list}</ul>` : ''}
    <a class="btn btn-primary" href="/">К анкетам</a>
    <form method="POST" action="/logout" style="margin-top:12px"><button class="btn btn-soft">Выйти</button></form>
  </div>`;
  return layout({ title: 'Кабинет', body, user, bodyClass: 'centered' });
}

function notFoundPage(user) {
  return layout({
    title: 'Страница не найдена',
    body: `<div class="card-panel narrow"><h1>404</h1><p>Такой страницы нет.</p><a class="btn btn-primary" href="/">На главную</a></div>`,
    user, bodyClass: 'centered',
  });
}

module.exports = {
  esc, layout, contactChips, setSite, icon, feed,
  homePage, profilePage, landingPage, embedPage,
  authEnterPage, authSentPage, onboardingPage, profileFormPage, notFoundPage,
  blockedPage, maleCabinetPage,
};
