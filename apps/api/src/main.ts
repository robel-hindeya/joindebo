import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { json } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestIdMiddleware } from './common/request-id.middleware';

/**
 * Refuse to start with settings that are only safe outside production.
 * APP_ENV is local, staging or production; production images must set it.
 */
export function assertSafeConfig(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === 'production' && !env.APP_ENV) {
    throw new Error('APP_ENV must be set (local, staging or production)');
  }
  if (env.APP_ENV === 'production' && env.DEV_SMS === 'true') {
    throw new Error('DEV_SMS=true would expose SMS codes; it is not allowed when APP_ENV=production');
  }
  // Owners sign in with SMS codes: production must deliver them.
  if (env.APP_ENV === 'production' && env.SMS_PROVIDER !== 'smsethiopia') {
    throw new Error('APP_ENV=production needs SMS_PROVIDER=smsethiopia');
  }
  if (env.SMS_PROVIDER === 'smsethiopia' && !env.SMSETHIOPIA_KEY) {
    throw new Error('SMS_PROVIDER=smsethiopia needs SMSETHIOPIA_KEY');
  }
  if (env.NODE_ENV === 'production' && Buffer.from(env.ADMIN_TOTP_KEY ?? '', 'base64').length !== 32) {
    throw new Error('ADMIN_TOTP_KEY must be 32 random bytes, base64 (it encrypts admin authenticator secrets)');
  }
}

/** Shared by the server and the tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.use(new RequestIdMiddleware().use);
  // A payment screenshot (at most 3 MB, sent as base64) needs a bigger body than the default 100 kB.
  // Wrapped: Nest skips its own JSON parser when it finds one named jsonParser already installed.
  const bigJson = json({ limit: '6mb' });
  app.use('/api/v1/owner/payments', (req: Parameters<typeof bigJson>[0], res: Parameters<typeof bigJson>[1], next: Parameters<typeof bigJson>[2]) => bigJson(req, res, next));
  // Behind Caddy: trust one proxy hop so req.ip is the caller, for rate limits and the audit log.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();
}

async function bootstrap() {
  assertSafeConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(JSON.stringify({ level: 'info', msg: 'api listening', port }));
}

if (require.main === module) bootstrap();
