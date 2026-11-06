/** New rounds (DECISIONS.md, 2026-11-06): a full card starts again; nothing earned is lost. */
import { roundOf } from '../src/stamps/cards';

describe('roundOf', () => {
  it('starts on round 1 with no stamps', () => {
    expect(roundOf(0, 10)).toEqual({ round: 1, count: 0 });
    expect(roundOf(-1, 10)).toEqual({ round: 1, count: 0 });
  });

  it('stays on a round until the card is full', () => {
    expect(roundOf(1, 10)).toEqual({ round: 1, count: 1 });
    expect(roundOf(9, 10)).toEqual({ round: 1, count: 9 });
    expect(roundOf(10, 10)).toEqual({ round: 1, count: 10 }); // full shows as 10 of 10
  });

  it('starts a new round with the next stamp', () => {
    expect(roundOf(11, 10)).toEqual({ round: 2, count: 1 });
    expect(roundOf(20, 10)).toEqual({ round: 2, count: 10 });
    expect(roundOf(21, 10)).toEqual({ round: 3, count: 1 });
  });

  it('works with any card size', () => {
    expect(roundOf(8, 8)).toEqual({ round: 1, count: 8 });
    expect(roundOf(9, 8)).toEqual({ round: 2, count: 1 });
    expect(roundOf(3, 1)).toEqual({ round: 3, count: 1 });
  });

  it('goes back a round when a fix removes a stamp', () => {
    expect(roundOf(11 - 1, 10)).toEqual({ round: 1, count: 10 });
  });
});
