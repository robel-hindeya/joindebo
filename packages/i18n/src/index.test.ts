import { describe, expect, it } from 'vitest';
import { findMissingKeys, messages, t } from './index';

describe('i18n', () => {
  it('has every key in every shipped language', () => {
    expect(findMissingKeys(messages)).toEqual([]);
  });

  it('reports a key missing in one language', () => {
    expect(findMissingKeys({ en: { a: 'A', b: 'B' }, am: { a: 'ሀ' }, om: { a: 'A', b: '' } })).toEqual(['am: b', 'om: b']);
  });

  it('admin keys ship in English only', () => {
    expect(findMissingKeys({ en: { 'admin.x': 'X', a: 'A' }, am: { a: 'ሀ' }, om: { a: 'A' } })).toEqual([]);
    expect(findMissingKeys({ en: { a: 'A' }, am: { 'admin.x': 'X', a: 'ሀ' }, om: { a: 'A' } })).toEqual(['en: admin.x']);
  });

  it('uses the _one form for a count of 1', () => {
    expect(t('en', 'owner.shBranchesSub', { a: 1 }, 1)).toBe('1 branch');
    expect(t('en', 'owner.shBranchesSub', { a: 2 }, 2)).toBe('2 branches');
    expect(t('en', 'owner.shBranchesSub', { a: 1 })).toBe('1 branches');
  });

  it('translates and fills placeholders', () => {
    expect(t('am', 'common.continue')).toBe('ቀጥል');
    expect(t('en', 'welcome.title')).toBe('Choose your language');
  });
});
