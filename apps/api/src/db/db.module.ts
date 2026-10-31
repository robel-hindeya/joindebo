import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Sql } from '@temelash/db';

export const SQL = Symbol('SQL');

@Global()
@Module({
  providers: [{ provide: SQL, useFactory: () => createDb() }],
  exports: [SQL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async onApplicationShutdown() {
    await this.sql.end({ timeout: 5 });
  }
}
