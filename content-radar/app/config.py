from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./radar.db"
    app_secret_key: str = "change-me-before-production"
    youtube_api_key: str = ""
    youtube_region: str = "RU"
    youtube_default_language: str = "ru"
    youtube_max_results: int = 25
    ai_api_key: str = ""
    ai_model: str = "gpt-4o-mini"
    ai_base_url: str = ""

    # Транскрипты через Apify (обходит блокировку IP, дёшево за субтитры).
    apify_token: str = ""
    apify_actor: str = "pintostudio~youtube-transcript-scraper"

    # Аудио-fallback (когда субтитров нет): OpenAI-совместимый STT.
    # Пусто = использовать ai_api_key/ai_base_url. Для Groq: base_url
    # https://api.groq.com/openai/v1 и модель whisper-large-v3-turbo.
    whisper_fallback: bool = True
    whisper_model: str = "whisper-1"
    transcribe_api_key: str = ""
    transcribe_base_url: str = ""

    # ── Доступ к дашборду (content.fuck-app.us) ──────────────────
    # Завод — внутренний редакторский инструмент, закрыт логином/паролем.
    content_admin_user: str = "admin"
    content_admin_password: str = ""  # пусто = вход отключён, доступ заблокирован

    # ── Публикация статей в блог (blog.fuck-app.us) ──────────────
    # URL внутреннего API Node-блога и общий токен (BLOG_INGEST_TOKEN на стороне Node).
    blog_ingest_url: str = ""         # напр. https://blog.fuck-app.us/internal/blog/publish
    blog_ingest_token: str = ""

    # ── Генерация иллюстраций (fal.ai) ───────────────────────────
    # Ключ fal.ai (fal.ai -> Settings -> API Keys). Пусто = генерация выключена.
    fal_key: str = ""
    # Модель. По умолчанию FLUX.1 [dev] — хорошее качество/цена.
    # Дешевле: fal-ai/flux/schnell; максимум: fal-ai/flux-pro/v1.1.
    fal_model: str = "fal-ai/flux/dev"
    # Пресеты размеров fal: landscape_16_9, portrait_4_5, square_hd и т.п.
    fal_image_size_article: str = "landscape_16_9"
    fal_image_size_carousel: str = "portrait_4_5"
    # Сколько картинок рисовать в статью (обложка + внутри текста) и в карусель.
    article_image_count: int = 3
    carousel_image_count: int = 4

    # ── Сборка Reels (слайд-шоу: кадры + озвучка + субтитры) ─────
    # Озвучка — OpenAI-совместимый TTS (по умолчанию тем же ai_api_key/ai_base_url).
    tts_api_key: str = ""         # пусто = использовать ai_api_key
    tts_base_url: str = ""        # пусто = использовать ai_base_url (или OpenAI)
    tts_model: str = "gpt-4o-mini-tts"
    tts_voice: str = "nova"
    # Вертикальное видео 1080x1920 (Reels/Shorts), fps.
    video_width: int = 1080
    video_height: int = 1920
    video_fps: int = 30

    def tts_credentials(self) -> tuple[str, str]:
        """Ключ и base_url для TTS: отдельные, иначе общие AI."""
        return (self.tts_api_key or self.ai_api_key, self.tts_base_url or self.ai_base_url)

    @property
    def blog_media_url(self) -> str:
        """Эндпойнт загрузки картинок на сайт — выводится из blog_ingest_url."""
        return self.blog_ingest_url.rsplit("/", 1)[0] + "/media" if self.blog_ingest_url else ""

    scheduler_enabled: bool = True
    search_interval_hours: int = 12
    metrics_interval_hours: int = 6
    watchlist_interval_hours: int = 24

    # Отсекаем Shorts и слишком короткие клипы (в них мало материала для статьи).
    min_duration_seconds: int = 180
    # Мягкий фильтр языка по метаданным видео (пусто = не фильтровать).
    allowed_languages: str = "ru,en"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_language_set(self) -> set[str]:
        return {x.strip().lower() for x in self.allowed_languages.split(",") if x.strip()}

    @field_validator("ai_model", mode="before")
    @classmethod
    def _default_ai_model(cls, value):
        # An empty AI_MODEL= line in an existing .env must not blank out the default.
        return value or "gpt-4o-mini"

    def transcribe_credentials(self) -> tuple[str, str]:
        """Credentials for the audio STT step: dedicated keys if set, else the
        main AI ones (so plain OpenAI works with no extra config)."""
        return (self.transcribe_api_key or self.ai_api_key, self.transcribe_base_url or self.ai_base_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
