const config = require('./config');

async function sendMagicLink(email, link) {
  // Режим отладки: не шлём письмо, печатаем ссылку в консоль.
  if (config.MAIL_DEV_LOG || !config.RESEND_API_KEY) {
    console.log(`\n[magic link] ${email}\n${link}\n`);
    return { ok: true, dev: true };
  }

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial;max-width:480px;margin:0 auto">
      <h2 style="margin:0 0 12px">${config.SITE_NAME}</h2>
      <p>Нажмите кнопку, чтобы войти. Ссылка действует 30 минут.</p>
      <p style="margin:24px 0">
        <a href="${link}"
           style="display:inline-block;padding:14px 22px;border-radius:14px;
                  background:#ff5a6e;color:#fff;text-decoration:none;font-weight:600">
          Войти
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px">Если вы не запрашивали вход — просто проигнорируйте письмо.</p>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.MAIL_FROM,
      to: [email],
      subject: `Вход на ${config.SITE_NAME}`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
  return { ok: true };
}

module.exports = { sendMagicLink };
