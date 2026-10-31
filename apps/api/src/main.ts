import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestIdMiddleware } from './common/request-id.middleware';

/** Shared by the server and the tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.use(new RequestIdMiddleware().use);
  // Behind Caddy: trust one proxy hop so req.ip is the caller, for rate limits and the audit log.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(JSON.stringify({ level: 'info', msg: 'api listening', port }));
}

if (require.main === module) bootstrap();
