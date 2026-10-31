/**
 * Gregorian <-> Ethiopian calendar, East Africa Time, Ethiopian local-time
 * clock and the Temelash finance year (Hamle 1 to Sene 30).
 *
 * All conversions go through the Julian Day Number so they are exact for any
 * date; nothing here depends on the host time zone.
 */

export type Lang = 'en' | 'am' | 'om';

export interface EthiopianDate {
  year: number;
  /** 1..13; 13 is Pagume (5 days, 6 in the year before a Gregorian leap year). */
  month: number;
  day: number;
}

export interface GregorianDate {
  year: number;
  month: number;
  day: number;
}

/** Offset so that ethiopianToJdn matches the Julian Day Number of Meskerem 1. */
const ETHIOPIC_EPOCH = 1723856;

/** East Africa Time is UTC+3 all year (no daylight saving). */
export const EAT_OFFSET_MINUTES = 180;

export const MONTH_NAMES: Record<Lang, readonly string[]> = {
  en: ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'],
  am: ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'],
  // Draft: needs native-speaker review before launch (plan, ground rule 4).
  om: ['Fulbaana', 'Onkoloolessa', 'Sadaasa', 'Muddee', 'Amajjii', 'Guraandhala', 'Bitootessa', 'Ebla', 'Caamsaa', 'Waxabajjii', 'Adooleessa', 'Hagayya', 'Qaammee'],
};

export function gregorianToJdn({ year, month, day }: GregorianDate): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

export function jdnToGregorian(jdn: number): GregorianDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

export function ethiopianToJdn({ year, month, day }: EthiopianDate): number {
  return ETHIOPIC_EPOCH + 365 * year + Math.floor(year / 4) + 30 * month + day - 31;
}

export function jdnToEthiopian(jdn: number): EthiopianDate {
  const r = (((jdn - ETHIOPIC_EPOCH) % 1461) + 1461) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor((jdn - ETHIOPIC_EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

export function isEthiopianLeapYear(year: number): boolean {
  return (year + 1) % 4 === 0;
}

export function daysInEthiopianMonth(year: number, month: number): number {
  if (month < 1 || month > 13) throw new RangeError(`month must be 1..13, got ${month}`);
  if (month < 13) return 30;
  return isEthiopianLeapYear(year) ? 6 : 5;
}

export function isValidEthiopianDate(d: EthiopianDate): boolean {
  return Number.isInteger(d.year) && d.month >= 1 && d.month <= 13 && d.day >= 1 && d.day <= daysInEthiopianMonth(d.year, d.month);
}

export function gregorianToEthiopian(g: GregorianDate): EthiopianDate {
  return jdnToEthiopian(gregorianToJdn(g));
}

export function ethiopianToGregorian(e: EthiopianDate): GregorianDate {
  if (!isValidEthiopianDate(e)) throw new RangeError(`invalid Ethiopian date ${e.year}-${e.month}-${e.day}`);
  return jdnToGregorian(ethiopianToJdn(e));
}

/** Wall-clock parts of an instant in East Africa Time. */
export function toEat(instant: Date): GregorianDate & { hour: number; minute: number } {
  const shifted = new Date(instant.getTime() + EAT_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** The Ethiopian calendar date of an instant, as seen in Addis Ababa. */
export function ethiopianDateOf(instant: Date): EthiopianDate {
  return gregorianToEthiopian(toEat(instant));
}

/**
 * Ethiopian local-time hour: the day's 12 hours start at 06:00, so 07:00 is
 * 1 o'clock and 14:05 is 8:05. Returns 1..12.
 */
export function ethiopianLocalHour(hour24: number): number {
  const h = (((hour24 - 6) % 12) + 12) % 12;
  return h === 0 ? 12 : h;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "14:05 (8:05 LT)", the format the prototype uses when the LT clock is on. */
export function formatTimeWithLocal(hour24: number, minute: number): string {
  return `${pad2(hour24)}:${pad2(minute)} (${ethiopianLocalHour(hour24)}:${pad2(minute)} LT)`;
}

export function formatEthiopianDate(d: EthiopianDate, lang: Lang = 'en'): string {
  return `${MONTH_NAMES[lang][d.month - 1]} ${d.day}, ${d.year}`;
}

/**
 * Finance year N runs from Hamle 1 of year N-1 to Sene 30 of year N.
 * Example: finance year 2019 is 8 Jul 2026 to 7 Jul 2027.
 */
export function financeYearOf(d: EthiopianDate): number {
  return d.month >= 11 ? d.year + 1 : d.year;
}

export function financeYearRange(financeYear: number): { start: EthiopianDate; end: EthiopianDate } {
  return {
    start: { year: financeYear - 1, month: 11, day: 1 },
    end: { year: financeYear, month: 10, day: 30 },
  };
}

/** Payments for the next finance year open on Ginbot 1 of the current one. */
export function nextYearPaymentsOpen(d: EthiopianDate): boolean {
  return d.month >= 9 && d.month <= 10;
}
