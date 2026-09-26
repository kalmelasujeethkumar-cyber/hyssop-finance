import { Injectable } from '@nestjs/common';
import type { Member, Prisma } from '@prisma/client';
import { notFound, staleRevision, validationFailed } from '../../common/errors/domain.errors';
import { normalizePhone } from '../../common/phone/normalize-phone';
import { AuditEventRepository, AUDIT_ENTITY_TYPES } from '../audit/audit-event.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceAllocatorService } from '../references/reference-allocator.service';

export interface CreateMemberInput {
  readonly name: string;
  readonly phone?: string | null;
  readonly notes?: string | null;
}

export interface UpdateMemberInput {
  readonly name: string;
  readonly phone?: string | null;
  readonly notes?: string | null;
  readonly expectedRevision: number;
}

export interface MemberSearchFilters {
  readonly search?: string;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Member persistence.
 *
 * Authority: `docs/05-DATABASE-SPEC.md` and `docs/01-REQUIREMENTS.md`
 * (`REQ-MEM-001` to `REQ-MEM-006`): `reference_id` is allocated by the transaction's
 * own allocator and is immutable, names are required and length-limited, phone is
 * optional and stored as national digits, and edits use a `revision` optimistic lock
 * that increments atomically. There is no delete operation.
 */
@Injectable()
export class MemberRepository {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferenceAllocatorService,
    private readonly audit: AuditEventRepository,
  ) {}

  /** Creates a member and its audit event in one transaction. */
  public async create(input: CreateMemberInput, actorAdminId: string): Promise<Member> {
    const name = normalizeName(input.name);
    const phone = normalizePhone(input.phone ?? null);
    const notes = normalizeOptionalText(input.notes);

    return this.prisma.$transaction(async (tx) => {
      const referenceId = await this.references.allocate(tx, 'MEMBER');
      const member = await tx.member.create({
        data: { referenceId, name, phone, notes },
      });

      await this.audit.record(tx, {
        action: 'MEMBER_CREATED',
        entityType: AUDIT_ENTITY_TYPES.member,
        entityId: member.id,
        entityReference: member.referenceId,
        actorAdminId,
        after: { referenceId: member.referenceId, name: member.name, phone: member.phone },
      });

      return member;
    });
  }

  public async findById(id: string): Promise<Member> {
    const member = await this.prisma.member.findUnique({ where: { id } });

    if (member === null) {
      throw notFound('Member', id);
    }

    return member;
  }

  public async findByReferenceId(referenceId: string): Promise<Member> {
    const member = await this.prisma.member.findUnique({ where: { referenceId } });

    if (member === null) {
      throw notFound('Member', referenceId);
    }

    return member;
  }

  public async search(filters: MemberSearchFilters): Promise<readonly Member[]> {
    const search = filters.search?.trim() ?? '';
    const where: Prisma.MemberWhereInput =
      search === ''
        ? {}
        : {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { referenceId: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          };

    return this.prisma.member.findMany({
      where,
      orderBy: [{ name: 'asc' }, { referenceId: 'asc' }],
      take: filters.limit,
      skip: filters.offset,
    });
  }

  /**
   * Applies an audited member edit.
   *
   * The `revision` guard turns a concurrent edit into a rejected update instead of a
   * silent overwrite, and the reference is never part of the update.
   */
  public async update(id: string, input: UpdateMemberInput, actorAdminId: string): Promise<Member> {
    const name = normalizeName(input.name);
    const phone = normalizePhone(input.phone ?? null);
    const notes = normalizeOptionalText(input.notes);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.member.findUnique({ where: { id } });

      if (current === null) {
        throw notFound('Member', id);
      }

      if (current.revision !== input.expectedRevision) {
        throw staleRevision('Member', input.expectedRevision, current.revision);
      }

      const updated = await tx.member.update({
        where: { id, revision: input.expectedRevision },
        data: { name, phone, notes, revision: { increment: 1 }, updatedAt: new Date() },
      });

      await this.audit.record(tx, {
        action: 'MEMBER_UPDATED',
        entityType: AUDIT_ENTITY_TYPES.member,
        entityId: updated.id,
        entityReference: updated.referenceId,
        actorAdminId,
        before: { name: current.name, phone: current.phone, notes: current.notes },
        after: { name: updated.name, phone: updated.phone, notes: updated.notes },
      });

      return updated;
    });
  }

  public async count(): Promise<number> {
    return this.prisma.member.count();
  }
}

function normalizeName(raw: string): string {
  const name = raw.trim();

  if (name === '') {
    throw validationFailed('A member name is required.', { field: 'name' });
  }

  if (name.length > 120) {
    throw validationFailed('A member name must be 120 characters or fewer.', { field: 'name' });
  }

  return name;
}

function normalizeOptionalText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const value = raw.trim();
  return value === '' ? null : value;
}
