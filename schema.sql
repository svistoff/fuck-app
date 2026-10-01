PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Пользователи. Личность теперь по email (magic link), не по Telegram.
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  age         INTEGER,
  gender      TEXT CHECK (gender IN ('male','female')),
  blocked     INTEGER NOT NULL DEFAULT 0,   -- 1 = аккаунт заблокирован админом
  device_id   TEXT,                          -- последний device-cookie (для блока по устройству)
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);

-- Анкеты (создают девушки при регистрации или администратор вручную).
-- user_id может быть NULL — для анкет, заведённых админом без аккаунта.
-- status: active = в каталоге, hidden = скрыта (данные сохранены), deleted = удалена (неактивна, фото стёрты)
CREATE TABLE IF NOT EXISTS profiles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  age          INTEGER,
  district     TEXT,                       -- район города (из списка)
  height       INTEGER,                     -- рост, см
  weight       INTEGER,                     -- вес, кг
  bust         INTEGER,                     -- грудь (размер)
  outcall      INTEGER NOT NULL DEFAULT 0,  -- 1 = выезд
  short_desc   TEXT,                        -- до 120 символов
  full_desc    TEXT,                        -- без жёсткого лимита
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','deleted')),
  pinned       INTEGER NOT NULL DEFAULT 0,  -- 1 = закреплена админом наверху (корона)
  pin_order    INTEGER NOT NULL DEFAULT 0,  -- порядок среди закреплённых
  bumped_at    INTEGER NOT NULL DEFAULT 0,  -- когда девушка последний раз «поднимала» анкету
  created_at   INTEGER DEFAULT (strftime('%s','now')),
  updated_at   INTEGER DEFAULT (strftime('%s','now'))
);

-- Контакты анкеты. type: phone | whatsapp | telegram | max | instagram
CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  value       TEXT NOT NULL
);

-- Фото. Хранятся на диске VPS, в БД только имя файла.
CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_main     INTEGER NOT NULL DEFAULT 0
);

-- Одноразовые токены входа (magic link).
CREATE TABLE IF NOT EXISTS login_tokens (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);

-- SEO-страницы под низкочастотные запросы (создаются в админке).
CREATE TABLE IF NOT EXISTS seo_pages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT UNIQUE NOT NULL,
  title            TEXT NOT NULL,
  h1               TEXT,
  meta_description TEXT,
  keywords         TEXT,
  body_html        TEXT,
  published        INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER DEFAULT (strftime('%s','now')),
  updated_at       INTEGER DEFAULT (strftime('%s','now'))
);

-- Глобальные настройки (мета главной, ключевые слова и т.п.).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Рекламные баннеры в ленте каталога (картинка + ссылка).
CREATE TABLE IF NOT EXISTS banners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL,
  link_url    TEXT,
  title       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  slot        INTEGER NOT NULL DEFAULT 0,  -- 0 = крутится случайно; 1,2,3… = закреплён на этой позиции показа
  expires_at  INTEGER NOT NULL DEFAULT 0,  -- 0 = бессрочно, иначе unix-время окончания
  views       INTEGER NOT NULL DEFAULT 0,  -- счётчик показов
  clicks      INTEGER NOT NULL DEFAULT 0,  -- счётчик кликов
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_contacts_profile ON contacts(profile_id);
CREATE INDEX IF NOT EXISTS idx_photos_profile ON photos(profile_id);

-- Жалобы мужчин на анкеты (читаются в админке).
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  user_id     INTEGER,
  reason      TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);

-- Апелляции заблокированных пользователей (читаются в админке).
CREATE TABLE IF NOT EXISTS appeals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  email       TEXT,
  message     TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);

-- Заблокированные устройства (device-cookie). Мягкий сигнал, обходится сменой браузера.
CREATE TABLE IF NOT EXISTS blocked_devices (
  device_id   TEXT PRIMARY KEY,
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);

-- Статьи блога. Наполняются из контент-завода (content.<домен>) через внутренний
-- API /internal/blog/publish. Живут в той же БД и отдаются тем же процессом ради
-- SEO: серверный HTML, единый sitemap и ссылки на каталог анкет.
CREATE TABLE IF NOT EXISTS blog_posts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT UNIQUE NOT NULL,
  title            TEXT NOT NULL,            -- SEO title (<title>)
  h1               TEXT,
  meta_description TEXT,
  keywords         TEXT,
  lead             TEXT,                     -- вступление
  body_html        TEXT,                     -- готовое тело статьи (HTML)
  faq_json         TEXT,                     -- [{question, answer}] для FAQ-разметки
  cover_url        TEXT,
  source_url       TEXT,                     -- ссылка на исходное видео (rel=nofollow)
  source_title     TEXT,
  external_id      TEXT UNIQUE,              -- id Content Pack → идемпотентная публикация
  status           TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at       INTEGER DEFAULT (strftime('%s','now')),
  updated_at       INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_status ON blog_posts(status);
