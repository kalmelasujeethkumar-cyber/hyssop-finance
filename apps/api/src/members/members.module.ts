import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ContributionPeriodsController, MembersController } from './members.controller';
import { MembersService } from './members.service';

/**
 * The member and contribution-period module.
 *
 * Authority: `docs/02-ARCHITECTURE.md` (controllers are thin and delegate to a service,
 * which delegates to repositories) and `docs/phases/PHASE-04-MEMBERS.md`.
 *
 * `DatabaseModule` is imported rather than assumed: the repositories are the only place
 * that touches Prisma, and this module must not reach around them.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [MembersController, ContributionPeriodsController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
