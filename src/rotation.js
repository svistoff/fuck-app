// «Карусель»: каждые 15 минут верхняя анкета уезжает вниз, по кругу.
// Реализовано без фоновых задач — порядок детерминированно вычисляется от времени,
// поэтому ничего не ломается при перезапуске сервера.

const ROTATE_SECONDS = 15 * 60;

// rows: активные НЕзакреплённые анкеты в стабильном базовом порядке (по id).
// Возвращаем их же, провёрнутые на bucket позиций влево.
function rotateActive(rows, now = Date.now()) {
  const n = rows.length;
  if (n <= 1) return rows.slice();
  const bucket = Math.floor(now / 1000 / ROTATE_SECONDS);
  const shift = ((bucket % n) + n) % n;
  return rows.slice(shift).concat(rows.slice(0, shift));
}

module.exports = { rotateActive, ROTATE_SECONDS };
