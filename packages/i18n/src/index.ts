import en from './locales/en.json';
import am from './locales/am.json';
import om from './locales/om.json';

/** Languages that ship. The rest of LANGUAGES show as "Coming soon". */
export const SHIPPED_LANGS = ['en', 'am', 'om'] as const;
export type Lang = (typeof SHIPPED_LANGS)[number];

/** The language picker, in the prototype's order (Welcome board). */
export const LANGUAGES: ReadonlyArray<{ code: string; label: string; comingSoon: boolean }> = [
  { code: 'en', label: 'English', comingSoon: false },
  { code: 'am', label: 'አማርኛ', comingSoon: false },
  { code: 'om', label: 'Afaan Oromoo', comingSoon: false },
  { code: 'ti', label: 'ትግርኛ', comingSoon: true },
  { code: 'so', label: 'Soomaali', comingSoon: true },
  { code: 'sid', label: 'Sidaamu Afoo', comingSoon: true },
  { code: 'wal', label: 'Wolayttatto', comingSoon: true },
  { code: 'aa', label: 'Qafar af', comingSoon: true },
  { code: 'gur', label: 'ጉራጌኛ', comingSoon: true },
];

export type MessageKey = keyof typeof en;

export const messages: Record<Lang, Record<MessageKey, string>> = { en, am, om };

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (SHIPPED_LANGS as readonly string[]).includes(value);
}

/** Translate a key; `{name}` placeholders are filled from `vars`. */
export function t(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = messages[lang][key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Keys present in one locale but missing (or empty) in another. Used by the build check. */
export function findMissingKeys(locales: Record<string, Record<string, unknown>>): string[] {
  const all = new Set<string>();
  for (const dict of Object.values(locales)) Object.keys(dict).forEach((k) => all.add(k));
  const problems: string[] = [];
  for (const [lang, dict] of Object.entries(locales)) {
    for (const key of all) {
      const v = dict[key];
      if (typeof v !== 'string' || v.trim() === '') problems.push(`${lang}: ${key}`);
    }
  }
  return problems;
}
