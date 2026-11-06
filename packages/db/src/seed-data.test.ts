import { describe, expect, it } from 'vitest';
import { AGENTS, BUSINESSES, DEFAULT_SETTINGS, planCode, shopCode } from './seed-data';

describe('seed data', () => {
  it('gives every business a unique shop code', () => {
    const codes = BUSINESSES.map(shopCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(shopCode(BUSINESSES[0])).toBe('MOKA01');
  });

  it('links businesses only to known agents', () => {
    const refs = new Set(AGENTS.map((a) => a[0]));
    for (const b of BUSINESSES) if (b.agent) expect(refs.has(b.agent)).toBe(true);
  });

  it('stores phones in E.164', () => {
    for (const b of BUSINESSES) expect(b.phone).toMatch(/^\+2519\d{8}$/);
    for (const a of AGENTS) expect(a[2]).toMatch(/^\+2519\d{8}$/);
  });

  it('maps prototype plan names', () => {
    expect(planCode('Standard')).toBe('starter');
    expect(planCode('Multi-branch')).toBe('full');
    expect(planCode('Pilot')).toBe('pilot');
  });

  it('carries the plan defaults from the build plan', () => {
    expect(DEFAULT_SETTINGS['plan.starter.monthly_fee_birr']).toBe(1600);
    expect(DEFAULT_SETTINGS['government.share_percent_of_commission']).toBe(30);
  });
});
