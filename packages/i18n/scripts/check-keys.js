#!/usr/bin/env node
// Fails the build when a translation key is missing or empty in any shipped language.
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'src', 'locales');
const locales = {};
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  locales[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

for (const lang of ['en', 'am', 'om']) {
  if (!locales[lang]) {
    console.error(`i18n: missing locale file ${lang}.json`);
    process.exit(1);
  }
}

const all = new Set(Object.values(locales).flatMap((d) => Object.keys(d)));
// The admin back-office ships in English only (DECISIONS.md).
const englishOnly = (k) => k.startsWith('admin.');
const problems = [];
for (const [lang, dict] of Object.entries(locales)) {
  for (const key of all) {
    if (lang !== 'en' && englishOnly(key)) continue;
    if (typeof dict[key] !== 'string' || dict[key].trim() === '') problems.push(`${lang}: ${key}`);
  }
}

// Phase 9 acceptance: no untranslated strings. A shipped string that is just the English text is
// one, unless it reads the same in every language (names, brands, sample data the screens never show).
const SAME_EVERYWHERE = new Set(['common.appName', 'staff.siPin', 'owner.pinLbl', 'owner.ttl_staffpin', 'owner.asSms', 'owner.soTele', 'owner.payCbe', 'sms.message', 'staff.shop', 'staff.staffName']);
for (const lang of ['am', 'om']) {
  for (const key of all) {
    const en = locales.en[key];
    if (englishOnly(key) || SAME_EVERYWHERE.has(key) || typeof en !== 'string') continue;
    if (locales[lang][key] === en && /[A-Za-z]{3,}/.test(en.replace(/\{[a-z]\}/g, ''))) problems.push(`${lang}: ${key} is still in English`);
  }
}

if (problems.length) {
  console.error(`i18n: ${problems.length} missing translation(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n: ${all.size} keys present in ${Object.keys(locales).join(', ')}`);
