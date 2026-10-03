"""Сборка Reels-видео (вариант A: слайд-шоу).

Берёт выбранный сценарий Reels из Content Pack, озвучивает его через
OpenAI-совместимый TTS, собирает вертикальное видео 1080x1920 из уже
сгенерированных иллюстраций (ffmpeg), накладывает субтитры и заливает готовый
mp4 на сайт. Instagram постится вручную — здесь только сборка файла.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ContentPack


class ReelsError(RuntimeError):
    """Reels-видео не удалось собрать."""


def _tts(text: str, settings) -> bytes:
    key, base = settings.tts_credentials()
    if not key:
        raise ReelsError("Не задан ключ для озвучки (AI_API_KEY или TTS_API_KEY).")
    url = (base or "https://api.openai.com/v1").rstrip("/") + "/audio/speech"
    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {key}"},
        json={"model": settings.tts_model, "voice": settings.tts_voice,
              "input": text[:4000], "response_format": "mp3"},
        timeout=120.0,
    )
    if resp.status_code != 200:
        raise ReelsError(f"Озвучка не удалась (TTS {resp.status_code}): {resp.text[:160]}")
    return resp.content


def _probe_duration(path: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nokey=1:noprint_wrappers=1", path],
            capture_output=True, text=True, timeout=30,
        )
        return float(out.stdout.strip())
    except Exception:
        return 0.0


def _ts(sec: float) -> str:
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")


def _wrap(text: str, width: int = 32) -> str:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return "\n".join(lines[:2])  # не больше 2 строк на реплику


def _write_srt(text: str, total: float, path: str) -> None:
    chunks = [c.strip() for c in re.split(r"(?<=[.!?…])\s+", text.strip()) if c.strip()] or [text]
    total_chars = sum(len(c) for c in chunks) or 1
    t, blocks = 0.0, []
    for i, c in enumerate(chunks, 1):
        dur = total * len(c) / total_chars
        start, end = t, min(total, t + dur)
        t = end
        blocks.append(f"{i}\n{_ts(start)} --> {_ts(end)}\n{_wrap(c)}\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(blocks))


def _ffmpeg_slideshow(images: list[str], audio: str, srt: str, duration: float, out: str, settings) -> None:
    n = len(images)
    per = max(1.0, duration / n)
    w, h, fps = settings.video_width, settings.video_height, settings.video_fps
    cmd = ["ffmpeg", "-y"]
    for p in images:
        cmd += ["-loop", "1", "-t", f"{per:.3f}", "-i", p]
    cmd += ["-i", audio]
    parts = [
        f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h},setsar=1,fps={fps}[v{i}]"
        for i in range(n)
    ]
    concat = "".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vc]"
    style = ("FontName=DejaVu Sans,FontSize=15,PrimaryColour=&H00FFFFFF&,"
             "OutlineColour=&H00000000&,BorderStyle=1,Outline=2,Shadow=0,"
             "Alignment=2,MarginV=140")
    subs = f"[vc]subtitles={srt}:force_style='{style}'[vout]"
    filtr = ";".join(parts + [concat, subs])
    cmd += ["-filter_complex", filtr, "-map", "[vout]", "-map", f"{n}:a",
            "-shortest", "-r", str(fps), "-c:v", "libx264", "-preset", "veryfast",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", out]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if res.returncode != 0 or not os.path.exists(out):
        raise ReelsError("ffmpeg: " + (res.stderr[-300:] if res.stderr else "ошибка сборки видео"))


def _upload(data: bytes, settings) -> str:
    if not settings.blog_media_url or not settings.blog_ingest_token:
        raise ReelsError("Не настроена загрузка на сайт (BLOG_INGEST_URL и BLOG_INGEST_TOKEN).")
    resp = httpx.post(
        settings.blog_media_url,
        headers={"Authorization": f"Bearer {settings.blog_ingest_token}"},
        json={"ext": "mp4", "data_base64": base64.b64encode(data).decode()},
        timeout=180.0,
    )
    if resp.status_code != 200:
        raise ReelsError(f"сайт отклонил видео ({resp.status_code}): {resp.text[:160]}")
    return (resp.json() or {}).get("url", "")


def build_reels_video(db: Session, pack: ContentPack, reel_index: int = 0) -> str:
    """Собирает Reels-слайдшоу и сохраняет ссылку в content_json."""
    settings = get_settings()
    content = json.loads(pack.content_json or "{}")

    reels = content.get("reels") or []
    if not reels:
        raise ReelsError("В материале нет сценариев Reels.")
    reel = reels[min(max(reel_index, 0), len(reels) - 1)]
    narration = " ".join(x for x in [reel.get("hook"), reel.get("script")] if x).strip()
    if not narration:
        raise ReelsError("В выбранном Reels нет текста для озвучки.")

    gi = content.get("generated_images") or {}
    image_urls = [i["url"] for i in (gi.get("article") or []) + (gi.get("carousel") or []) if i.get("url")]
    if not image_urls:
        raise ReelsError("Сначала сгенерируйте иллюстрации — из них собирается видео.")

    with tempfile.TemporaryDirectory() as td:
        audio = os.path.join(td, "voice.mp3")
        with open(audio, "wb") as f:
            f.write(_tts(narration, settings))
        duration = _probe_duration(audio) or float(reel.get("duration_seconds") or 30)

        local_imgs = []
        with httpx.Client(timeout=120.0) as client:
            for idx, url in enumerate(image_urls):
                p = os.path.join(td, f"img{idx}.jpg")
                with open(p, "wb") as f:
                    f.write(client.get(url).content)
                local_imgs.append(p)

        srt = os.path.join(td, "subs.srt")
        _write_srt(narration, duration, srt)

        out = os.path.join(td, "reel.mp4")
        _ffmpeg_slideshow(local_imgs, audio, srt, duration, out, settings)
        with open(out, "rb") as f:
            video_bytes = f.read()

    url = _upload(video_bytes, settings)
    content["reels_video"] = {
        "url": url,
        "reel_index": reel_index,
        "caption": reel.get("caption", ""),
        "cta": reel.get("cta", ""),
    }
    pack.content_json = json.dumps(content, ensure_ascii=False)
    db.commit()
    return url
