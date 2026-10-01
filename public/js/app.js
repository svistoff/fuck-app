// Удаление фото в личном кабинете без перезагрузки
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.photo-del[data-id]');
  if (!btn) return;
  e.preventDefault();
  if (!confirm('Удалить фото?')) return;
  const id = btn.getAttribute('data-id');
  try {
    const res = await fetch(`/profile/photos/${id}/delete`, { method: 'POST' });
    if (res.ok) btn.closest('.photo-thumb')?.remove();
  } catch (_) {}
});

// Счётчик символов краткого описания
const short = document.querySelector('textarea[name="short_desc"]');
if (short) {
  const max = short.getAttribute('maxlength') || 120;
  const hint = document.createElement('small');
  hint.className = 'muted';
  const upd = () => { hint.textContent = `${short.value.length}/${max}`; };
  short.insertAdjacentElement('afterend', hint);
  short.addEventListener('input', upd);
  upd();
}

// Карусель фото на странице анкеты: стрелки + точки + синхронизация при свайпе
document.querySelectorAll('[data-carousel]').forEach((car) => {
  const track = car.querySelector('.carousel-track');
  const slides = car.querySelectorAll('.slide');
  const dots = car.querySelectorAll('.dot');
  if (!track || slides.length < 2) return;
  const go = (i) => {
    const idx = Math.max(0, Math.min(slides.length - 1, i));
    slides[idx].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };
  const current = () => Math.round(track.scrollLeft / track.clientWidth);
  car.querySelector('.next')?.addEventListener('click', () => go(current() + 1));
  car.querySelector('.prev')?.addEventListener('click', () => go(current() - 1));
  track.addEventListener('scroll', () => {
    const i = current();
    dots.forEach((d, di) => d.classList.toggle('active', di === i));
  }, { passive: true });
  dots.forEach((d, di) => d.addEventListener('click', () => go(di)));
});

// Бесконечная подгрузка ленты каталога
(function () {
  var sentinel = document.getElementById('feed-sentinel');
  var feed = document.getElementById('feed');
  if (!sentinel || !feed) return;
  var loading = document.getElementById('feed-loading');
  var busy = false;
  function more() { return sentinel.getAttribute('data-more') === '1'; }
  async function load() {
    if (busy || !more()) return;
    busy = true;
    if (loading) loading.hidden = false;
    var page = sentinel.getAttribute('data-next');
    try {
      var r = await fetch('/catalog/more?page=' + page, { headers: { 'X-Requested-With': 'fetch' } });
      var data = await r.json();
      if (data.html) feed.insertAdjacentHTML('beforeend', data.html);
      sentinel.setAttribute('data-next', String(Number(page) + 1));
      sentinel.setAttribute('data-more', data.more ? '1' : '0');
    } catch (e) { /* тихо: попробуем при следующей прокрутке */ }
    if (loading) loading.hidden = true;
    busy = false;
    if (!more() && obs) obs.disconnect();
  }
  var obs = new IntersectionObserver(function (entries) {
    if (entries.some(function (e) { return e.isIntersecting; })) load();
  }, { rootMargin: '600px' });
  obs.observe(sentinel);
})();

// Полноэкранный просмотр фото (лайтбокс) на странице анкеты
(function () {
  var lb = document.getElementById('lightbox');
  if (!lb) return;
  var img = lb.querySelector('.lb-img');
  var imgs = Array.prototype.slice.call(document.querySelectorAll('.carousel img[data-full]'));
  if (!imgs.length) return;
  var idx = 0;
  function show(i) {
    idx = (i + imgs.length) % imgs.length;
    img.src = imgs[idx].getAttribute('data-full');
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function hide() { lb.hidden = true; img.src = ''; document.body.style.overflow = ''; }
  imgs.forEach(function (el, i) {
    el.style.cursor = 'zoom-in';
    el.addEventListener('click', function () { show(i); });
  });
  lb.querySelector('.lb-close').addEventListener('click', hide);
  lb.querySelector('.lb-next').addEventListener('click', function (e) { e.stopPropagation(); show(idx + 1); });
  lb.querySelector('.lb-prev').addEventListener('click', function (e) { e.stopPropagation(); show(idx - 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) hide(); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') hide();
    if (e.key === 'ArrowRight') show(idx + 1);
    if (e.key === 'ArrowLeft') show(idx - 1);
  });
})();
