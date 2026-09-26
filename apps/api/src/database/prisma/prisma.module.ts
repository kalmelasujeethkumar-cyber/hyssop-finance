import { Global, Module } from '@nestjs/common';
import { LoggingModule } from '../../common/logging/logging.module';
import { PrismaService } from './prisma.service';

/**
 * Global database access module.
 *
 * The generated client and its lifecycle are infrastructure, so every feature module
 * receives the same instance. Data access still goes through the repository classes
 * in `DatabaseModule`; no controller may import `PrismaClient` directly.
 */
@Global()
@Module({
  imports: [LoggingModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
