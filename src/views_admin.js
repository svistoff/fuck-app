const config = require('./config');
const { layout, esc } = require('./views');
const { CONTACTS, CONTACT_ORDER } = require('./contacts');
const DISTRICTS = require('./districts');

function adminDistrictSelect(value) {
  const opts = ['<option value="">— район —</option>']
    .concat(DISTRICTS.map((d) => `<option value="${esc(d)}"${d === value ? ' selected' : ''}>${esc(d)}</option>`));
  return `<select name="district">${opts.join('')}</select>`;
}

function adminLayout(title, body) {
  const nav = `<nav class="admin-nav">
    <a href="/admin">Сводка</a>
    <a href="/admin/profiles">Анкеты</a>
    <a href="/admin/banners">Баннеры</a>
    <a href="/admin/reports">Жалобы</a>
    <a href="/admin/appeals">Апелляции</a>
    <a href="/admin/pages">SEO-страницы</a>
    <a href="/admin/settings">Настройки</a>
    <form method="POST" action="/admin/logout"><button class="linklike">Выйти</button></form>
  </nav>`;
  return layout({
    title: `Админка — ${title}`, bodyClass: 'admin',
    body: `<div class="admin-wrap"><h1 class="admin-title">${esc(title)}</h1>${nav}${body}</div>`,
  });
}

function adminLoginPage(error) {
  return layout({
    title: 'Вход в админку', bodyClass: 'centered',
    body: `<div class="card-panel narrow">
      <h1>Админка</h1>
      ${error ? `<div class="alert">${esc(error)}</div>` : ''}
      <form method="POST" action="/admin/login">
        <label class="field"><span>Логин</span><input name="username" required autocomplete="username"></label>
        <label class="field"><span>Пароль</span><input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn btn-primary btn-lg full">Войти</button>
      </form>
    </div>`,
  });
}

function statRow(label, value) {
  return `<div class="stat"><div class="stat-num">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`;
}
function adminDashboardPage(stats) {
  const body = `<div class="stats">
    ${statRow('Зарегистрировано', stats.users)}
    ${statRow('Активных анкет', stats.active)}
    ${statRow('Скрытых', stats.hidden)}
    ${statRow('Удалённых', stats.deleted)}
    ${statRow('Баннеров', stats.banners)}
    ${statRow('Заблокировано', stats.blocked)}
    ${statRow('Жалоб', stats.reports)}
    ${statRow('Апелляций', stats.appeals)}
  </div>`;
  return adminLayout('Сводка', body);
}

function adminProfilesPage(rows) {
  const tr = rows.map((r) => `<tr>
    <td>${r.id}</td><td>${esc(r.name)}</td><td>${esc(r.age || '')}</td>
    <td><span class="badge badge-${r.status}">${esc(r.status)}</span>${r.pinned ? ' 📌' : ''}</td>
    <td>${r.photos_cnt}</td>
    <td class="row gap">
      <a class="btn btn-soft sm" href="/admin/profiles/${r.id}">Открыть</a>
      <form method="POST" action="/admin/profiles/${r.id}/pin"><button class="btn btn-soft sm">${r.pinned ? 'Открепить' : 'Закрепить'}</button></form>
    </td></tr>`).join('');
  const body = `<a class="btn btn-primary" href="/admin/profiles/new">+ Добавить анкету</a>
    <table class="table">
      <thead><tr><th>ID</th><th>Имя</th><th>Возраст</th><th>Статус</th><th>Фото</th><th></th></tr></thead>
      <tbody>${tr || '<tr><td colspan="6" class="muted">Анкет нет.</td></tr>'}</tbody>
    </table>`;
  return adminLayout('Анкеты', body);
}

function contactFields(contacts) {
  const cmap = {};
  (contacts || []).forEach((c) => { cmap[c.type] = c.value; });
  return CONTACT_ORDER.map((type) => {
    const def = CONTACTS[type];
    return `<label class="field"><span>${esc(def.label)} <small class="muted">(${def.inputType === 'phone' ? 'номер' : 'username'})</small></span>
      <input name="contact_${type}" value="${esc(cmap[type] || '')}" placeholder="${esc(def.placeholder)}"></label>`;
  }).join('');
}

