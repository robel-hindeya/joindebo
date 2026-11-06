/** Monthly billing (DECISIONS.md, 2026-11-06): what has come due, and the commission on it. */
import { accrue, addDays, addMonths, billingOf, earnedBy, termsFrom, type Prices } from '../src/money/money.service';

const prices: Prices = { starter: 1600, full: 2100, included: 2, extra: 420, cStarter: 16, cFull: 20, cExtra: 20, gov: 30 };
const starter = (start: string | null) => termsFrom(prices, 'starter', 1, start);

describe('monthly fee', () => {
  it('prices a plan by the month', () => {
    expect(starter(null)).toMatchObject({ monthly: 1600, fee: 1600, commissionBase: 256 });
    expect(termsFrom(prices, 'full', 2, null)).toMatchObject({ monthly: 2100, commissionBase: 420, commissionExtra: 84 });
    expect(termsFrom(prices, 'full', 4, null)).toMatchObject({ monthly: 2940 });
    expect(termsFrom(prices, 'pilot', 1, null)).toMatchObject({ monthly: 0, fee: 0 });
  });

  it('adds months, keeping to the end of a shorter month', () => {
    expect(addMonths('2026-11-06', 1)).toBe('2026-12-06');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-30', 7)).toBe('2027-01-06');
  });

  it('owes the first month from the day the trial ends, then one more each month', () => {
    const t = starter('2026-11-20');
    expect(accrue(t, 0, '2026-11-06')).toMatchObject({ fee: 1600, dueOn: '2026-11-20' }); // still on trial
    expect(accrue(t, 0, '2026-11-20')).toMatchObject({ fee: 1600, dueOn: '2026-11-20' });
    expect(accrue(t, 0, '2026-12-19')).toMatchObject({ fee: 1600, dueOn: '2026-11-20' });
    expect(accrue(t, 0, '2026-12-20')).toMatchObject({ fee: 3200, dueOn: '2026-11-20' });
    expect(accrue(t, 0, '2027-02-21')).toMatchObject({ fee: 6400 });
  });

  it('moves the next due day on with each month paid', () => {
    const t = starter('2026-11-20');
    expect(accrue(t, 1600, '2026-12-05')).toMatchObject({ fee: 1600, dueOn: '2026-12-20' });
    expect(accrue(t, 1600, '2026-12-25')).toMatchObject({ fee: 3200, dueOn: '2026-12-20' });
    expect(accrue(t, 1000, '2026-12-05')).toMatchObject({ dueOn: '2026-11-20' }); // part of a month covers nothing
    expect(accrue(t, 4800, '2026-12-05')).toMatchObject({ fee: 1600, dueOn: '2027-02-20' }); // paid ahead
  });

  it('gives each state from what was paid', () => {
    const t = starter('2026-11-20');
    const at = (paid: number, today: string, status = 'active') => billingOf(status, accrue(t, paid, today), paid, today);
    expect(at(0, '2026-11-10', 'trial')).toBe('btrial');
    expect(at(0, '2026-11-20')).toBe('due');
    expect(at(0, '2026-11-21')).toBe('overdue');
    expect(at(1600, '2026-12-10')).toBe('paid');
    expect(at(1600, '2026-12-21')).toBe('overdue'); // the second month ran out
    expect(at(1000, '2026-11-20')).toBe('partial');
  });

  it('leaves a pilot and a shop with no due day alone', () => {
    expect(accrue(termsFrom(prices, 'pilot', 1, null), 0, '2026-12-01')).toMatchObject({ fee: 0 });
    expect(accrue(starter(null), 0, '2030-01-01')).toMatchObject({ fee: 1600, dueOn: null });
  });
});

describe('commission', () => {
  it('is a share of each payment, and goes down when money is taken back', () => {
    const t = starter('2026-11-20');
    expect(earnedBy(1600, t)).toBe(256);
    expect(earnedBy(3200, t)).toBe(512);
    expect(earnedBy(800, t)).toBe(128);
    expect(earnedBy(0, t)).toBe(0);
    expect(earnedBy(-100, t)).toBe(0);
  });

  it('counts extra branches, and nothing on a pilot', () => {
    expect(earnedBy(2100, termsFrom(prices, 'full', 2, null))).toBe(420);
    expect(earnedBy(2940, termsFrom(prices, 'full', 4, null))).toBe(588);
    expect(earnedBy(5000, termsFrom(prices, 'pilot', 1, null))).toBe(0);
  });
});
