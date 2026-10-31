import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from '@temelash/db';
import { SQL } from '../db/db.module';

/** Reads tc.setting. Prices, limits and lock rules are settings, never constants. */
@Injectable()
export class SettingsService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async number(key: string, fallback: number): Promise<number> {
    const [row] = await this.sql<{ value: unknown }[]>`select value from tc.setting where key = ${key}`;
    const n = Number(row?.value);
    return Number.isFinite(n) ? n : fallback;
  }
}
