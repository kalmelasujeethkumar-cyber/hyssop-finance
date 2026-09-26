import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { StructuredLogger } from './common/logging/structured-logger';
import { EnvironmentValidationError, getAppEnvironment } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const environment = getAppEnvironment(app.get(ConfigService));

  configureApp(app, environment);
  await app.listen(environment.port);

  app.get(StructuredLogger).logRequest('info', 'api started', {
    environment: environment.nodeEnv,
    port: environment.port,
    allowedOrigins: environment.corsAllowedOrigins.length,
  });
}

void bootstrap().catch((error: unknown) => {
  const entry =
    error instanceof EnvironmentValidationError
      ? { level: 'error', message: error.message }
      : {
          level: 'error',
          message: 'The API failed to start.',
          reason: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? (error.stack ?? null) : null,
        };

  process.stderr.write(`${JSON.stringify(entry)}\n`);
  process.exitCode = 1;
});
