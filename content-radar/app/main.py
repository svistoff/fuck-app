import hashlib
import hmac
import json
import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, joinedload

from app.config import get_settings
from app.database import Base, SessionLocal, engine, get_db
from app.models import Channel, ContentPack, SearchQuery, Video
from app.seed import seed_search_queries
from app.services.ai_content_service import AIContentError, generate_content_pack
from app.services.channel_service import (
    ChannelImportError,
    add_watchlist_channel,
    list_watchlist,
    sync_watchlist,
)
from app.services.discovery_service import (
    cleanup_ineligible_videos,
    run_all_enabled_queries,
    run_search_for_query,
)
from app.services.import_service import ImportError_, import_video_by_url
from app.services.metrics_service import refresh_all_metrics
from app.services.publish_service import PublishError, publish_pack_to_blog
from app.services.scheduler import build_scheduler
from app.services.scoring_service import recompute_all_scores
from app.services.settings_service import get_brand_settings
from app.services.transcript_service import TranscriptUnavailable, fetch_and_store_transcript
from app.services.youtube_client import YouTubeAPIError

logging.getLogger("radar").setLevel(logging.INFO)
if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

# Lightweight, idempotent column additions for existing Postgres deployments.
# Full Alembic migrations arrive with production hardening; until then this keeps
# an already-running database in sync with new model columns without data loss.
_POSTGRES_COLUMN_PATCHES = (
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0",
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0",
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS score_explanation TEXT",
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ",
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'topic_search'",
    "ALTER TABLE content_packs ADD COLUMN IF NOT EXISTS blog_url TEXT",
    "ALTER TABLE content_packs ADD COLUMN IF NOT EXISTS blog_published_at TIMESTAMPTZ",
)

# SQLite не поддерживает IF NOT EXISTS в ADD COLUMN — пытаемся добавить и глотаем
# ошибку, если колонка уже есть. Для уже существующих SQLite-баз.
_SQLITE_COLUMN_PATCHES = (
    "ALTER TABLE content_packs ADD COLUMN blog_url TEXT",
    "ALTER TABLE content_packs ADD COLUMN blog_published_at TIMESTAMP",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            for statement in _POSTGRES_COLUMN_PATCHES:
                conn.execute(text(statement))
    elif engine.dialect.name == "sqlite":
        for statement in _SQLITE_COLUMN_PATCHES:
            try:
                with engine.begin() as conn:
                    conn.execute(text(statement))
            except Exception:
                pass  # колонка уже существует
    with SessionLocal() as db:
        seed_search_queries(db)
    scheduler = build_scheduler()
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)


app = FastAPI(title="18plus Content Radar", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

SESSION_COOKIE = "cr_auth"


def _session_token() -> str:
    """Подписанный маркер сессии на основе APP_SECRET_KEY (без внешних зависимостей)."""
    secret = get_settings().app_secret_key.encode()
    return hmac.new(secret, b"content-radar-session", hashlib.sha256).hexdigest()


def _is_authed(request: Request) -> bool:
    settings = get_settings()
    if not settings.content_admin_password:
        return False  # пароль не задан — доступ закрыт
    token = request.cookies.get(SESSION_COOKIE)
    return bool(token) and hmac.compare_digest(token, _session_token())


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """Закрывает весь дашборд логином/паролем. Открыты только /login, /static,
    /health."""
    path = request.url.path
    if path == "/login" or path == "/health" or path.startswith("/static"):
        return await call_next(request)
    if _is_authed(request):
        return await call_next(request)
    return RedirectResponse("/login", status_code=303)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    settings = get_settings()
    if _is_authed(request):
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(
        request,
        "login.html",
        {
            "no_password": not settings.content_admin_password,
            "error_message": request.query_params.get("error"),
        },
    )


@app.post("/login")
def login_submit(username: str = Form(...), password: str = Form(...)):
    settings = get_settings()
    ok = (
        bool(settings.content_admin_password)
        and hmac.compare_digest(username.strip(), settings.content_admin_user)
        and hmac.compare_digest(password, settings.content_admin_password)
    )
    if not ok:
        return RedirectResponse(f"/login?error={quote('Неверный логин или пароль')}", status_code=303)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        SESSION_COOKIE, _session_token(),
        max_age=30 * 24 * 3600, httponly=True, samesite="lax",
        secure=settings.app_env != "development",
    )
    return response


