import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { Sql } from '@temelash/db';
import { SQL } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get()
  async check() {
    try {
      const [row] = await this.sql<{ migrations: number }[]>`select count(*)::int as migrations from tc.schema_migrations`;
      return { ok: true, db: 'up', migrations: row.migrations, time: new Date().toISOString() };
    } catch {
      throw new HttpException({ ok: false, db: 'down' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
