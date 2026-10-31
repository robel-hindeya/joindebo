import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import type { Sql } from '@temelash/db';
import { SQL } from '../db/db.module';

/**
 * Development only: the last SMS messages, so codes can be read while no SMS
 * provider is connected. Answers 404 unless DEV_SMS=true; never set it in production.
 */
@Controller('dev/sms')
export class DevSmsController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get()
  async list() {
    // Images always run with NODE_ENV=production (staging too), so DEV_SMS alone decides.
    if (process.env.DEV_SMS !== 'true') throw new NotFoundException();
    return this.sql`select phone, body, created_at as "createdAt" from tc.sms_outbox order by created_at desc limit 20`;
  }
}
