import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditEventsModule } from './audit/audit-events.module';
import { AuthModule } from './auth/auth.module';
import { SessionGuard } from './auth/session.guard';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { RequestContextMiddleware } from './common/http/request-context.middleware';
import { LoggingModule } from './common/logging/logging.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { loadAppEnvironment } from './config/environment.loader';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { PrismaModule } from './database/prisma/prisma.module';
import { DocumentsModule } from './documents/documents.module';
import { ExpensesModule } from './expenses/expenses.module';
import { HealthModule } from './health/health.module';
import { IncomeModule } from './income/income.module';
import { MembersModule } from './members/members.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { TransactionsModule } from './transactions/transactions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../../.env', '.env'],
      load: [loadAppEnvironment],
    }),
    LoggingModule,
    PrismaModule,
    DatabaseModule,
    RateLimitModule,
    AuthModule,
    HealthModule,
    MembersModule,
    DashboardModule,
    TransactionsModule,
    IncomeModule,
    ExpensesModule,
    DocumentsModule,
    ReportsModule,
    AuditEventsModule,
    SettingsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
    {
      // Registered globally: authentication is opt-out through `@Public()`, so a route
      // added in a later phase cannot be reachable without a session by accident.
      provide: APP_GUARD,
      useClass: SessionGuard,
    },
    {
      // Registered after `SessionGuard` so an unauthenticated request is answered `401`, not
      // `429`. Mutations are limited by default and reads are not, so a new mutating route is
      // covered unless it is deliberately annotated.
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
