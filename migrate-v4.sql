-- Миграция round-3 -> round-4. Выполнить ОДИН раз на существующей базе.
-- Новые таблицы (appeals, blocked_devices) создаются автоматически при старте,
-- здесь только добавляем колонки к существующим таблицам. Данные сохраняются.
ALTER TABLE profiles ADD COLUMN height  INTEGER;
ALTER TABLE profiles ADD COLUMN weight  INTEGER;
ALTER TABLE profiles ADD COLUMN bust    INTEGER;
ALTER TABLE profiles ADD COLUMN outcall INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users    ADD COLUMN blocked   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users    ADD COLUMN device_id TEXT;
