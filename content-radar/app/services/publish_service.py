"""Публикация готовой статьи из Content Pack в блог (blog.fuck-app.us).

Берёт раздел ``blog_article`` из сгенерированного Content Pack, собирает из него
безопасный HTML (теги строит сам сервис, текст экранируется) и отправляет в
Node-блог через внутренний API POST /internal/blog/publish с общим токеном.
Публикация полуавтоматическая: вызывается по кнопке редактора.
"""

from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ContentPack, Video


class PublishError(RuntimeError):
    """Статью не удалось опубликовать."""


def _inline(text: str) -> str:
    """Экранирует текст и включает минимальное inline-форматирование (**жирный**)."""
    out = html.escape(text.strip())
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    return out


def _md_block_to_html(text: str) -> str:
    """Лёгкий markdown → HTML: абзацы, списки, подзаголовки. Теги строим сами,
    пользовательский/ИИ-текст экранируется — вставка произвольного HTML невозможна."""
    if not text:
        return ""
    blocks = re.split(r"\n{2,}", text.strip())
    parts: list[str] = []
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        # Маркированный список
        if all(re.match(r"^\s*[-*•]\s+", ln) for ln in lines):
            cleaned = [re.sub(r"^\s*[-*•]\s+", "", ln) for ln in lines]
            items = "".join("<li>" + _inline(ln) + "</li>" for ln in cleaned)
            parts.append(f"<ul>{items}</ul>")
            continue
        # Нумерованный список
        if all(re.match(r"^\s*\d+[.)]\s+", ln) for ln in lines):
            cleaned = [re.sub(r"^\s*\d+[.)]\s+", "", ln) for ln in lines]
            items = "".join("<li>" + _inline(ln) + "</li>" for ln in cleaned)
            parts.append(f"<ol>{items}</ol>")
            continue
        # Подзаголовок markdown (### / ##)
        m = re.match(r"^\s*#{2,4}\s+(.*)$", lines[0])
        if m and len(lines) == 1:
            parts.append(f"<h3>{_inline(m.group(1))}</h3>")
            continue
        # Обычный абзац (переносы строк → <br>)
        joined = "<br>".join(_inline(ln) for ln in lines)
        parts.append(f"<p>{joined}</p>")
    return "".join(parts)


def build_article_payload(pack: ContentPack, video: Video) -> dict:
    """Собирает payload для Node-API из blog_article Content Pack'а."""
    content = json.loads(pack.content_json or "{}")
    article = content.get("blog_article") or {}
    if not article:
        raise PublishError("В материале нет раздела «Статья» — публиковать нечего.")

    h1 = (article.get("h1") or video.title or "").strip()
    seo_title = (article.get("seo_title") or h1).strip()
    if not seo_title:
        raise PublishError("У статьи нет заголовка.")

    # Вступление: первый абзац — как лид, остальное уходит в тело.
    intro = (article.get("intro") or "").strip()
    intro_paras = re.split(r"\n{2,}", intro) if intro else []
    lead = intro_paras[0].strip() if intro_paras else ""
    rest_intro = "\n\n".join(intro_paras[1:]).strip() if len(intro_paras) > 1 else ""

    body_parts: list[str] = []
    if rest_intro:
        body_parts.append(_md_block_to_html(rest_intro))
    for section in article.get("sections") or []:
        heading = (section.get("h2") or "").strip()
        if heading:
            body_parts.append(f"<h2>{_inline(heading)}</h2>")
        body_parts.append(_md_block_to_html(section.get("body_markdown") or ""))
    conclusion = (article.get("conclusion") or "").strip()
    if conclusion:
        body_parts.append("<h2>Вывод</h2>")
        body_parts.append(_md_block_to_html(conclusion))
    disclaimer = (article.get("editorial_disclaimer") or "").strip()
    if disclaimer:
        body_parts.append(f'<p class="blog-source">{_inline(disclaimer)}</p>')

    faq = [
        {"question": (q.get("question") or "").strip(), "answer": (q.get("answer") or "").strip()}
        for q in (article.get("faq") or [])
        if (q.get("question") and q.get("answer"))
    ]

    return {
        "external_id": str(pack.id),
        "slug": article.get("slug_suggestion") or h1,
        "title": seo_title,
        "h1": h1,
        "meta_description": (article.get("seo_description") or "").strip(),
        "lead": lead,
        "body_html": "".join(p for p in body_parts if p),
        "faq": faq,
        "source_url": video.url,
        "source_title": video.title,
        "status": "published",
    }


def publish_pack_to_blog(db: Session, pack: ContentPack) -> str:
    """Публикует Content Pack в блог и сохраняет ссылку. Возвращает URL статьи."""
    settings = get_settings()
    if not settings.blog_ingest_url or not settings.blog_ingest_token:
        raise PublishError(
            "Публикация в блог не настроена. Задайте BLOG_INGEST_URL и "
            "BLOG_INGEST_TOKEN в .env завода (токен должен совпадать с "
            "BLOG_INGEST_TOKEN на стороне блога)."
        )

    payload = build_article_payload(pack, pack.video)

    try:
        response = httpx.post(
            settings.blog_ingest_url,
            json=payload,
            headers={"Authorization": f"Bearer {settings.blog_ingest_token}"},
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise PublishError(f"Не удалось связаться с блогом: {exc}") from exc

    if response.status_code != 200:
        detail = ""
        try:
            detail = response.json().get("error", "")
        except Exception:
            detail = response.text[:200]
        raise PublishError(f"Блог отклонил статью ({response.status_code}): {detail}")

    data = response.json()
    url = data.get("url", "")
    pack.blog_url = url
    pack.blog_published_at = datetime.now(timezone.utc)
    db.commit()
    return url
