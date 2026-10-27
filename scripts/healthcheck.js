// Проверка, что всё живо, + уведомление в Telegram, если что-то сломалось.
//
//   node scripts/healthcheck.js          — проверить и показать отчёт
//   node scripts/healthcheck.js --test   — отправить тестовое сообщение в Telegram
//
// Для cron (раз в 10 минут):
//   */10 * * * * cd /var/www/fuck-app && /usr/bin/node scripts/healthcheck.js >> /var/log/fuck-app-health.log 2>&1
//
// Что проверяется:
//   • сайт (BASE_URL), блог (BLOG_BASE_URL) и доп. адреса из HEALTH_EXTRA_URLS отвечают 2xx;
//   • почтовый домен из MAIL_FROM подтверждён в Resend (иначе не уходят письма для входа);
//   • HTTPS-сертификаты этих адресов не истекают в ближайшие 14 дней.
// Уведомление приходит только при смене состояния: «сломалось» и «починилось».

const fs = require('fs');
const path = require('path');
const tls = require('tls');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT); // config.js читает .env из текущей папки
const config = require('../src/config');
const { alert, enabled } = require('../src/alert');

const STATE_FILE = path.join(ROOT, 'data', 'healthcheck-state.json');
const CERT_MIN_DAYS = 14;

async function checkUrl(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (res.status >= 200 && res.status < 300) return { ok: true, info: `${res.status}` };
    return { ok: false, info: `ответ ${res.status}` };
  } catch (e) {
    return { ok: false, info: `не отвечает (${e.cause?.code || e.name})` };
  }
}

function certDaysLeft(host) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      if (!cert || !cert.valid_to) return resolve({ ok: false, info: 'сертификат не получен' });
      const days = Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000);
      resolve(days >= CERT_MIN_DAYS
        ? { ok: true, info: `ещё ${days} дн.` }
        : { ok: false, info: `истекает через ${days} дн. — проверь certbot renew` });
    });
    sock.on('error', (e) => resolve({ ok: false, info: `ошибка TLS (${e.code || e.message})` }));
    sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, info: 'таймаут TLS' }); });
  });
}

async function checkMailDomain() {
  const m = String(config.MAIL_FROM).match(/@([^>\s]+)/);
  const domain = m ? m[1].toLowerCase() : '';
  if (!config.RESEND_API_KEY || !domain) return { ok: null, info: 'не настроено (нет RESEND_API_KEY или MAIL_FROM)' };
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: null, info: 'ключ Resend только на отправку — статус домена не проверить' };
    }
    if (!res.ok) return { ok: null, info: `Resend ответил ${res.status}` };
    const list = (await res.json()).data || [];
    const d = list.find((x) => String(x.name).toLowerCase() === domain);
    if (!d) return { ok: false, info: `домена ${domain} нет в Resend` };
    return d.status === 'verified'
      ? { ok: true, info: `${domain}: verified` }
      : { ok: false, info: `${domain}: ${d.status} — письма для входа не уходят` };
  } catch (e) {
    return { ok: null, info: `Resend недоступен (${e.cause?.code || e.name})` };
  }
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  if (process.argv.includes('--test')) {
    if (!enabled()) { console.log('Уведомления не настроены: задай ALERT_TG_TOKEN и ALERT_TG_CHAT в .env'); process.exit(1); }
    const ok = await alert(null, '✅ Тест: уведомления о поломках работают.');
    console.log(ok ? 'Тестовое сообщение отправлено в Telegram.' : 'Не отправилось — смотри ошибку выше.');
    process.exit(ok ? 0 : 1);
  }

  const urls = [`${config.BASE_URL}/`, config.BLOG_BASE_URL, ...config.HEALTH_EXTRA_URLS];
  const checks = [];
  for (const u of [...new Set(urls)]) checks.push({ name: `Адрес ${u}`, ...(await checkUrl(u)) });
  checks.push({ name: 'Почта (домен в Resend)', ...(await checkMailDomain()) });
  const hosts = [...new Set(urls.filter((u) => u.startsWith('https://')).map((u) => new URL(u).hostname))];
  for (const h of hosts) checks.push({ name: `Сертификат ${h}`, ...(await certDaysLeft(h)) });

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${stamp}] Проверка ${config.SITE_NAME}`);
  for (const c of checks) console.log(`  ${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'} ${c.name}: ${c.info}`);

  // Уведомляем только об изменениях: было ок -> сломалось, было сломано -> починилось.
  const prev = loadState();
  const next = {};
  const broke = [];
  const fixed = [];
  for (const c of checks) {
    if (c.ok === null) { next[c.name] = prev[c.name]; continue; } // проверить не удалось — состояние не трогаем
    next[c.name] = c.ok ? 'ok' : 'fail';
    if (!c.ok && prev[c.name] !== 'fail') broke.push(`• ${c.name}: ${c.info}`);
    if (c.ok && prev[c.name] === 'fail') fixed.push(`• ${c.name}`);
  }
  if (broke.length) await alert(null, `🔴 Сломалось:\n${broke.join('\n')}`);
  if (fixed.length) await alert(null, `🟢 Починилось:\n${fixed.join('\n')}`);
  saveState(next);

  if (!enabled() && (broke.length || fixed.length)) {
    console.log('  (уведомление не отправлено: не заданы ALERT_TG_TOKEN и ALERT_TG_CHAT)');
  }
  process.exit(checks.some((c) => c.ok === false) ? 1 : 0);
}

main();
