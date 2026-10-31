import { Module } from '@nestjs/common';
import { BusinessAuthController } from './auth/business-auth.controller';
import { CustomerAuthController } from './auth/customer-auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { OtpService } from './auth/otp.service';
import { PeopleService } from './auth/people.service';
import { RateLimitGuard } from './auth/rate-limit.guard';
import { SessionController } from './auth/session.controller';
import { StaffAuthController } from './auth/staff-auth.controller';
import { TokensService } from './auth/tokens.service';
import { BusinessController } from './business/business.controller';
import { ShopsController } from './business/shops.controller';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { SettingsService } from './settings/settings.service';
import { DevSmsController } from './sms/dev-sms.controller';
import { OutboxSmsSender, SmsSender } from './sms/sms';
import { CustomerCardsController, OwnerFixController, StaffStampsController } from './stamps/stamps.controller';
import { StampsService } from './stamps/stamps.service';
import { OwnerController } from './owner/owner.controller';
import { OwnerSettingsController } from './owner/owner-settings.controller';
import { AdminAuthController } from './admin/admin-auth.controller';
import { AdminAuthService } from './admin/admin-auth.service';
import { AdminController } from './admin/admin.controller';
import { SafetyService } from './settings/safety.service';

/**
 * One deployable service with internal modules (auth, stamps, business and
 * money, messages, audit) added phase by phase. See ARCHITECTURE.md.
 */
@Module({
  imports: [DbModule],
  controllers: [
    HealthController,
    CustomerAuthController,
    BusinessAuthController,
    StaffAuthController,
    SessionController,
    BusinessController,
    ShopsController,
    DevSmsController,
    StaffStampsController,
    CustomerCardsController,
    OwnerFixController,
    OwnerController,
    OwnerSettingsController,
    AdminAuthController,
    AdminController,
  ],
  providers: [
    SettingsService,
    TokensService,
    OtpService,
    PeopleService,
    AuthGuard,
    RateLimitGuard,
    StampsService,
    SafetyService,
    AdminAuthService,
    { provide: SmsSender, useClass: OutboxSmsSender },
  ],
})
export class AppModule {}
