-- Миграция round-5 -> round-6 (баннеры: статистика, срок, позиция). Выполнить ОДИН раз.
ALTER TABLE banners ADD COLUMN slot       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE banners ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE banners ADD COLUMN views      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE banners ADD COLUMN clicks     INTEGER NOT NULL DEFAULT 0;
