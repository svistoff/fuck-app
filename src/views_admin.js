const config = require('./config');
const { layout, esc } = require('./views');

function adminLayout(title, body) {
  const nav = `<nav class="admin-nav">
    <a href="/admin">Сводка</a>
    <a href="/admin/profiles">Анкеты</a>
    <a href="/admin/pages">SEO-страницы</a>
    <a href="/admin/settings">Настройки</a>
    <form method="POST" action="/admin/logout"><button class="linklike">Выйти</button></form>
  </nav>`;
  return layout({
    title: `Админка — ${title}`,
    bodyClass: 'admin',
    body: `<div class="admin-wrap"><h1 class="admin-title">${esc(title)}</h1>${nav}${body}</div>`,
  });
}

function adminLoginPage(error) {
  return layout({
    title: 'Вход в админку',
    bodyClass: 'centered',
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
    ${statRow('Мужчин', stats.men)}
    ${statRow('Женщин', stats.women)}
    ${statRow('Активных анкет', stats.active)}
    ${statRow('Скрытых анкет', stats.hidden)}
    ${statRow('Удалённых анкет', stats.deleted)}
  </div>`;
  return adminLayout('Сводка', body);
}

function adminProfilesPage(rows) {
  const tr = rows.map((r) => `<tr>
    <td>${r.id}</td>
    <td>${esc(r.name)}</td>
    <td>${esc(r.age || '')}</td>
    <td><span class="badge badge-${r.status}">${esc(r.status)}</span>${r.pinned ? ' 📌' : ''}</td>
    <td>${r.photos_cnt}</td>
    <td class="row gap">
      <a class="btn btn-soft sm" href="/admin/profiles/${r.id}">Открыть</a>
      <form method="POST" action="/admin/profiles/${r.id}/pin"><button class="btn btn-soft sm">${r.pinned ? 'Открепить' : 'Закрепить'}</button></form>
    </td>
  </tr>`).join('');
  const body = `<table class="table">
    <thead><tr><th>ID</th><th>Имя</th><th>Возраст</th><th>Статус</th><th>Фото</th><th></th></tr></thead>
    <tbody>${tr || '<tr><td colspan="6" class="muted">Анкет нет.</td></tr>'}</tbody>
  </table>`;
  return adminLayout('Анкеты', body);
}

function adminProfileEditPage(profile, photos) {
  const photoList = photos.map((ph) =>
    `<div class="photo-thumb"><img src="/uploads/${esc(ph.filename)}" alt="">
       <form method="POST" action="/admin/profiles/${profile.id}/photos/${ph.id}/delete"><button class="photo-del" title="Удалить">×</button></form>
     </div>`).join('');
  const body = `<a class="back" href="/admin/profiles">← К списку</a>
    <div class="card-panel">
      <form method="POST" action="/admin/profiles/${profile.id}">
        <label class="field"><span>Имя</span><input name="name" value="${esc(profile.name)}"></label>
        <label class="field"><span>Возраст</span><input name="age" type="number" value="${esc(profile.age || '')}"></label>
        <label class="field"><span>Район/улица</span><input name="district" value="${esc(profile.district || '')}"></label>
        <label class="field"><span>Краткое описание</span><textarea name="short_desc" rows="2">${esc(profile.short_desc || '')}</textarea></label>
        <label class="field"><span>Полное описание</span><textarea name="full_desc" rows="5">${esc(profile.full_desc || '')}</textarea></label>
        <label class="field"><span>Статус</span>
          <select name="status">
            ${['active', 'hidden', 'deleted'].map((s) => `<option value="${s}"${profile.status === s ? ' selected' : ''}>${s}</option>`).join('')}
          </select></label>
        <button class="btn btn-primary">Сохранить</button>
      </form>
      <h2 class="sub">Фотографии</h2>
      <div class="photos">${photoList || '<p class="muted">Нет фото.</p>'}</div>
      <form method="POST" action="/admin/profiles/${profile.id}/delete" onsubmit="return confirm('Удалить анкету полностью?')">
        <button class="btn btn-danger">Удалить анкету</button>
      </form>
    </div>`;
  return adminLayout('Анкета #' + profile.id, body);
}

function adminPagesPage(rows) {
  const tr = rows.map((r) => `<tr>
    <td>/${esc(r.slug)}</td><td>${esc(r.title)}</td>
    <td>${r.published ? 'опубл.' : 'черновик'}</td>
    <td><a class="btn btn-soft sm" href="/admin/pages/${r.id}">Изменить</a></td>
  </tr>`).join('');
  const body = `<a class="btn btn-primary" href="/admin/pages/new">+ Новая страница</a>
    <table class="table">
      <thead><tr><th>URL</th><th>Заголовок</th><th>Статус</th><th></th></tr></thead>
      <tbody>${tr || '<tr><td colspan="4" class="muted">Страниц нет.</td></tr>'}</tbody>
    </table>`;
  return adminLayout('SEO-страницы', body);
}

function adminPageEditPage(p) {
  const isNew = !p?.id;
  const body = `<a class="back" href="/admin/pages">← К списку</a>
    <div class="card-panel">
      <p class="muted">Низкочастотные посадочные страницы под ключевые запросы. URL вида <code>${esc(config.BASE_URL)}/slug</code>.</p>
      <form method="POST" action="${isNew ? '/admin/pages' : '/admin/pages/' + p.id}">
        <label class="field"><span>URL (slug)</span><input name="slug" required value="${esc(p?.slug || '')}" placeholder="znakomstva-v-centre"></label>
        <label class="field"><span>Title (для вкладки и поиска)</span><input name="title" required value="${esc(p?.title || '')}"></label>
        <label class="field"><span>H1 (заголовок на странице)</span><input name="h1" value="${esc(p?.h1 || '')}"></label>
        <label class="field"><span>Meta description</span><textarea name="meta_description" rows="2">${esc(p?.meta_description || '')}</textarea></label>
        <label class="field"><span>Ключевые слова (через запятую)</span><input name="keywords" value="${esc(p?.keywords || '')}"></label>
        <label class="field"><span>Текст страницы (HTML)</span><textarea name="body_html" rows="10">${esc(p?.body_html || '')}</textarea></label>
        <label class="pill"><input type="checkbox" name="published" value="1"${(!p || p.published) ? ' checked' : ''}> Опубликована</label>
        <div class="row gap" style="margin-top:16px">
          <button class="btn btn-primary">Сохранить</button>
          ${!isNew ? `</form><form method="POST" action="/admin/pages/${p.id}/delete" onsubmit="return confirm('Удалить страницу?')"><button class="btn btn-danger">Удалить</button>` : ''}
        </div>
      </form>
    </div>`;
  return adminLayout(isNew ? 'Новая страница' : 'Страница /' + p.slug, body);
}

function adminSettingsPage(settings) {
  const body = `<div class="card-panel">
    <p class="muted">Мета-данные и ключевые слова главной страницы. Влияют на то, как сайт выглядит в поиске.</p>
    <form method="POST" action="/admin/settings">
      <label class="field"><span>Title главной</span><input name="home_title" value="${esc(settings.home_title || '')}"></label>
      <label class="field"><span>Meta description главной</span><textarea name="home_description" rows="2">${esc(settings.home_description || '')}</textarea></label>
      <label class="field"><span>Ключевые слова (через запятую)</span><input name="home_keywords" value="${esc(settings.home_keywords || '')}"></label>
      <label class="field"><span>Вступительный текст на главной</span><textarea name="home_intro" rows="2">${esc(settings.home_intro || '')}</textarea></label>
      <button class="btn btn-primary">Сохранить</button>
    </form>
  </div>`;
  return adminLayout('Настройки', body);
}

module.exports = {
  adminLoginPage, adminDashboardPage, adminProfilesPage,
  adminProfileEditPage, adminPagesPage, adminPageEditPage, adminSettingsPage,
};