@app.post("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE)
    return response


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    stats = {
        "queries": db.scalar(select(func.count()).select_from(SearchQuery)) or 0,
        "videos": db.scalar(select(func.count()).select_from(Video)) or 0,
        "watchlist": db.scalar(select(func.count()).select_from(Channel).where(Channel.status == "watchlist")) or 0,
        "selected": db.scalar(select(func.count()).select_from(Video).where(Video.workflow_status == "selected")) or 0,
    }
    schedule = {
        "enabled": settings.scheduler_enabled,
        "search_interval_hours": settings.search_interval_hours,
        "metrics_interval_hours": settings.metrics_interval_hours,
    }
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "stats": stats,
            "schedule": schedule,
            "ok_message": request.query_params.get("ok"),
            "error_message": request.query_params.get("error"),
        },
    )


@app.post("/jobs/discovery/run")
def run_discovery_now(db: Session = Depends(get_db)):
    totals = run_all_enabled_queries(db)
    if totals["found"] == 0 and totals["errors"]:
        reason = totals["error_sample"] or "все запросы завершились ошибкой"
        return RedirectResponse(f"/?error={quote(reason)}", status_code=303)
    message = (
        f"Поиск по {totals['queries']} темам: найдено {totals['found']}, "
        f"новых {totals['created']}, обновлено {totals['updated']}"
        + (f", пропущено Shorts/коротких {totals['skipped']}" if totals["skipped"] else "")
        + (f", ошибок {totals['errors']}" if totals["errors"] else "")
    )
    return RedirectResponse(f"/?ok={quote(message)}", status_code=303)


@app.post("/jobs/metrics/run")
def run_metrics_now(db: Session = Depends(get_db)):
    try:
        totals = refresh_all_metrics(db)
    except YouTubeAPIError as exc:
        return RedirectResponse(f"/?error={quote(str(exc))}", status_code=303)
    message = f"Метрики обновлены: {totals['refreshed']} из {totals['tracked']} видео"
    return RedirectResponse(f"/?ok={quote(message)}", status_code=303)


@app.get("/queries", response_class=HTMLResponse)
def queries_page(request: Request, db: Session = Depends(get_db)):
    queries = db.scalars(select(SearchQuery).order_by(SearchQuery.priority.desc(), SearchQuery.name)).all()
    return templates.TemplateResponse(
        request,
        "queries.html",
        {
            "queries": queries,
            "ok_message": request.query_params.get("ok"),
            "error_message": request.query_params.get("error"),
        },
    )


@app.post("/queries")
def create_query(
    name: str = Form(...),
    query_text: str = Form(...),
    language: str = Form("ru"),
    priority: int = Form(50),
    db: Session = Depends(get_db),
):
    if db.scalar(select(SearchQuery).where(SearchQuery.query_text == query_text.strip())):
        raise HTTPException(status_code=409, detail="Такой поисковый запрос уже существует")
    db.add(SearchQuery(name=name.strip(), query_text=query_text.strip(), language=language, priority=max(1, min(priority, 100))))
    db.commit()
    return RedirectResponse("/queries", status_code=303)


@app.post("/queries/{query_id}/toggle")
def toggle_query(query_id: uuid.UUID, db: Session = Depends(get_db)):
    item = db.get(SearchQuery, query_id)
    if not item:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    item.enabled = not item.enabled
    db.commit()
    return RedirectResponse("/queries", status_code=303)


