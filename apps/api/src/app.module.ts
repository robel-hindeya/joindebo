import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';

/**
 * One deployable service with internal modules (auth, stamps, business and
 * money, messages, audit) added phase by phase. See ARCHITECTURE.md.
 */
@Module({
  imports: [DbModule],
  controllers: [HealthController],
})
export class AppModule {}
