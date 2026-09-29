import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { SessionGuard } from './auth/session.guard';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { RequestContextMiddleware } from './common/http/request-context.middleware';
import { LoggingModule } from './common/logging/logging.module';
import { loadAppEnvironment } from './config/environment.loader';
import { DatabaseModule } from './database/database.module';
import { PrismaModule } from './database/prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { IncomeModule } from './income/income.module';
import { MembersModule } from './members/members.module';
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
    TransactionsModule,
    IncomeModule,
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
