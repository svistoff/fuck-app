const config = require('./config');
const { CONTACTS, CONTACT_ORDER } = require('./contacts');

// ── Экранирование ────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function attr(s) { return esc(s); }
// Лёгкая разметка многострочного текста (без HTML от пользователя)
function nl2p(s) {
  return esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// ── Иконки контактов (простые глифы; для прода замени на официальные) ──
function icon(type) {
  const m = {
    phone: '<path d="M6 3h3l2 5-2 1c1 2 3 4 5 5l1-2 5 2v3c0 1-1 2-2 2C12 22 2 12 2 5c0-1 1-2 2-2z"/>',
    whatsapp: '<path d="M12 3a9 9 0 00-7.7 13.6L3 21l4.5-1.2A9 9 0 1012 3z" fill="none" stroke="currentColor" stroke-width="2"/>',
    telegram: '<path d="M21 4L3 11l5 2 2 6 3-4 5 4 3-15z"/>',
    bip: '<text x="12" y="17" font-size="13" font-weight="700" text-anchor="middle" fill="currentColor" font-family="system-ui">B</text>',
    max: '<text x="12" y="17" font-size="12" font-weight="700" text-anchor="middle" fill="currentColor" font-family="system-ui">M</text>',
    instagram: '<rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16.5" cy="7.5" r="1.1"/>',
  };
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">${m[type] || ''}</svg>`;
}

// Ряд контактных «чипов» — фирменный элемент. contacts = [{type, value}]
function contactChips(contacts, { big = false } = {}) {
  const items = (contacts || [])
    .map((c) => {
      const def = CONTACTS[c.type];
      if (!def) return '';
      const href = def.buildLink(c.value);
      if (!href) return '';
      const cls = big ? 'chip chip-lg' : 'chip';
      return `<a class="${cls}" href="${attr(href)}" target="_blank" rel="nofollow noopener"
                 aria-label="${attr(def.label)}" title="${attr(def.label)}">${icon(c.type)}</a>`;
    })
    .filter(Boolean)
    .join('');
  return items ? `<div class="chips">${items}</div>` : '';
}

// ── Шапка ────────────────────────────────────────────────────
function header(user) {
  const right = user
    ? `<a class="btn btn-ghost" href="/me">Моя страница</a>`
    : `<a class="btn btn-primary" href="/auth">Зарегистрироваться</a>`;
  return `<header class="site-header">
    <div class="wrap header-row">
      <a class="brand" href="/">${esc(config.SITE_NAME)}<span class="brand-dot">.</span></a>
      <nav class="header-nav">
        <a class="btn btn-ghost" href="/catalog">Анкеты</a>
        ${right}
      </nav>
    </div>
  </header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="wrap">
    <span>${esc(config.SITE_NAME)} — знакомства в ${esc(config.CITY_NAME)}</span>
    <a href="/catalog">Все анкеты</a>
  </div></footer>`;
}

// ── Каркас страницы ──────────────────────────────────────────
function layout({ title, description = '', keywords = '', canonical = '', body = '', user = null, bodyClass = '' }) {
  const fullTitle = title ? `${title}` : config.SITE_NAME;
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
<link rel="preconnect" href="${esc(config.BASE_URL)}">
<link rel="stylesheet" href="/css/styles.css">
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
<script>
  (function(){
    var y=document.getElementById('age-yes');
    if(y)y.addEventListener('click',function(){
      document.cookie='age_ok=1; max-age='+(365*24*3600)+'; path=/; samesite=lax';
      document.documentElement.classList.add('age-ok');
    });
  })();
</script>
<script src="/js/app.js" defer></script>
</body>
</html>`;
}

// ── Карточка анкеты в каталоге ───────────────────────────────
function profileCard(p) {
  const photo = p.main_photo ? `/uploads/${attr(p.main_photo)}` : '/img/placeholder.svg';
  return `<a class="card" href="/profile/${p.id}">
    <div class="card-photo" style="background-image:url('${photo}')"></div>
    <div class="card-body">
      <div class="card-name">${esc(p.name)}${p.age ? `, ${esc(p.age)}` : ''}</div>
      ${p.short_desc ? `<div class="card-desc">${esc(p.short_desc)}</div>` : ''}
      ${contactChips(p.contacts)}
    </div>
  </a>`;
}

// ── Публичные страницы ───────────────────────────────────────
function homePage({ user, profiles, settings }) {
  const intro = settings.home_intro
    || `Простой и быстрый сервис знакомств в ${config.CITY_NAME}. Девушки публикуют анкеты — вы смотрите и связываетесь напрямую.`;
  const grid = profiles.length
    ? `<div class="grid">${profiles.map(profileCard).join('')}</div>`
    : `<p class="empty">Пока нет анкет. Загляните позже.</p>`;
  const body = `
    <section class="hero">
      <h1>Знакомства в ${esc(config.CITY_NAME)}</h1>
      <p class="hero-sub">${esc(intro)}</p>
      <div class="hero-actions">
        <a class="btn btn-primary btn-lg" href="/auth">Создать анкету</a>
        <a class="btn btn-soft btn-lg" href="/catalog">Смотреть анкеты</a>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Свежие анкеты</h2><a href="/catalog">Все →</a></div>
      ${grid}
    </section>`;
  return layout({
    title: settings.home_title || `Знакомства в ${config.CITY_NAME} — ${config.SITE_NAME}`,
    description: settings.home_description || intro,
    keywords: settings.home_keywords || '',
    canonical: config.BASE_URL + '/',
    body, user,
  });
}

function catalogPage({ user, profiles, page, hasMore }) {
  const grid = profiles.length
    ? `<div class="grid">${profiles.map(profileCard).join('')}</div>`
    : `<p class="empty">Анкет пока нет.</p>`;
  const pager = `<div class="pager">
    ${page > 1 ? `<a class="btn btn-soft" href="/catalog?page=${page - 1}">← Назад</a>` : '<span></span>'}
    ${hasMore ? `<a class="btn btn-soft" href="/catalog?page=${page + 1}">Дальше →</a>` : '<span></span>'}
  </div>`;
  const body = `<h1>Анкеты в ${esc(config.CITY_NAME)}</h1>${grid}${pager}`;
  return layout({
    title: `Анкеты девушек в ${config.CITY_NAME} — ${config.SITE_NAME}`,
    description: `Каталог анкет в ${config.CITY_NAME}. Смотрите фото и контакты, связывайтесь напрямую.`,
    canonical: config.BASE_URL + '/catalog',
    body, user,
  });
}

function profilePage({ user, profile, photos, contacts }) {
  const gallery = photos.length
    ? `<div class="gallery">${photos.map((ph, i) =>
        `<div class="gallery-img${i === 0 ? ' main' : ''}" style="background-image:url('/uploads/${attr(ph.filename)}')"></div>`).join('')}</div>`
    : `<div class="gallery"><div class="gallery-img main" style="background-image:url('/img/placeholder.svg')"></div></div>`;
  const body = `
    <a class="back" href="/catalog">← К анкетам</a>
    <article class="profile">
      ${gallery}
      <div class="profile-head">
        <h1>${esc(profile.name)}${profile.age ? `, ${esc(profile.age)}` : ''}</h1>
        ${profile.district ? `<div class="muted">${esc(profile.district)}, ${esc(config.CITY_NAME)}</div>` : `<div class="muted">${esc(config.CITY_NAME)}</div>`}
      </div>
      ${profile.short_desc ? `<p class="lead">${esc(profile.short_desc)}</p>` : ''}
      ${profile.full_desc ? `<div class="prose">${nl2p(profile.full_desc)}</div>` : ''}
      <div class="contacts-block">
        <h2>Связаться</h2>
        ${contactChips(contacts, { big: true }) || '<p class="muted">Контакты не указаны.</p>'}
      </div>
    </article>`;
  const desc = profile.short_desc || `${profile.name}${profile.age ? `, ${profile.age}` : ''} — анкета в ${config.CITY_NAME}.`;
  return layout({
    title: `${profile.name}${profile.age ? `, ${profile.age}` : ''} — знакомства в ${config.CITY_NAME}`,
    description: desc,
    canonical: `${config.BASE_URL}/profile/${profile.id}`,
    body, user,
  });
}

function landingPage({ user, pageRow }) {
  const body = `<article class="prose-page">
    <h1>${esc(pageRow.h1 || pageRow.title)}</h1>
    ${pageRow.body_html || ''}
    <p><a class="btn btn-primary btn-lg" href="/catalog">Смотреть анкеты в ${esc(config.CITY_NAME)}</a></p>
  </article>`;
  return layout({
    title: pageRow.title,
    description: pageRow.meta_description || '',
    keywords: pageRow.keywords || '',
    canonical: `${config.BASE_URL}/${pageRow.slug}`,
    body, user,
  });
}

// ── Авторизация ──────────────────────────────────────────────
function authEnterPage({ next, error }) {
  const body = `<div class="card-panel narrow">
    <h1>Вход и регистрация</h1>
    <p class="muted">Введите email — пришлём ссылку для входа. Пароль не нужен.</p>
    ${error ? `<div class="alert">${esc(error)}</div>` : ''}
    <form method="POST" action="/auth">
      <input type="hidden" name="next" value="${attr(next || '/')}">
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

// ── Онбординг ────────────────────────────────────────────────
function onboardingPage({ user, error }) {
  const body = `<div class="card-panel narrow">
    <h1>Заполните профиль</h1>
    ${error ? `<div class="alert">${esc(error)}</div>` : ''}
    <form method="POST" action="/onboarding">
      <label class="field"><span>Имя</span>
        <input name="name" required value="${attr(user.name || '')}" placeholder="Как вас зовут">
      </label>
      <label class="field"><span>Возраст</span>
        <input name="age" type="number" min="18" max="99" required value="${attr(user.age || '')}">
      </label>
      <div class="field"><span>Пол</span>
        <div class="row gap">
          <label class="pill"><input type="radio" name="gender" value="female" required> Женский</label>
          <label class="pill"><input type="radio" name="gender" value="male"> Мужской</label>
        </div>
      </div>
      <button class="btn btn-primary btn-lg full">Продолжить</button>
    </form>
  </div>`;
  return layout({ title: 'Заполнение профиля', body, user, bodyClass: 'centered' });
}

// ── Форма анкеты (создание/редактирование, только женщины) ───
function profileFormPage({ user, profile, contacts, photos, mode, error }) {
  const cmap = {};
  (contacts || []).forEach((c) => { cmap[c.type] = c.value; });
  const contactFields = CONTACT_ORDER.map((type) => {
    const def = CONTACTS[type];
    return `<label class="field"><span>${esc(def.label)} <small class="muted">(${def.inputType === 'phone' ? 'номер' : 'username'})</small></span>
      <input name="contact_${type}" value="${attr(cmap[type] || '')}" placeholder="${attr(def.placeholder)}">
    </label>`;
  }).join('');

  const photoList = (photos || []).map((ph) =>
    `<div class="photo-thumb">
       <img src="/uploads/${attr(ph.filename)}" alt="">
       <button type="button" class="photo-del" data-id="${ph.id}" title="Удалить">×</button>
     </div>`).join('');

  const body = `<div class="card-panel">
    <h1>${mode === 'edit' ? 'Моя анкета' : 'Создание анкеты'}</h1>
    ${error ? `<div class="alert">${esc(error)}</div>` : ''}
    <form method="POST" action="/profile" id="profile-form">
      <label class="field"><span>Имя</span>
        <input name="name" required value="${attr(profile?.name || user.name || '')}"></label>
      <label class="field"><span>Возраст</span>
        <input name="age" type="number" min="18" max="99" value="${attr(profile?.age || user.age || '')}"></label>
      <label class="field"><span>Район / улица <small class="muted">(необязательно)</small></span>
        <input name="district" value="${attr(profile?.district || '')}" placeholder="Например, Центральный"></label>
      <label class="field"><span>Краткое описание <small class="muted">(до ${config.SHORT_DESC_MAX})</small></span>
        <textarea name="short_desc" maxlength="${config.SHORT_DESC_MAX}" rows="2"
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

    ${mode === 'edit' ? `<div class="row gap danger-zone">
      <form method="POST" action="/profile/hide"><button class="btn btn-soft">${profile.status === 'hidden' ? 'Показать анкету' : 'Скрыть анкету'}</button></form>
      <form method="POST" action="/profile/delete" onsubmit="return confirm('Удалить анкету и все фото?')"><button class="btn btn-danger">Удалить анкету</button></form>
    </div>` : ''}
  </div>`;
  return layout({ title: mode === 'edit' ? 'Моя анкета' : 'Создание анкеты', body, user });
}

// Страница мужчины (нет анкеты): просто ссылка в каталог
function maleHomePage({ user }) {
  const body = `<div class="card-panel narrow">
    <h1>Готово</h1>
    <p>Профиль заполнен. Смотрите анкеты и связывайтесь напрямую.</p>
    <a class="btn btn-primary btn-lg full" href="/catalog">Перейти к анкетам</a>
  </div>`;
  return layout({ title: 'Профиль', body, user, bodyClass: 'centered' });
}

function notFoundPage(user) {
  return layout({
    title: 'Страница не найдена',
    body: `<div class="card-panel narrow"><h1>404</h1><p>Такой страницы нет.</p><a class="btn btn-primary" href="/">На главную</a></div>`,
    user, bodyClass: 'centered',
  });
}

module.exports = {
  esc, layout, contactChips,
  homePage, catalogPage, profilePage, landingPage,
  authEnterPage, authSentPage, onboardingPage,
  profileFormPage, maleHomePage, notFoundPage,
};
