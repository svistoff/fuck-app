PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Пользователи. Личность теперь по email (magic link), не по Telegram.
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  age         INTEGER,
  gender      TEXT CHECK (gender IN ('male','female')),
  created_at  INTEGER DEFAULT (strftime('%s','now'))
);

-- Анкеты (создают только женщины). Одна анкета на пользователя.
-- status: active = в каталоге, hidden = скрыта (данные сохранены), deleted = удалена (неактивна, фото стёрты)
CREATE TABLE IF NOT EXISTS profiles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  age          INTEGER,
  district     TEXT,                       -- необязательное «район/улица»
  short_desc   TEXT,                        -- до 120 символов
  full_desc    TEXT,                        -- без жёсткого лимита
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','deleted')),
  pinned       INTEGER NOT NULL DEFAULT 0,  -- 1 = закреплена админом наверху
  pin_order    INTEGER NOT NULL DEFAULT 0,  -- порядок среди закреплённых
  created_at   INTEGER DEFAULT (strftime('%s','now')),
  updated_at   INTEGER DEFAULT (strftime('%s','now'))
);

-- Контакты анкеты. type: phone | whatsapp | telegram | bip | max | instagram
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

CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_contacts_profile ON contacts(profile_id);
CREATE INDEX IF NOT EXISTS idx_photos_profile ON photos(profile_id);
