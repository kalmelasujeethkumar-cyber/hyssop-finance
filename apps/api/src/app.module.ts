import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { SessionGuard } from './auth/session.guard';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { RequestContextMiddleware } from './common/http/request-context.middleware';
import { LoggingModule } from './common/logging/logging.module';
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
    AuthModule,
    HealthModule,
    MembersModule,
    DashboardModule,
    TransactionsModule,
    IncomeModule,
    ExpensesModule,
    DocumentsModule,
    ReportsModule,
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
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
