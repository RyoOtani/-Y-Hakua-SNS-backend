const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const normalizeDomain = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
);

const parseCsv = (value) => (
  String(value || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean)
);

const parseEmailAllowlist = (value) => (
  parseCsv(value)
    .map((email) => normalizeEmail(email))
    .filter((email) => email.includes('@'))
);

const parseEmailBlocklist = (value) => (
  parseCsv(value)
    .map((email) => normalizeEmail(email))
    .filter((email) => email.includes('@'))
);

const parseEmailDomainAllowlist = (value) => (
  parseCsv(value)
    .map((entry) => normalizeDomain(entry))
    .filter(Boolean)
);

const getAppEmailAllowlistSet = () => new Set(parseEmailAllowlist(process.env.APP_EMAIL_ALLOWLIST));

const getAppEmailDomainAllowlistSet = () => {
  const domainEntries = parseEmailDomainAllowlist(process.env.APP_EMAIL_DOMAIN_ALLOWLIST);
  const compatibilityDomainEntries = parseCsv(process.env.APP_EMAIL_ALLOWLIST)
    .filter((entry) => !String(entry).includes('@'))
    .map((entry) => normalizeDomain(entry));

  return new Set([
    ...domainEntries,
    ...compatibilityDomainEntries,
  ].filter(Boolean));
};

const getAppEmailBlocklistSet = () => new Set(parseEmailBlocklist(process.env.APP_EMAIL_BLOCKLIST));

const isEmailDomainAllowed = (email, domainAllowlist) => {
  const atIndex = email.lastIndexOf('@');
  if (atIndex < 0) return false;

  const emailDomain = normalizeDomain(email.slice(atIndex + 1));
  if (!emailDomain) return false;

  for (const allowedDomain of domainAllowlist) {
    if (emailDomain === allowedDomain || emailDomain.endsWith(`.${allowedDomain}`)) {
      return true;
    }
  }

  return false;
};

const isAppEmailRestrictionEnabled = () => (
  getAppEmailAllowlistSet().size > 0 || getAppEmailDomainAllowlistSet().size > 0
);

const isAppEmailAllowed = (email) => {
  const exactAllowlist = getAppEmailAllowlistSet();
  const domainAllowlist = getAppEmailDomainAllowlistSet();
  if (exactAllowlist.size === 0 && domainAllowlist.size === 0) {
    return true;
  }

  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }

  if (exactAllowlist.has(normalized)) {
    return true;
  }

  return isEmailDomainAllowed(normalized, domainAllowlist);
};

const isAppEmailBlocked = (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  return getAppEmailBlocklistSet().has(normalized);
};

module.exports = {
  normalizeEmail,
  normalizeDomain,
  parseEmailAllowlist,
  parseEmailBlocklist,
  parseEmailDomainAllowlist,
  getAppEmailAllowlistSet,
  getAppEmailDomainAllowlistSet,
  getAppEmailBlocklistSet,
  isAppEmailRestrictionEnabled,
  isAppEmailAllowed,
  isAppEmailBlocked,
};
