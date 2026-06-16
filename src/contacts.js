// Единый источник правды по контактам.
// inputType: 'phone' — вводится номер; 'username' — вводится ник/логин.
// buildLink(value) -> URL для перехода, или null если открыть напрямую нельзя.

function digits(v) {
  return String(v || '').replace(/[^\d]/g, '');
}
function nick(v) {
  return String(v || '').trim().replace(/^@/, '').replace(/\s+/g, '');
}

const CONTACTS = {
  phone: {
    label: 'Телефон',
    inputType: 'phone',
    placeholder: '+7 900 000-00-00',
    // Звонок
    buildLink: (v) => (digits(v) ? `tel:+${digits(v)}` : null),
  },
  whatsapp: {
    label: 'WhatsApp',
    inputType: 'phone',
    placeholder: '+7 900 000-00-00',
    // Открывает чат по номеру — официальный формат wa.me
    buildLink: (v) => (digits(v) ? `https://wa.me/${digits(v)}` : null),
  },
  telegram: {
    label: 'Telegram',
    inputType: 'username',
    placeholder: 'username (без @)',
    // По username — публично-безопасный вариант
    buildLink: (v) => (nick(v) ? `https://t.me/${nick(v)}` : null),
  },
  bip: {
    label: 'BiP',
    inputType: 'phone',
    placeholder: '+7 900 000-00-00',
    // TODO: подтвердить схему диалога BiP при тесте на устройстве.
    // Пока безопасный фолбэк — звонок по номеру.
    buildLink: (v) => (digits(v) ? `tel:+${digits(v)}` : null),
  },
  max: {
    label: 'MAX',
    inputType: 'username',
    placeholder: 'username',
    // У MAX нет ссылки «диалог по номеру», только профиль по нику
    buildLink: (v) => (nick(v) ? `https://max.ru/${nick(v)}` : null),
  },
  instagram: {
    label: 'Instagram',
    inputType: 'username',
    placeholder: 'username (без @)',
    buildLink: (v) => (nick(v) ? `https://instagram.com/${nick(v)}` : null),
  },
};

const CONTACT_ORDER = ['phone', 'whatsapp', 'telegram', 'bip', 'max', 'instagram'];

function normalizeValue(type, value) {
  const def = CONTACTS[type];
  if (!def) return '';
  const v = String(value || '').trim();
  if (!v) return '';
  return def.inputType === 'phone' ? `+${digits(v)}` : nick(v);
}

module.exports = { CONTACTS, CONTACT_ORDER, normalizeValue };