@app.post("/queries/{query_id}/run")
def run_query(query_id: uuid.UUID, db: Session = Depends(get_db)):
    query = db.get(SearchQuery, query_id)
    if not query:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    try:
        result = run_search_for_query(db, query)
    except YouTubeAPIError as exc:
        return RedirectResponse(f"/queries?error={quote(str(exc))}", status_code=303)
    message = (
        f"«{query.name}»: найдено {result['found']}, "
        f"новых {result['created']}, обновлено {result['updated']}"
        + (f", пропущено Shorts/коротких {result.get('skipped', 0)}" if result.get("skipped") else "")
    )
    return RedirectResponse(f"/queries?ok={quote(message)}", status_code=303)


@app.post("/scores/recompute")
def recompute_scores(db: Session = Depends(get_db)):
    count = recompute_all_scores(db)
    message = f"Рейтинг пересчитан для {count} видео"
    return RedirectResponse(f"/videos?ok={quote(message)}", status_code=303)


@app.get("/videos", response_class=HTMLResponse)
def videos_page(request: Request, source: str = "", db: Session = Depends(get_db)):
    query = (
        select(Video)
        .options(joinedload(Video.channel), joinedload(Video.content_packs))
        .order_by(Video.viral_score.desc(), Video.published_at.desc().nullslast())
    )
    if source in ("topic_search", "watchlist_sync", "manual_import"):
        query = query.where(Video.source_type == source)
    videos = db.scalars(query).unique().all()
    items = [
        {
            "video": video,
            "why": json.loads(video.score_explanation or "[]"),
            "has_pack": bool(video.content_packs),
        }
        for video in videos
    ]
    return templates.TemplateResponse(
        request,
        "videos.html",
        {
            "items": items,
            "source": source,
            "ok_message": request.query_params.get("ok"),
            "error_message": request.query_params.get("error"),
        },
    )


