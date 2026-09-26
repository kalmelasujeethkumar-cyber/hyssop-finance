import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { RequestContextMiddleware } from './common/http/request-context.middleware';
import { StructuredLogger } from './common/logging/structured-logger';
import { getAppEnvironment, resolveLogLevel } from './config/environment';
import { loadAppEnvironment } from './config/environment.loader';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../../.env', '.env'],
      load: [loadAppEnvironment],
    }),
    HealthModule,
  ],
  providers: [
    {
      provide: StructuredLogger,
      useFactory: (config: ConfigService) =>
        new StructuredLogger(resolveLogLevel(getAppEnvironment(config).nodeEnv)),
      inject: [ConfigService],
    },
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
