"""Редактирование статьи из Content Pack: вручную и через ИИ по указанию редактора.

Перед каждым сохранением прежняя версия статьи кладётся в ``blog_article_prev``,
так что последнюю правку (свою или ИИ) можно откатить одной кнопкой.
Поля, которые форма не редактирует (например, cover_url от генерации картинок),
переносятся из старой версии как есть.
"""

from __future__ import annotations

import copy
import json

from sqlalchemy.orm import Session

from app.models import ContentPack, Transcript
from app.services.ai_content_service import (
    AIContentError,
    _brand_block,
    _chat_completion,
    _parse_json,
    _repair_json,
)
from app.services.settings_service import get_brand_settings

TEXT_FIELDS = ("seo_title", "seo_description", "h1", "slug_suggestion", "intro", "conclusion", "editorial_disclaimer")
MAX_TRANSCRIPT_CHARS = 8000

REVISE_SYSTEM_PROMPT = (
    "Ты — редактор блога о взрослых отношениях, знакомствах, интимной жизни и "
    "психологии отношений. Пишешь по-русски.\n"
    "Тебе дают готовую статью в JSON и указание редактора, что поправить.\n"
    "ПРАВИЛА:\n"
    "1. Внеси правки строго по указанию. То, о чём указание не говорит, оставь "
    "по смыслу как есть (можно лишь сгладить стыки).\n"
    "2. Сохрани структуру JSON и все поля. Не сокращай статью, если об этом не просили.\n"
    "3. Если в указании просят добавить факты или примеры — бери их из транскрипта "
    "исходного видео (если он дан), не выдумывай. Транскрипт не копируй дословно.\n"
    "4. Не давай медицинских, психотерапевтических или юридических гарантий; для "
    "чувствительных тем сохраняй мягкую рекомендацию обратиться к специалисту.\n"
    "5. Без порнографии и откровенного сексуального контента, без несовершеннолетних.\n"
    "Верни СТРОГО один JSON-объект статьи той же структуры, без markdown-обёртки."
)

ARTICLE_SHAPE = """Структура статьи (верни её целиком):
{"seo_title": "до 60 знаков", "seo_description": "до 160 знаков", "h1": "...",
 "slug_suggestion": "translit-slug", "intro": "...",
 "sections": [{"h2": "...", "body_markdown": "..."}],
 "faq": [{"question": "...", "answer": "..."}],
 "conclusion": "...", "editorial_disclaimer": "..."}"""


class ArticleEditError(RuntimeError):
    """Статью не удалось изменить."""


def _load(pack: ContentPack) -> tuple[dict, dict]:
    content = json.loads(pack.content_json or "{}")
    article = content.get("blog_article")
    if not isinstance(article, dict) or not article:
        raise ArticleEditError("В материале нет статьи — редактировать нечего.")
    return content, article


def _clean(article: dict) -> dict:
    """Приводит статью к ожидаемым типам и выкидывает пустые разделы/вопросы."""
    out = {}
    for key in TEXT_FIELDS:
        out[key] = str(article.get(key) or "").strip()
    out["sections"] = [
        {"h2": str(s.get("h2") or "").strip(), "body_markdown": str(s.get("body_markdown") or "").strip()}
        for s in (article.get("sections") or [])
        if isinstance(s, dict) and (str(s.get("h2") or "").strip() or str(s.get("body_markdown") or "").strip())
    ]
    out["faq"] = [
        {"question": str(q.get("question") or "").strip(), "answer": str(q.get("answer") or "").strip()}
        for q in (article.get("faq") or [])
        if isinstance(q, dict) and str(q.get("question") or "").strip() and str(q.get("answer") or "").strip()
    ]
    return out


def _store(db: Session, pack: ContentPack, content: dict, old: dict, edited: dict) -> None:
    new_article = copy.deepcopy(old)  # сохраняем поля, которых нет в форме (cover_url и т.п.)
    new_article.update(_clean(edited))
    if not (new_article.get("h1") or new_article.get("seo_title")):
        raise ArticleEditError("У статьи должен остаться заголовок (H1 или SEO title).")
    content["blog_article_prev"] = old
    content["blog_article"] = new_article
    pack.content_json = json.dumps(content, ensure_ascii=False)
    db.commit()


def article_from_form(form) -> dict:
    """Собирает статью из полей формы редактирования (sections/faq — с номерами)."""
    article = {key: form.get(key, "") for key in TEXT_FIELDS}
    sections, faq = [], []
    i = 0
    while f"section_h2_{i}" in form or f"section_body_{i}" in form:
        sections.append({"h2": form.get(f"section_h2_{i}", ""), "body_markdown": form.get(f"section_body_{i}", "")})
        i += 1
    i = 0
    while f"faq_q_{i}" in form or f"faq_a_{i}" in form:
        faq.append({"question": form.get(f"faq_q_{i}", ""), "answer": form.get(f"faq_a_{i}", "")})
        i += 1
    article["sections"] = sections
    article["faq"] = faq
    return article


def save_manual(db: Session, pack: ContentPack, edited: dict) -> None:
    content, old = _load(pack)
    _store(db, pack, content, old, edited)


def revise_with_ai(db: Session, pack: ContentPack, instruction: str) -> None:
    instruction = (instruction or "").strip()
    if not instruction:
        raise ArticleEditError("Напишите, что поправить.")
    content, old = _load(pack)

    parts = [f"УКАЗАНИЕ РЕДАКТОРА:\n{instruction[:2000]}"]
    brand_block = _brand_block(get_brand_settings(db))
    if brand_block:
        parts.append("РЕДАКЦИОННЫЕ НАСТРОЙКИ БРЕНДА (учитывай):\n" + brand_block)
    parts.append(ARTICLE_SHAPE)
    parts.append("ТЕКУЩАЯ СТАТЬЯ:\n" + json.dumps(_clean(old), ensure_ascii=False))
    transcript = db.get(Transcript, pack.transcript_id) if pack.transcript_id else None
    if transcript and transcript.raw_text:
        parts.append(
            "Транскрипт исходного видео (источник фактов, не копировать):\n"
            f'"""\n{transcript.raw_text[:MAX_TRANSCRIPT_CHARS]}\n"""'
        )

    try:
        raw = _chat_completion(REVISE_SYSTEM_PROMPT, "\n\n".join(parts))
        try:
            data = _parse_json(raw)
        except AIContentError:
            data = _parse_json(_repair_json(raw))
    except AIContentError as exc:
        raise ArticleEditError(f"ИИ не справился: {exc}") from exc
    except Exception as exc:
        raise ArticleEditError(f"Ошибка запроса к ИИ: {str(exc)[:200]}") from exc

    revised = data.get("blog_article") if isinstance(data.get("blog_article"), dict) else data
    if not isinstance(revised, dict) or not revised.get("sections"):
        raise ArticleEditError("ИИ вернул неполную статью — ничего не изменено, попробуйте ещё раз.")
    # Поля, которые ИИ не вернул, остаются прежними (а не затираются пустыми).
    merged = _clean(old)
    for key in (*TEXT_FIELDS, "sections", "faq"):
        if key in revised:
            merged[key] = revised[key]
    _store(db, pack, content, old, merged)


def restore_previous(db: Session, pack: ContentPack) -> None:
    content = json.loads(pack.content_json or "{}")
    prev = content.get("blog_article_prev")
    if not isinstance(prev, dict) or not prev:
        raise ArticleEditError("Предыдущей версии нет.")
    content["blog_article_prev"], content["blog_article"] = content.get("blog_article"), prev
    pack.content_json = json.dumps(content, ensure_ascii=False)
    db.commit()
