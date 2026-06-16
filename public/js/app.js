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
