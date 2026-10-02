// Блог fuck-app.us — живёт в том же Node-процессе и той же SQLite-базе, что и
// сайт знакомств. Отдаётся на поддомене blog.<домен> (роутинг по Host) и/или по
// пути /blog на основном домене. Статьи наполняет контент-завод (Python,
// content.<домен>) через внутренний API POST /internal/blog/publish.
//
// Зачем так: блог переиспользует серверный рендеринг и SEO основного сайта и
// ссылается на каталог анкет — это и есть рост органики и ссылочной массы для
// основного сервиса.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const { db } = require('./db');
const { esc } = require('./views');

// Папка для картинок блога (обложки/иллюстрации из контент-завода).
const BLOG_MEDIA_DIR = path.join(config.UPLOAD_DIR, 'blog');
fs.mkdirSync(BLOG_MEDIA_DIR, { recursive: true });

// ── Запросы к БД ─────────────────────────────────────────────
const Q = {
  published: db.prepare("SELECT * FROM blog_posts WHERE status='published' ORDER BY created_at DESC, id DESC"),
  bySlug: db.prepare("SELECT * FROM blog_posts WHERE slug=? AND status='published'"),
  byExternal: db.prepare('SELECT * FROM blog_posts WHERE external_id=?'),
  bySlugAny: db.prepare('SELECT * FROM blog_posts WHERE slug=?'),
  insert: db.prepare(`INSERT INTO blog_posts
    (slug, title, h1, meta_description, keywords, lead, body_html, faq_json, cover_url, source_url, source_title, external_id, status)
    VALUES (@slug, @title, @h1, @meta_description, @keywords, @lead, @body_html, @faq_json, @cover_url, @source_url, @source_title, @external_id, @status)`),
  update: db.prepare(`UPDATE blog_posts SET
    slug=@slug, title=@title, h1=@h1, meta_description=@meta_description, keywords=@keywords,
    lead=@lead, body_html=@body_html, faq_json=@faq_json, cover_url=@cover_url,
    source_url=@source_url, source_title=@source_title, status=@status,
    updated_at=strftime('%s','now') WHERE id=@id`),
};

// ── Утилиты ──────────────────────────────────────────────────
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
};
function slugify(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/[\u0400-\u04ff]/g, (ch) => (ch in TRANSLIT ? TRANSLIT[ch] : '')) // кириллица → латиница
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
function uniqueSlug(base, excludeId) {
  const slug = slugify(base) || 'statya';
  let candidate = slug;
  let n = 2;
  for (;;) {
    const row = Q.bySlugAny.get(candidate);
    if (!row || row.id === excludeId) return candidate;
    candidate = `${slug}-${n++}`;
  }
}
function fmtDate(ts) {
  try { return new Date(ts * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }); }
  catch { return ''; }
}
// Контекст блога для запроса: абсолютный базовый URL и префикс путей.
// На поддомене blog.<домен> префикса нет; по пути /blog — префикс "/blog".
function ctx(req) {
  if (config.BLOG_HOST && String(req.hostname || '').toLowerCase() === config.BLOG_HOST) {
    return { base: config.BLOG_BASE_URL, prefix: '' };
  }
  return { base: `${config.BASE_URL}/blog`, prefix: '/blog' };
}

