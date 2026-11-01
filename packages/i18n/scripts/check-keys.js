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

if (problems.length) {
  console.error(`i18n: ${problems.length} missing translation(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n: ${all.size} keys present in ${Object.keys(locales).join(', ')}`);
