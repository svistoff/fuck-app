-- Миграция round-4 -> round-5. Выполнить ОДИН раз на существующей базе.
-- Таблица reports (жалобы) создастся автоматически при старте приложения.
-- Здесь добавляем только новую колонку. Данные сохраняются.
ALTER TABLE profiles ADD COLUMN bumped_at INTEGER NOT NULL DEFAULT 0;
