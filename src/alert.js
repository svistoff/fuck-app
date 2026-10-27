// Уведомления владельцу в Telegram о поломках (например, не ушло письмо для входа).
// Без ALERT_TG_TOKEN / ALERT_TG_CHAT ничего не делает. Никогда не бросает
// исключений — уведомление не должно ронять запрос, в котором случилась ошибка.

const config = require('./config');

const lastSent = new Map(); // ключ -> время последней отправки (антиспам)

function enabled() {
  return Boolean(config.ALERT_TG_TOKEN && config.ALERT_TG_CHAT);
}

// key — тип проблемы: одинаковые сообщения шлём не чаще раза в throttleMs.
async function alert(key, text, { throttleMs = 15 * 60 * 1000 } = {}) {
  if (!enabled()) return false;
  const now = Date.now();
  if (key && lastSent.has(key) && now - lastSent.get(key) < throttleMs) return false;
  if (key) lastSent.set(key, now);
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.ALERT_TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.ALERT_TG_CHAT,
        text: `${config.SITE_NAME}\n${text}`.slice(0, 4000),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.error('alert: Telegram ответил', res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error('alert: не удалось отправить в Telegram:', e.message);
    return false;
  }
}

module.exports = { alert, enabled };
