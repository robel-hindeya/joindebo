import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller';

const fakeSql = (impl: () => Promise<unknown>) => impl as unknown as ConstructorParameters<typeof HealthController>[0];

describe('HealthController', () => {
  it('reports the database up with its migration count', async () => {
    const c = new HealthController(fakeSql(async () => [{ migrations: 2 }]));
    await expect(c.check()).resolves.toMatchObject({ ok: true, db: 'up', migrations: 2 });
  });

  it('returns 503 when the database is unreachable', async () => {
    const c = new HealthController(fakeSql(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(c.check()).rejects.toBeInstanceOf(HttpException);
  });
});
