import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { ApiError } from '../common/api-error';

export interface KillSwitch {
  on: boolean;
  message: string;
}

/** How long one API instance may serve a stale kill-switch value (the plan allows 5 seconds). */
const CACHE_MS = 2000;

/**
 * The kill switch (setting `safety.kill_switch`, AdminKillSwitch): while on,
 * every stamp and every redemption is refused with the owner message.
 */
@Injectable()
export class SafetyService {
  private cached: { at: number; value: KillSwitch } | null = null;

  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async killSwitch(): Promise<KillSwitch> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const [row] = await this.sql<{ value: { on?: boolean; owner_message?: string } | null }[]>`select value from tc.setting where key = 'safety.kill_switch'`;
    const value = { on: row?.value?.on === true, message: row?.value?.owner_message ?? '' };
    this.cached = { at: Date.now(), value };
    return value;
  }

  /** Called after this instance changes the switch, so it takes effect here at once. */
  forget(): void {
    this.cached = null;
  }

  async refuseIfPaused(): Promise<void> {
    const k = await this.killSwitch();
    if (k.on) throw new ApiError(503, 'paused_by_temelash', { message: k.message });
  }
}
