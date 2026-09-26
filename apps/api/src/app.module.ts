import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { RequestContextMiddleware } from './common/http/request-context.middleware';
import { LoggingModule } from './common/logging/logging.module';
import { loadAppEnvironment } from './config/environment.loader';
import { DatabaseModule } from './database/database.module';
import { PrismaModule } from './database/prisma/prisma.module';
import { HealthModule } from './health/health.module';

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
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