// Создание (profile=null) и редактирование анкеты админом
function adminProfileEditPage(profile, photos, contacts) {
  const isNew = !profile;
  const action = isNew ? '/admin/profiles' : `/admin/profiles/${profile.id}`;
  const statusSel = isNew ? '' : `<label class="field"><span>Статус</span>
      <select name="status">${['active', 'hidden', 'deleted'].map((s) => `<option value="${s}"${profile.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label>`;
  const photoBlock = isNew
    ? `<p class="muted">Сохраните анкету, затем добавьте фото.</p>`
    : `<div class="photos">${(photos || []).map((ph) =>
        `<div class="photo-thumb${ph.is_main ? ' is-main' : ''}"><img src="/uploads/${esc(ph.filename)}" alt="">
           ${ph.is_main ? '<span class="main-badge">Главное</span>'
             : `<form method="POST" action="/admin/profiles/${profile.id}/photos/${ph.id}/main" class="make-main"><button title="Сделать главной">★</button></form>`}
           <form method="POST" action="/admin/profiles/${profile.id}/photos/${ph.id}/delete"><button class="photo-del" title="Удалить">×</button></form>
         </div>`).join('') || '<p class="muted">Нет фото.</p>'}</div>
       <form method="POST" action="/admin/profiles/${profile.id}/photos" enctype="multipart/form-data">
         <input type="file" name="photos" accept="image/*" multiple>
         <button class="btn btn-soft">Загрузить фото</button></form>`;
  const blockBlock = (!isNew && profile.user_id)
    ? `<form method="POST" action="/admin/users/${profile.user_id}/${profile.user_blocked ? 'unblock' : 'block'}" style="margin-top:12px">
         <button class="btn ${profile.user_blocked ? 'btn-soft' : 'btn-danger'}">${profile.user_blocked ? 'Разблокировать пользователя' : 'Заблокировать пользователя'}</button>
       </form>`
    : (!isNew ? '<p class="muted" style="margin-top:12px">Анкета без аккаунта — блокировка не применяется.</p>' : '');
  const body = `<a class="back" href="/admin/profiles">← К списку</a>
    <div class="card-panel">
      <form method="POST" action="${action}">
        <label class="field"><span>Имя</span><input name="name" required value="${esc(profile?.name || '')}"></label>
        <label class="field"><span>Возраст</span><input name="age" type="number" value="${esc(profile?.age || '')}"></label>
        <label class="field"><span>Район</span>${adminDistrictSelect(profile?.district || '')}</label>
        <div class="row gap">
          <label class="field"><span>Рост, см</span><input name="height" type="number" value="${esc(profile?.height || '')}"></label>
          <label class="field"><span>Вес, кг</span><input name="weight" type="number" value="${esc(profile?.weight || '')}"></label>
          <label class="field"><span>Грудь</span><input name="bust" type="number" value="${esc(profile?.bust || '')}"></label>
        </div>
        <label class="pill"><input type="checkbox" name="outcall" value="1"${profile?.outcall ? ' checked' : ''}> Выезд</label>
        <label class="field"><span>Краткое описание</span><textarea name="short_desc" rows="3">${esc(profile?.short_desc || '')}</textarea></label>
        <label class="field"><span>Полное описание</span><textarea name="full_desc" rows="5">${esc(profile?.full_desc || '')}</textarea></label>
        ${statusSel}
        <h2 class="sub">Контакты</h2>
        ${contactFields(contacts)}
        <button class="btn btn-primary">${isNew ? 'Создать анкету' : 'Сохранить'}</button>
      </form>
      <h2 class="sub">Фотографии</h2>
      ${photoBlock}
      ${blockBlock}
      ${isNew ? '' : `<form method="POST" action="/admin/profiles/${profile.id}/delete" onsubmit="return confirm('Удалить анкету полностью?')" style="margin-top:16px">
        <button class="btn btn-danger">Удалить анкету</button></form>`}
    </div>`;
  return adminLayout(isNew ? 'Новая анкета' : 'Анкета #' + profile.id, body);
}

function adminBannersPage(rows, every) {
  const fmtDate = (t) => t ? new Date(t * 1000).toLocaleDateString('ru-RU') : '';
  const forInput = (t) => {
    if (!t) return '';
    const d = new Date(t * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const list = rows.map((b) => {
    const expired = b.expires_at && b.expires_at < now;
    const ctr = b.views ? ((b.clicks / b.views) * 100).toFixed(1) : '0.0';
    const state = !b.active ? 'выключен' : (expired ? 'истёк' : 'показывается');
    return `<div class="banner-admin">
      <img src="/uploads/${esc(b.filename)}" alt="">
      <div class="banner-admin-info">
        <div><b>${esc(b.title || 'Без названия')}</b> — <span class="muted">${esc(state)}</span></div>
        <div class="muted">Показы: ${b.views} · Клики: ${b.clicks} · CTR: ${ctr}%</div>
        <div class="muted">${b.slot ? 'Закреплён на позиции ' + b.slot : 'В случайной ротации'}${b.expires_at ? ' · до ' + fmtDate(b.expires_at) : ' · бессрочно'}</div>
        <form method="POST" action="/admin/banners/${b.id}/update" class="banner-edit">
          <input name="link_url" value="${esc(b.link_url || '')}" placeholder="https://...">
          <input name="title" value="${esc(b.title || '')}" placeholder="Название">
          <input name="slot" type="number" min="0" value="${esc(b.slot || 0)}" title="0 = случайная ротация, 1 = всегда первый показ, 2 = второй…" style="width:70px">
          <input name="expires_at" type="date" value="${forInput(b.expires_at)}" title="Пусто = бессрочно">
          <button class="btn btn-soft sm">Сохранить</button>
        </form>
      </div>
      <div class="row gap">
        <form method="POST" action="/admin/banners/${b.id}/toggle"><button class="btn btn-soft sm">${b.active ? 'Выключить' : 'Включить'}</button></form>
        <form method="POST" action="/admin/banners/${b.id}/reset-stats"><button class="btn btn-soft sm">Сброс статистики</button></form>
        <form method="POST" action="/admin/banners/${b.id}/delete" onsubmit="return confirm('Удалить баннер?')"><button class="btn btn-danger sm">Удалить</button></form>
      </div>
    </div>`;
  }).join('');
  const body = `<div class="card-panel">
    <h2 style="margin-top:0">Частота показа</h2>
    <form method="POST" action="/admin/banners/frequency" class="row gap" style="align-items:flex-end">
      <label class="field" style="margin:0"><span>Баннер после каждых N анкет</span>
        <input name="banner_every" type="number" min="1" max="100" value="${esc(every)}" style="width:110px"></label>
      <button class="btn btn-primary">Сохранить</button>
    </form>
  </div>
  <div class="card-panel" style="margin-top:16px">
    <h2 style="margin-top:0">Добавить баннер</h2>
    <p class="muted">Рекомендуемый размер: 760×440 px. Картинка обрезается по центру под размер плитки — держите текст и логотип в центральной зоне, отступив ~12% от краёв.</p>
    <form method="POST" action="/admin/banners" enctype="multipart/form-data">
      <label class="field"><span>Картинка</span><input type="file" name="image" accept="image/*" required></label>
      <label class="field"><span>Ссылка</span><input name="link_url" placeholder="https://..."></label>
      <label class="field"><span>Название (для себя)</span><input name="title"></label>
      <label class="field"><span>Позиция <small class="muted">(0 = случайная ротация, 1 = всегда первый показ, 2 = второй…)</small></span>
        <input name="slot" type="number" min="0" value="0"></label>
      <label class="field"><span>Показывать до <small class="muted">(пусто = бессрочно)</small></span>
        <input name="expires_at" type="date"></label>
      <button class="btn btn-primary">Добавить баннер</button>
    </form>
  </div>
  <div class="banners-list">${list || '<p class="muted">Баннеров пока нет.</p>'}</div>`;
  return adminLayout('Баннеры', body);
}

function adminPagesPage(rows) {
  const tr = rows.map((r) => `<tr>
    <td>/${esc(r.slug)}</td><td>${esc(r.title)}</td>
    <td>${r.published ? 'опубл.' : 'черновик'}</td>
    <td><a class="btn btn-soft sm" href="/admin/pages/${r.id}">Изменить</a></td></tr>`).join('');
  const body = `<a class="btn btn-primary" href="/admin/pages/new">+ Новая страница</a>
    <div class="card-panel" style="margin-top:16px">
      <h2 style="margin-top:0">Массовая загрузка</h2>
      <p class="muted">Загрузите несколько готовых .html-файлов. Имя файла станет адресом (slug),
      а заголовок/описание возьмутся из тегов &lt;title&gt;, &lt;meta description&gt;, &lt;h1&gt; внутри файла.</p>
      <form method="POST" action="/admin/pages/bulk" enctype="multipart/form-data">
        <input type="file" name="pages" accept=".html,text/html" multiple required>
        <button class="btn btn-soft">Загрузить страницы</button>
      </form>
    </div>
    <table class="table" style="margin-top:16px">
      <thead><tr><th>URL</th><th>Заголовок</th><th>Статус</th><th></th></tr></thead>
      <tbody>${tr || '<tr><td colspan="4" class="muted">Страниц нет.</td></tr>'}</tbody>
    </table>`;
  return adminLayout('SEO-страницы', body);
}

function adminPageEditPage(p) {
  const isNew = !p?.id;
  const body = `<a class="back" href="/admin/pages">← К списку</a>
    <div class="card-panel">
      <p class="muted">Адрес страницы: <code>${esc(config.BASE_URL)}/slug</code></p>
      <form method="POST" action="${isNew ? '/admin/pages' : '/admin/pages/' + p.id}">
        <label class="field"><span>URL (slug)</span><input name="slug" required value="${esc(p?.slug || '')}" placeholder="znakomstva-v-centre"></label>
        <label class="field"><span>Title</span><input name="title" required value="${esc(p?.title || '')}"></label>
        <label class="field"><span>H1</span><input name="h1" value="${esc(p?.h1 || '')}"></label>
        <label class="field"><span>Meta description</span><textarea name="meta_description" rows="2">${esc(p?.meta_description || '')}</textarea></label>
        <label class="field"><span>Ключевые слова</span><input name="keywords" value="${esc(p?.keywords || '')}"></label>
        <label class="field"><span>Текст (HTML)</span><textarea name="body_html" rows="10">${esc(p?.body_html || '')}</textarea></label>
        <label class="pill"><input type="checkbox" name="published" value="1"${(!p || p.published) ? ' checked' : ''}> Опубликована</label>
        <div class="row gap" style="margin-top:16px"><button class="btn btn-primary">Сохранить</button></div>
      </form>
      ${!isNew ? `<form method="POST" action="/admin/pages/${p.id}/delete" onsubmit="return confirm('Удалить страницу?')" style="margin-top:12px"><button class="btn btn-danger">Удалить</button></form>` : ''}
    </div>`;
  return adminLayout(isNew ? 'Новая страница' : 'Страница /' + p.slug, body);
}

function adminSettingsPage(settings) {
  const logoBlock = settings.logo
    ? `<div class="row gap"><img src="/uploads/${esc(settings.logo)}" alt="logo" style="height:36px"><form method="POST" action="/admin/settings/logo/delete"><button class="btn btn-soft sm">Убрать логотип</button></form></div>`
    : '<p class="muted">Логотип не задан — показывается название текстом.</p>';
  const favBlock = settings.favicon
    ? `<div class="row gap"><img src="/uploads/${esc(settings.favicon)}" alt="favicon" style="height:28px"><form method="POST" action="/admin/settings/favicon/delete"><button class="btn btn-soft sm">Убрать фавикон</button></form></div>`
    : '<p class="muted">Фавикон не задан.</p>';
  const body = `<div class="card-panel">
    <h2 style="margin-top:0">Логотип и фавикон</h2>
    <form method="POST" action="/admin/settings/brand" enctype="multipart/form-data">
      <label class="field"><span>Логотип (PNG/SVG, в шапке вместо текста)</span><input type="file" name="logo" accept="image/*"></label>
      ${logoBlock}
      <label class="field" style="margin-top:12px"><span>Фавикон (иконка вкладки)</span><input type="file" name="favicon" accept="image/*,.ico"></label>
      ${favBlock}
      <button class="btn btn-primary" style="margin-top:8px">Загрузить</button>
    </form>
  </div>
  <div class="card-panel" style="margin-top:16px">
    <h2 style="margin-top:0">SEO и тексты</h2>
    <form method="POST" action="/admin/settings">
      <label class="field"><span>Город в предложном падеже <small class="muted">(для «Знакомства в …»)</small></span>
        <input name="city_prepositional" value="${esc(settings.city_prepositional || '')}" placeholder="например: Казани"></label>
      <label class="field"><span>Title главной</span><input name="home_title" value="${esc(settings.home_title || '')}"></label>
      <label class="field"><span>Meta description главной</span><textarea name="home_description" rows="2">${esc(settings.home_description || '')}</textarea></label>
      <label class="field"><span>Ключевые слова главной</span><input name="home_keywords" value="${esc(settings.home_keywords || '')}"></label>
      <label class="field"><span>Вступительный текст на главной</span><textarea name="home_intro" rows="2">${esc(settings.home_intro || '')}</textarea></label>
      <label class="field"><span>Код аналитики <small class="muted">(вставляется перед &lt;/body&gt;)</small></span>
        <textarea name="analytics_html" rows="4" placeholder="<!-- Яндекс.Метрика / Plausible и т.п. -->">${esc(settings.analytics_html || '')}</textarea></label>
      <button class="btn btn-primary">Сохранить</button>
    </form>
  </div>`;
  return adminLayout('Настройки', body);
}

function adminAppealsPage(rows) {
  const list = rows.map((a) => {
    const when = new Date((a.created_at || 0) * 1000).toLocaleString('ru-RU');
    return `<div class="card-panel" style="margin-bottom:12px">
      <div class="row gap" style="justify-content:space-between">
        <b>${esc(a.email || 'без email')}</b>
        <span class="muted">${esc(when)}${a.resolved ? ' · рассмотрено' : ''}</span>
      </div>
      <p style="white-space:pre-wrap;margin:8px 0">${esc(a.message)}</p>
      <div class="row gap">
        ${a.user_id ? `<form method="POST" action="/admin/users/${a.user_id}/unblock"><button class="btn btn-soft sm">Разблокировать автора</button></form>` : ''}
        ${a.resolved ? '' : `<form method="POST" action="/admin/appeals/${a.id}/resolve"><button class="btn btn-soft sm">Пометить рассмотренным</button></form>`}
        <form method="POST" action="/admin/appeals/${a.id}/delete"><button class="btn btn-danger sm">Удалить</button></form>
      </div>
    </div>`;
  }).join('');
  return adminLayout('Апелляции', list || '<p class="muted">Апелляций нет.</p>');
}

function adminReportsPage(rows) {
  const list = rows.map((r) => {
    const when = new Date((r.created_at || 0) * 1000).toLocaleString('ru-RU');
    return `<div class="card-panel" style="margin-bottom:12px">
      <div class="row gap" style="justify-content:space-between">
        <b>Анкета: ${esc(r.profile_name || ('#' + r.profile_id))}</b>
        <span class="muted">${esc(when)}${r.resolved ? ' · рассмотрена' : ''}</span>
      </div>
      <p style="white-space:pre-wrap;margin:8px 0">${esc(r.reason)}</p>
      <div class="row gap">
        <a class="btn btn-soft sm" href="/admin/profiles/${r.profile_id}">Открыть анкету</a>
        <form method="POST" action="/admin/reports/${r.id}/remove-profile" onsubmit="return confirm('Удалить анкету по жалобе?')"><button class="btn btn-danger sm">Удалить анкету</button></form>
        ${r.resolved ? '' : `<form method="POST" action="/admin/reports/${r.id}/resolve"><button class="btn btn-soft sm">Отклонить жалобу</button></form>`}
        <form method="POST" action="/admin/reports/${r.id}/delete"><button class="btn btn-soft sm">Удалить запись</button></form>
      </div>
    </div>`;
  }).join('');
  return adminLayout('Жалобы', list || '<p class="muted">Жалоб нет.</p>');
}

module.exports = {
  adminLoginPage, adminDashboardPage, adminProfilesPage, adminProfileEditPage,
  adminBannersPage, adminPagesPage, adminPageEditPage, adminSettingsPage,
  adminAppealsPage, adminReportsPage,
};