@app.post("/videos/{video_id}/produce")
def produce_content(video_id: uuid.UUID, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Видео не найдено")

    video.workflow_status = "selected"
    db.commit()

    try:
        transcript = video.transcript
        if transcript is None or transcript.status != "ready":
            transcript = fetch_and_store_transcript(db, video)
    except TranscriptUnavailable as exc:
        video.workflow_status = "transcript_failed"
        db.commit()
        return RedirectResponse(f"/videos?error={quote(str(exc))}", status_code=303)

    try:
        pack = generate_content_pack(db, video, transcript)
    except AIContentError as exc:
        return RedirectResponse(f"/videos?error={quote(str(exc))}", status_code=303)

    return RedirectResponse(f"/content/{pack.id}", status_code=303)


@app.get("/content", response_class=HTMLResponse)
def content_list(request: Request, db: Session = Depends(get_db)):
    packs = db.scalars(
        select(ContentPack)
        .options(joinedload(ContentPack.video).joinedload(Video.channel))
        .order_by(ContentPack.created_at.desc())
    ).all()
    return templates.TemplateResponse(request, "content_list.html", {"packs": packs})


@app.get("/content/{pack_id}", response_class=HTMLResponse)
def content_detail(pack_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    pack = db.get(ContentPack, pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail="Материал не найден")
    return templates.TemplateResponse(
        request,
        "content_detail.html",
        {
            "pack": pack,
            "video": pack.video,
            "content": json.loads(pack.content_json or "{}"),
            "ok_message": request.query_params.get("ok"),
            "error_message": request.query_params.get("error"),
        },
    )


@app.post("/content/{pack_id}/publish-to-blog")
def publish_to_blog(pack_id: uuid.UUID, db: Session = Depends(get_db)):
    pack = db.get(ContentPack, pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail="Материал не найден")
    try:
        url = publish_pack_to_blog(db, pack)
    except PublishError as exc:
        return RedirectResponse(f"/content/{pack_id}?error={quote(str(exc))}", status_code=303)
    return RedirectResponse(
        f"/content/{pack_id}?ok={quote('Статья опубликована в блоге: ' + url)}", status_code=303
    )


@app.post("/content/{pack_id}/generate-images")
def generate_images(pack_id: uuid.UUID, db: Session = Depends(get_db)):
    from app.services.image_service import ImageGenError, generate_images_for_pack

    pack = db.get(ContentPack, pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail="Материал не найден")
    try:
        result = generate_images_for_pack(db, pack)
    except ImageGenError as exc:
        return RedirectResponse(f"/content/{pack_id}?error={quote(str(exc))}", status_code=303)
    msg = f"Иллюстрации готовы: статья {result['article']}, карусель {result['carousel']}"
    if result["errors"]:
        msg += f"; не удалось {len(result['errors'])} (часть промптов мог отклонить фильтр)"
    return RedirectResponse(f"/content/{pack_id}?ok={quote(msg)}", status_code=303)


@app.post("/videos/cleanup")
def cleanup_videos(db: Session = Depends(get_db)):
    removed = cleanup_ineligible_videos(db)
    message = f"Удалено неподходящих видео (Shorts и иностранные): {removed}"
    return RedirectResponse(f"/videos?ok={quote(message)}", status_code=303)


@app.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request, db: Session = Depends(get_db)):
    brand = get_brand_settings(db)
    return templates.TemplateResponse(
        request,
        "settings.html",
        {"brand": brand, "ok_message": request.query_params.get("ok")},
    )


@app.post("/settings")
def save_settings(
    editorial_style: str = Form(""),
    target_audience: str = Form(""),
    blog_cta: str = Form(""),
    image_style: str = Form(""),
    custom_instructions: str = Form(""),
    db: Session = Depends(get_db),
):
    brand = get_brand_settings(db)
    brand.editorial_style = editorial_style.strip()
    brand.target_audience = target_audience.strip()
    brand.blog_cta = blog_cta.strip()
    brand.image_style = image_style.strip()
    brand.custom_instructions = custom_instructions.strip()
    db.commit()
    return RedirectResponse(f"/settings?ok={quote('Настройки сохранены')}", status_code=303)


@app.get("/import", response_class=HTMLResponse)
def import_page(request: Request):
    return templates.TemplateResponse(
        request,
        "import.html",
        {
            "ok_message": request.query_params.get("ok"),
            "error_message": request.query_params.get("error"),
        },
    )


@app.post("/import")
def import_video(url: str = Form(...), db: Session = Depends(get_db)):
    try:
        video = import_video_by_url(db, url)
    except (ImportError_, YouTubeAPIError) as exc:
        return RedirectResponse(f"/import?error={quote(str(exc))}", status_code=303)
    return RedirectResponse(f"/videos?ok={quote('Ролик добавлен: ' + video.title)}", status_code=303)


@app.get("/channels", response_class=HTMLResponse)
def channels_page(request: Request, db: Session = Depends(get_db)):
    channels = list_watchlist(db)
    return templates.TemplateResponse(
        request,
        "channels.html",
        {
            "channels": channels,
            "ok_message": request.query_params.get("ok"),
            "error_message": request.query_params.get("error"),
        },
    )


@app.post("/channels")
def add_channel(url: str = Form(...), db: Session = Depends(get_db)):
    try:
        channel = add_watchlist_channel(db, url)
    except (ChannelImportError, YouTubeAPIError) as exc:
        return RedirectResponse(f"/channels?error={quote(str(exc))}", status_code=303)
    return RedirectResponse(
        f"/channels?ok={quote('Канал добавлен в watchlist: ' + channel.title)}", status_code=303
    )


@app.post("/channels/{channel_id}/remove")
def remove_channel(channel_id: uuid.UUID, db: Session = Depends(get_db)):
    from app.services.channel_service import remove_watchlist_channel

    remove_watchlist_channel(db, channel_id)
    return RedirectResponse("/channels", status_code=303)


@app.post("/channels/sync")
def sync_channels(db: Session = Depends(get_db)):
    try:
        totals = sync_watchlist(db)
    except YouTubeAPIError as exc:
        return RedirectResponse(f"/channels?error={quote(str(exc))}", status_code=303)
    message = (
        f"Синхронизировано каналов {totals['channels']}: новых {totals['created']}, "
        f"обновлено {totals['updated']}, пропущено Shorts {totals['skipped']}"
    )
    return RedirectResponse(f"/channels?ok={quote(message)}", status_code=303)
