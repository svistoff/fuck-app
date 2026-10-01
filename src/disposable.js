// Список доменов одноразовых почтовых ящиков. Дополняй по мере необходимости.
const DISPOSABLE = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'temp-mail.org', 'tempmail.com',
  'tempmail.net', 'tempmailo.com', 'tempr.email', 'guerrillamail.com', 'guerrillamail.net',
  'guerrillamail.org', 'sharklasers.com', 'grr.la', 'mailinator.com', 'mailinator.net',
  'maildrop.cc', 'getnada.com', 'nada.email', 'dispostable.com', 'yopmail.com', 'yopmail.net',
  'trashmail.com', 'trashmail.net', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com',
  'mohmal.com', 'emailondeck.com', 'mailnesia.com', 'spamgourmet.com', 'tempinbox.com',
  'mytemp.email', 'moakt.com', 'inboxkitten.com', 'tempemail.co', 'mailcatch.com',
  'spam4.me', 'mailsac.com', 'discard.email', 'fakemailgenerator.com', 'temp-mail.io',
  'tmail.ws', 'minuteinbox.com', 'burnermail.io', 'mail-temp.com', 'emailfake.com',
  'mailpoof.com', 'tempmailaddress.com', 'cs.email', 'luxusmail.org', 'vmani.com',
  'rootfest.net', 'byom.de', 'tmpmail.org', 'tmpmail.net', 'mailtm.com', 'tmpbox.net',
]);

function isDisposable(email) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  return DISPOSABLE.has(domain);
}

module.exports = { isDisposable, DISPOSABLE };
