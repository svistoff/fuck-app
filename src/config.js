require('dotenv').config({ quiet: true });
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const config = {
  ROOT,
  PORT: Number(process.env.PORT || 8080),
  BASE_URL: (process.env.BASE_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/+$/, ''),
  SITE_NAME: process.env.SITE_NAME || 'Знакомства',
  CITY_NAME: process.env.CITY_NAME || 'городе',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev_insecure_secret_change_me',

  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  MAIL_FROM: process.env.MAIL_FROM || 'noreply@example.com',
  MAIL_DEV_LOG: process.env.MAIL_DEV_LOG === '1',

  UPLOAD_DIR: path.resolve(ROOT, process.env.UPLOAD_DIR || './uploads'),
  MAX_PHOTOS: Number(process.env.MAX_PHOTOS || 4),

  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS_HASH: process.env.ADMIN_PASS_HASH || '',

  DB_PATH: path.resolve(ROOT, 'data', 'app.db'),
  SHORT_DESC_MAX: 120,
  ASSET_VERSION: '11',   // менять при правке styles.css / app.js — пробивает кэш браузера

  // ── Блог (статьи из контент-завода) ───────────────────────
  // Поддомен блога. Если запрос пришёл на этот Host — показываем блог. Пусто =
  // блог живёт только по пути /blog на основном домене (рекомендуется для SEO).
  BLOG_HOST: (process.env.BLOG_HOST || '').trim().toLowerCase(),
  // Публичный адрес блога (canonical/sitemap и ссылка в ответе API публикации).
  BLOG_BASE_URL: (process.env.BLOG_BASE_URL || '').replace(/\/+$/, ''),
  // Общий секрет для приёма статей из завода. Пусто = приём выключен.
  BLOG_INGEST_TOKEN: process.env.BLOG_INGEST_TOKEN || '',
};

// По умолчанию блог — поддиректория /blog основного домена.
if (!config.BLOG_BASE_URL) config.BLOG_BASE_URL = `${config.BASE_URL}/blog`;
// Host блога выводим из BLOG_BASE_URL только если это ОТДЕЛЬНЫЙ хост (поддомен);
// для поддиректории оставляем пустым, иначе Host-роутинг перехватил бы весь сайт.
if (!config.BLOG_HOST) {
  try {
    const blogHost = new URL(config.BLOG_BASE_URL).host.toLowerCase();
    const mainHost = new URL(config.BASE_URL).host.toLowerCase();
    if (blogHost !== mainHost) config.BLOG_HOST = blogHost;
  } catch {}
}

module.exports = config;
