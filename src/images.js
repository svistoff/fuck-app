const fs = require('fs');
const path = require('path');

// sharp пережимает фото и по умолчанию вырезает метаданные (включая GPS из EXIF).
// Если sharp не установлен (или не собрался) — безопасно оставляем оригинал.
let sharp = null;
try { sharp = require('sharp'); }
catch { console.warn('⚠  sharp не установлен — фото сохраняются без сжатия и без вырезания EXIF. Установи sharp на сервере.'); }

const MAX_SIDE = 1600;   // максимальная сторона фото
const QUALITY = 82;

// Обрабатывает уже сохранённый multer-файл «на месте»: ужимает и убирает EXIF.
// Возвращает итоговое имя файла (может смениться расширение на .jpg).
async function processUpload(file, uploadDir) {
  if (!sharp) return file.filename;
  const srcPath = file.path;
  const outName = file.filename.replace(/\.[^.]+$/, '') + '.jpg';
  const outPath = path.join(uploadDir, outName);
  try {
    const buf = await sharp(srcPath)
      .rotate()                                  // учесть ориентацию из EXIF до его удаления
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY })                // метаданные не переносятся => EXIF/GPS вырезаны
      .toBuffer();
    fs.writeFileSync(outPath, buf);
    if (outPath !== srcPath) { try { fs.unlinkSync(srcPath); } catch {} }
    return outName;
  } catch (e) {
    console.error('image processing failed, keeping original:', e.message);
    return file.filename;
  }
}

module.exports = { processUpload, hasSharp: () => !!sharp };
