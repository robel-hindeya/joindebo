import { describe, expect, it } from 'vitest';
import { findMissingKeys, messages, t } from './index';

describe('i18n', () => {
  it('has every key in every shipped language', () => {
    expect(findMissingKeys(messages)).toEqual([]);
  });

  it('reports a key missing in one language', () => {
    expect(findMissingKeys({ en: { a: 'A', b: 'B' }, am: { a: 'ሀ' }, om: { a: 'A', b: '' } })).toEqual(['am: b', 'om: b']);
  });

  it('translates and fills placeholders', () => {
    expect(t('am', 'common.continue')).toBe('ቀጥል');
    expect(t('en', 'welcome.title')).toBe('Choose your language');
  });
});
