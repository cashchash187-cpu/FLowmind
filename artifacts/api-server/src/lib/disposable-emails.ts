const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', 'guerrillamail.com', '10minutemail.com',
  'sharklasers.com', 'throwawaymail.com', 'trashmail.com', 'yopmail.com',
  'fakeinbox.com', 'spamgourmet.com', 'mailnull.com', 'dispostable.com',
  'maildrop.cc', 'spamgourmet.org', 'getairmail.com', 'jetable.fr.nf',
  'guerrillamailblock.com', 'grr.la', 'spam4.me', 'discard.email',
  'filzmail.de', 'trbvm.com', 'spamavert.com', 'thisisnotmyrealemail.com',
  'throwam.com', 'spamfree24.org', 'mailexpire.com', 'spambox.us',
  'trashmail.at', 'trashmail.io', 'trashmail.me', 'trashmail.net',
  'trashmail.org', 'crap.handcuffs.org', 'duck2.club', 'spamwc.de',
  'tempr.email', 'emailondeck.com', 'tempinbox.co.uk', 'tempinbox.com',
  'sogetthis.com', 'spamgob.com', 'tempmail.net', 'tmailinator.com',
  'nospamfor.us', 'nospamthanks.info', 'spamwc.com', 'mailnew.com',
  'filzmail.com', 'spamherelots.com', 'spamhereplease.com', 'rejectmail.com',
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain);
}
