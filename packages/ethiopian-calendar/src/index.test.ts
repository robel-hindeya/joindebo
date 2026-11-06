import { describe, expect, it } from 'vitest';
import {
  daysInEthiopianMonth,
  ethiopianDateOf,
  ethiopianLocalHour,
  ethiopianToGregorian,
  financeYearOf,
  financeYearRange,
  formatEthiopianDate,
  formatOromoDate,
  formatTimeWithLocal,
  gregorianToEthiopian,
  nextYearPaymentsOpen,
} from './index';

describe('Phase 0 acceptance', () => {
  it('converts 2026-10-31 to Tikimt 21, 2019 and back', () => {
    const e = gregorianToEthiopian({ year: 2026, month: 10, day: 31 });
    expect(e).toEqual({ year: 2019, month: 2, day: 21 });
    expect(formatEthiopianDate(e)).toBe('Tikimt 21, 2019');
    expect(ethiopianToGregorian(e)).toEqual({ year: 2026, month: 10, day: 31 });
  });

  it('converts 2026-07-08 to Hamle 1, 2018 and back', () => {
    const e = gregorianToEthiopian({ year: 2026, month: 7, day: 8 });
    expect(e).toEqual({ year: 2018, month: 11, day: 1 });
    expect(formatEthiopianDate(e)).toBe('Hamle 1, 2018');
    expect(ethiopianToGregorian(e)).toEqual({ year: 2026, month: 7, day: 8 });
  });
});

describe('calendar', () => {
  it('knows Ethiopian new year', () => {
    expect(gregorianToEthiopian({ year: 2026, month: 9, day: 11 })).toEqual({ year: 2019, month: 1, day: 1 });
    // 2019 is a leap year (Pagume 6), so 2020 starts on 12 Sep 2027.
    expect(gregorianToEthiopian({ year: 2027, month: 9, day: 12 })).toEqual({ year: 2020, month: 1, day: 1 });
    expect(gregorianToEthiopian({ year: 2027, month: 9, day: 11 })).toEqual({ year: 2019, month: 13, day: 6 });
  });

  it('gives Pagume 5 or 6 days', () => {
    expect(daysInEthiopianMonth(2018, 13)).toBe(5);
    expect(daysInEthiopianMonth(2019, 13)).toBe(6);
    expect(daysInEthiopianMonth(2019, 4)).toBe(30);
    expect(() => ethiopianToGregorian({ year: 2018, month: 13, day: 6 })).toThrow(RangeError);
  });

  it('round-trips every day for 30 years', () => {
    const start = Date.UTC(2010, 0, 1);
    for (let i = 0; i < 365 * 30; i++) {
      const d = new Date(start + i * 86_400_000);
      const g = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
      expect(ethiopianToGregorian(gregorianToEthiopian(g))).toEqual(g);
    }
  });

  it('uses East Africa Time for the date of an instant', () => {
    // 22:30 UTC on 30 Oct is 01:30 on 31 Oct in Addis.
    expect(ethiopianDateOf(new Date('2026-10-30T22:30:00Z'))).toEqual({ year: 2019, month: 2, day: 21 });
  });

  it('names months in all three languages', () => {
    const e = { year: 2019, month: 2, day: 21 };
    expect(formatEthiopianDate(e, 'am')).toBe('ጥቅምት 21, 2019');
    expect(formatEthiopianDate(e, 'om')).toBe('Onkoloolessa 21, 2019');
  });
});

describe('Ethiopian local time', () => {
  it('counts hours from 06:00', () => {
    expect(ethiopianLocalHour(7)).toBe(1);
    expect(ethiopianLocalHour(6)).toBe(12);
    expect(ethiopianLocalHour(18)).toBe(12);
    expect(ethiopianLocalHour(0)).toBe(6);
    expect(formatTimeWithLocal(14, 5)).toBe('14:05 (8:05 LT)');
  });
});

describe('finance year', () => {
  it('runs Hamle 1 to Sene 30', () => {
    expect(financeYearOf({ year: 2018, month: 11, day: 1 })).toBe(2019);
    expect(financeYearOf({ year: 2019, month: 10, day: 30 })).toBe(2019);
    expect(financeYearOf({ year: 2019, month: 11, day: 1 })).toBe(2020);
    const r = financeYearRange(2019);
    expect(ethiopianToGregorian(r.start)).toEqual({ year: 2026, month: 7, day: 8 });
    expect(ethiopianToGregorian(r.end)).toEqual({ year: 2027, month: 7, day: 7 });
  });

  it('opens next-year payments on Ginbot 1', () => {
    expect(nextYearPaymentsOpen({ year: 2019, month: 8, day: 30 })).toBe(false);
    expect(nextYearPaymentsOpen({ year: 2019, month: 9, day: 1 })).toBe(true);
    expect(nextYearPaymentsOpen({ year: 2019, month: 11, day: 1 })).toBe(false);
  });
});

describe('Oromo Gregorian dates', () => {
  it('gives the East Africa date, not the UTC one', () => {
    // 22:30 UTC on Thursday 5 November is already Friday 6 November in Addis Ababa.
    const late = new Date('2026-11-05T22:30:00Z');
    expect(formatOromoDate(late)).toBe('6 Sadaasa');
    expect(formatOromoDate(late, true)).toBe('Jimaata, 6 Sadaasa');
  });
});