// ── Рендер каркаса (единый стиль с сайтом + 18+ оверлей) ─────
function shell({ title, description, keywords, canonical, body, head = '' }) {
  const site = esc(config.SITE_NAME);
  const main = esc(config.BASE_URL);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title || (config.SITE_NAME + ' — блог'))}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${keywords ? `<meta name="keywords" content="${esc(keywords)}">` : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:title" content="${esc(title || config.SITE_NAME)}">
${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
<meta property="og:type" content="article">
<link rel="stylesheet" href="/css/styles.css">
<link rel="stylesheet" href="/css/blog.css">
${head}
</head>
<body class="blog">
<script>if(document.cookie.indexOf('age_ok=1')>-1)document.documentElement.classList.add('age-ok');</script>
<header class="site-header"><div class="wrap header-row">
  <a class="brand" href="${esc(config.BLOG_BASE_URL)}">${site}<span class="brand-dot">.</span> <span class="brand-sub">блог</span></a>
  <nav class="header-nav">
    <a class="btn btn-ghost" href="${main}/catalog">Анкеты</a>
    <a class="btn btn-primary" href="${main}/">На сайт знакомств</a>
  </nav>
</div></header>
<main class="wrap main">${body}</main>
<footer class="site-footer"><div class="wrap">
  <span>${site} — блог о знакомствах и отношениях в ${esc(config.CITY_NAME)}</span>
  <a href="${main}/catalog">Смотреть анкеты</a>
</div></footer>
<div class="age-overlay" role="dialog" aria-label="Подтверждение возраста"><div class="age-box">
  <h2>Вам есть 18 лет?</h2>
  <p class="muted">Сайт предназначен только для совершеннолетних.</p>
  <div class="row gap" style="justify-content:center">
    <button class="btn btn-primary btn-lg" id="age-yes">Мне есть 18</button>
    <a class="btn btn-soft btn-lg" href="https://www.google.com">Нет</a>
  </div>
</div></div>
<script>(function(){var y=document.getElementById('age-yes');if(y)y.addEventListener('click',function(){document.cookie='age_ok=1; max-age='+(365*24*3600)+'; path=/; samesite=lax';document.documentElement.classList.add('age-ok');});})();</script>
</body></html>`;
}

// Блок-воронка на основной сервис — ставится в каждую статью (ссылочная масса).
function funnel() {
  const main = esc(config.BASE_URL);
  return `<aside class="blog-cta">
    <h3>Ищете знакомства в ${esc(config.CITY_NAME)}?</h3>
    <p>Реальные анкеты с фото и контактами — смотрите прямо сейчас.</p>
    <a class="btn btn-primary btn-lg" href="${main}/catalog">Открыть каталог анкет</a>
  </aside>`;
}

// ── Страницы ─────────────────────────────────────────────────
function indexPage(req) {
  const { base } = ctx(req);
  const posts = Q.published.all();
  const cards = posts.length
    ? posts.map((p) => `<a class="blog-card" href="${esc(base + '/' + p.slug)}">
        <h2>${esc(p.h1 || p.title)}</h2>
        ${p.lead ? `<p>${esc(String(p.lead).slice(0, 200))}</p>` : ''}
        <span class="blog-card-date">${esc(fmtDate(p.created_at))}</span>
      </a>`).join('')
    : `<p class="muted">Пока нет статей. Они появятся из контент-завода.</p>`;
  return shell({
    title: `Блог — ${config.SITE_NAME}`,
    description: `Статьи о знакомствах, отношениях и психологии. ${config.SITE_NAME}.`,
    canonical: base,
    body: `<h1>Блог</h1><div class="blog-list">${cards}</div>${funnel()}`,
  });
}

function articlePage(req, post) {
  const { base } = ctx(req);
  const url = `${base}/${post.slug}`;
  let faq = [];
  try { faq = JSON.parse(post.faq_json || '[]'); } catch {}
  const faqHtml = faq.length
    ? `<section class="blog-faq"><h2>Частые вопросы</h2>${faq.map((f) =>
        `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</section>`
    : '';

  // Структурированные данные: Article + (при наличии) FAQPage.
  const ld = [{
    '@context': 'https://schema.org', '@type': 'Article',
    headline: post.h1 || post.title, description: post.meta_description || '',
    datePublished: new Date(post.created_at * 1000).toISOString(),
    dateModified: new Date((post.updated_at || post.created_at) * 1000).toISOString(),
    mainEntityOfPage: url, author: { '@type': 'Organization', name: config.SITE_NAME },
    publisher: { '@type': 'Organization', name: config.SITE_NAME },
    ...(post.cover_url ? { image: post.cover_url } : {}),
  }];
  if (faq.length) {
    ld.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
    });
  }
  const jsonLd = ld.map((o) =>
    `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('');

  const cover = post.cover_url
    ? `<div class="blog-cover" style="background-image:url('${esc(post.cover_url)}')"></div>` : '';
  const source = post.source_url
    ? `<p class="blog-source">По мотивам: <a href="${esc(post.source_url)}" target="_blank" rel="nofollow noopener">${esc(post.source_title || 'видео-источник')}</a></p>`
    : '';

  const body = `<article class="blog-article">
    <p class="blog-date">${esc(fmtDate(post.created_at))}</p>
    <h1>${esc(post.h1 || post.title)}</h1>
    ${cover}
    ${post.lead ? `<p class="blog-lead">${esc(post.lead)}</p>` : ''}
    <div class="blog-body">${post.body_html || ''}</div>
    ${faqHtml}
    ${source}
    ${funnel()}
    <p class="blog-back"><a href="${esc(base)}">← Все статьи</a></p>
  </article>${jsonLd}`;

  return shell({
    title: post.title || post.h1,
    description: post.meta_description || '',
    keywords: post.keywords || '',
    canonical: url,
    body,
  });
}

function notFound(base) {
  return shell({ title: 'Не найдено', body: `<h1>Статья не найдена</h1><p class="blog-back"><a href="${esc(base)}">← Все статьи</a></p>` });
}

function robots(req) {
  const { base } = ctx(req);
  return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
}
function sitemap(req) {
  const { base } = ctx(req);
  const urls = [base, ...Q.published.all().map((p) => `${base}/${p.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + `\n</urlset>`;
}

// ── Приём статьи из контент-завода ───────────────────────────
function ingest(payload) {
  const title = String(payload.title || payload.h1 || '').trim();
  if (!title) throw new Error('Пустой заголовок статьи');

  const external_id = payload.external_id ? String(payload.external_id) : null;
  const existing = external_id ? Q.byExternal.get(external_id) : null;

  const row = {
    slug: uniqueSlug(payload.slug || payload.h1 || title, existing ? existing.id : null),
    title: title.slice(0, 200),
    h1: String(payload.h1 || title).slice(0, 200),
    meta_description: String(payload.meta_description || '').slice(0, 320),
    keywords: String(payload.keywords || '').slice(0, 320),
    lead: String(payload.lead || ''),
    body_html: String(payload.body_html || ''),
    faq_json: JSON.stringify(Array.isArray(payload.faq) ? payload.faq : []),
    cover_url: payload.cover_url ? String(payload.cover_url) : null,
    source_url: payload.source_url ? String(payload.source_url) : null,
    source_title: payload.source_title ? String(payload.source_title).slice(0, 200) : null,
    external_id,
    status: payload.status === 'hidden' ? 'hidden' : 'published',
  };

  if (existing) {
    // slug у уже опубликованной статьи не меняем, чтобы не плодить 404.
    row.id = existing.id;
    row.slug = existing.slug;
    Q.update.run(row);
    return { slug: existing.slug, updated: true };
  }
  Q.insert.run(row);
  return { slug: row.slug, updated: false };
}

// ── Монтирование в основное приложение ───────────────────────
// Вызывается в server.js. Регистрирует: приём статей (любой Host),
// роутинг по Host блога, и пути /blog на основном домене.
function mount(app) {
  // 1. Внутренний API публикации (любой Host). Защищён токеном.
  app.post('/internal/blog/publish', express.json({ limit: '2mb' }), (req, res) => {
    if (!config.BLOG_INGEST_TOKEN) return res.status(503).json({ error: 'Приём статей выключен (BLOG_INGEST_TOKEN не задан)' });
    const authz = req.get('authorization') || '';
    const token = authz.replace(/^Bearer\s+/i, '');
    if (token !== config.BLOG_INGEST_TOKEN) return res.status(401).json({ error: 'Неверный токен' });
    try {
      const result = ingest(req.body || {});
      res.json({ ok: true, slug: result.slug, updated: result.updated, url: `${config.BLOG_BASE_URL}/${result.slug}` });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  // 1b. Приём картинок из завода (обложки/иллюстрации). Защищён тем же токеном.
  //     Тело: { ext, data_base64 }. Сохраняет в uploads/blog, отдаёт публичный URL.
  app.post('/internal/blog/media', express.json({ limit: '30mb' }), (req, res) => {
    if (!config.BLOG_INGEST_TOKEN) return res.status(503).json({ error: 'Приём выключен (BLOG_INGEST_TOKEN не задан)' });
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (token !== config.BLOG_INGEST_TOKEN) return res.status(401).json({ error: 'Неверный токен' });
    try {
      const ext = String(req.body.ext || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return res.status(400).json({ error: 'Недопустимый формат' });
      const data = String(req.body.data_base64 || '');
      if (!data) return res.status(400).json({ error: 'Пустые данные' });
      const buf = Buffer.from(data, 'base64');
      if (!buf.length || buf.length > 25 * 1024 * 1024) return res.status(400).json({ error: 'Размер вне допустимого' });
      const name = `${Date.now()}_${crypto.randomBytes(5).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(BLOG_MEDIA_DIR, name), buf);
      res.json({ ok: true, url: `${config.BASE_URL}/uploads/blog/${name}` });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  // 2. Роутинг по Host блога — перехватывает страницы блога на поддомене.
  app.use((req, res, next) => {
    if (!config.BLOG_HOST || String(req.hostname || '').toLowerCase() !== config.BLOG_HOST) return next();
    if (req.method !== 'GET') return next();
    const p = req.path;
    if (p === '/robots.txt') return res.type('text/plain').send(robots(req));
    if (p === '/sitemap.xml') return res.type('application/xml').send(sitemap(req));
    if (p === '/' || p === '') return res.send(indexPage(req));
    const m = p.match(/^\/([a-z0-9-]+)\/?$/i);
    if (m) {
      const post = Q.bySlug.get(m[1]);
      if (post) return res.send(articlePage(req, post));
      return res.status(404).send(notFound(config.BLOG_BASE_URL));
    }
    return next();
  });

  // 3. Пути /blog на основном домене (поддиректория — ещё сильнее для SEO).
  app.get('/blog', (req, res) => res.send(indexPage(req)));
  app.get('/blog/:slug', (req, res) => {
    const post = Q.bySlug.get(String(req.params.slug || ''));
    if (!post) return res.status(404).send(notFound(`${config.BASE_URL}/blog`));
    res.send(articlePage(req, post));
  });
}

module.exports = { mount, publishedSlugs: () => Q.published.all().map((p) => p.slug), ingest };
