"""Генерация иллюстраций к Content Pack через fal.ai.

Сюжет каждой картинки придумывает ИИ (``illustration_prompts`` в Content Pack),
а единый визуальный СТИЛЬ задаёт редактор (BrandSettings.image_style) — он
подмешивается в каждый промт. Готовые картинки перезаливаются на сайт
(uploads/blog через внутренний API) и привязываются к материалу: обложка +
иллюстрации в текст, отдельно — картинки для Instagram-карусели.

Генерация запускается по кнопке. Запросы к fal идут параллельно, чтобы уложиться
в разумное время.
"""

from __future__ import annotations

import asyncio
import base64
import json

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ContentPack
from app.services.settings_service import get_brand_settings

FAL_ENDPOINT = "https://fal.run/{model}"


class ImageGenError(RuntimeError):
    """Иллюстрации не удалось сгенерировать."""


def _categorize(placement: str) -> str:
    p = (placement or "").lower()
    if "carousel" in p:
        return "carousel"
    if "reel" in p or "teaser" in p:
        return "skip"
    return "article"


def _select(prompts: list[dict], settings) -> tuple[list[dict], list[dict]]:
    article, carousel = [], []
    for p in prompts:
        kind = _categorize(p.get("placement"))
        if kind == "article":
            article.append(p)
        elif kind == "carousel":
            carousel.append(p)
    return article[: settings.article_image_count], carousel[: settings.carousel_image_count]


async def _fal_generate(client: httpx.AsyncClient, prompt_text: str, image_size: str, settings) -> str:
    resp = await client.post(
        FAL_ENDPOINT.format(model=settings.fal_model),
        headers={"Authorization": f"Key {settings.fal_key}"},
        json={"prompt": prompt_text, "image_size": image_size, "num_images": 1},
        timeout=180.0,
    )
    if resp.status_code != 200:
        raise ImageGenError(f"fal.ai {resp.status_code}: {resp.text[:200]}")
    images = (resp.json() or {}).get("images") or []
    if not images or not images[0].get("url"):
        raise ImageGenError("fal.ai вернул пустой результат (возможно, промт отклонён фильтром)")
    return images[0]["url"]


async def _upload_to_site(client: httpx.AsyncClient, img_bytes: bytes, settings) -> str:
    b64 = base64.b64encode(img_bytes).decode()
    resp = await client.post(
        settings.blog_media_url,
        headers={"Authorization": f"Bearer {settings.blog_ingest_token}"},
        json={"ext": "png", "data_base64": b64},
        timeout=60.0,
    )
    if resp.status_code != 200:
        raise ImageGenError(f"сайт отклонил картинку ({resp.status_code}): {resp.text[:160]}")
    return (resp.json() or {}).get("url", "")


async def _make_one(client: httpx.AsyncClient, prompt: dict, image_size: str, style: str, settings) -> dict:
    scene = (prompt.get("prompt") or "").strip()
    final = scene + (f"\n\nSTYLE: {style}" if style else "")
    fal_url = await _fal_generate(client, final, image_size, settings)
    img = (await client.get(fal_url, timeout=120.0)).content
    site_url = await _upload_to_site(client, img, settings)
    return {"placement": prompt.get("placement", ""), "prompt": scene, "url": site_url}


async def _run_all(content: dict, style: str, settings) -> tuple[list, list]:
    article, carousel = _select(content.get("illustration_prompts") or [], settings)
    async with httpx.AsyncClient() as client:
        article_res, carousel_res = await asyncio.gather(
            asyncio.gather(
                *[_make_one(client, p, settings.fal_image_size_article, style, settings) for p in article],
                return_exceptions=True,
            ),
            asyncio.gather(
                *[_make_one(client, p, settings.fal_image_size_carousel, style, settings) for p in carousel],
                return_exceptions=True,
            ),
        )
    return article_res, carousel_res


def _split_ok(results: list) -> tuple[list, list]:
    ok, errors = [], []
    for item in results:
        if isinstance(item, Exception):
            errors.append(str(item))
        else:
            ok.append(item)
    return ok, errors


def generate_images_for_pack(db: Session, pack: ContentPack) -> dict:
    """Рисует иллюстрации к материалу и сохраняет ссылки в content_json."""
    settings = get_settings()
    if not settings.fal_key:
        raise ImageGenError("FAL_KEY не задан в .env завода — генерация картинок выключена.")
    if not settings.blog_media_url or not settings.blog_ingest_token:
        raise ImageGenError("Не настроена загрузка на сайт (BLOG_INGEST_URL и BLOG_INGEST_TOKEN).")

    content = json.loads(pack.content_json or "{}")
    if not (content.get("illustration_prompts")):
        raise ImageGenError("В материале нет промптов иллюстраций — нечего генерировать.")

    style = (get_brand_settings(db).image_style or "").strip()
    article_res, carousel_res = asyncio.run(_run_all(content, style, settings))

    article_imgs, a_err = _split_ok(article_res)
    carousel_imgs, c_err = _split_ok(carousel_res)

    content["generated_images"] = {"article": article_imgs, "carousel": carousel_imgs}
    # Обложка статьи = картинка с placement *hero*, иначе первая article-картинка.
    if article_imgs:
        hero = next((i for i in article_imgs if "hero" in (i["placement"] or "").lower()), article_imgs[0])
        if isinstance(content.get("blog_article"), dict):
            content["blog_article"]["cover_url"] = hero["url"]

    pack.content_json = json.dumps(content, ensure_ascii=False)
    db.commit()
    return {"article": len(article_imgs), "carousel": len(carousel_imgs), "errors": a_err + c_err}
