import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request, { agent, type Response } from 'supertest';
import {
  CSRF_TOKEN_HEADER,
  DOCUMENT_UPLOAD_FIELD,
  IDEMPOTENCY_KEY_HEADER,
  isApiErrorBody,
  type DocumentSummary,
} from '@hyssop/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { StructuredLogger } from '../src/common/logging/structured-logger';
import { AppSettingRepository } from '../src/database/settings/app-setting.repository';
import { AuditEventRepository } from '../src/database/audit/audit-event.repository';
import { ExpenseCategoryRepository } from '../src/database/categories/expense-category.repository';
import { TransactionDocumentRepository } from '../src/database/documents/transaction-document.repository';
import { MemberRepository } from '../src/database/members/member.repository';
import { ContributionPeriodRepository } from '../src/database/contributions/contribution-period.repository';
import { TransactionRepository } from '../src/database/transactions/transaction.repository';
import { IdempotencyRecordRepository } from '../src/database/idempotency/idempotency-record.repository';
import { SessionService } from '../src/auth/session.service';
import { DOCUMENT_STORAGE } from '../src/storage/document-storage';
import { parseBusinessDate } from '../src/common/time/business-date';
import {
  FakeAudit,
  FakeCategories,
  FakeIdempotency,
  FakeLedger,
  FakeMembers,
  FakePeriods,
  FakeSettings,
  FakeTransactions,
  categoryFixture,
  fakeSession,
  httpServer,
  transactionFixture,
} from './support/fake-ledger';
import { FakeDocumentStorage, FakeDocuments } from './support/fake-documents';
import {
  applyTestProcessEnvironment,
  TEST_ENVIRONMENT,
  TEST_ORIGIN,
  TEST_SESSION_COOKIE,
} from './support/test-application';

/**
 * The document HTTP contract.
 *
 * Authority: `docs/06-API-SPEC.md` "Documents", `docs/01-REQUIREMENTS.md` `REQ-DOC-001` to
 * `REQ-DOC-009`, and `docs/07-SECURITY-RULES.md`.
 *
 * The real controller, DTO validation, `SessionGuard`, idempotency runner, multipart parser, error
 * filter, and document service all run. Only persistence is replaced: the storage double holds real
 * bytes so the served `Content-Type` can be compared against what was actually uploaded, and the
 * repository double keeps real rows so retention and state transitions are observable.
 *
 * The security assertions here are the point of the file. Each negative case states what an attacker
 * gains, because "returns 400" on its own does not record whether the refusal was the right one.
 */

const SESSION_TOKEN = 'session-token-for-document-routes';
const CSRF_TOKEN = 'csrf-token-for-document-routes';

const EXPENSE_ID = 'c1111111-1111-4111-8111-111111111111';
const OTHER_EXPENSE_ID = 'c2222222-2222-4222-8222-222222222222';
const UNKNOWN_TRANSACTION_ID = 'c9999999-9999-4999-8999-999999999999';
const NOT_A_UUID = 'not-a-uuid';
const CATEGORY_ID = 'd5555555-5555-4555-8555-555555555555';
const UNKNOWN_DOCUMENT_ID = 'e0000000-0000-4000-8000-000000000000';

/** A valid PNG: signature, IHDR, then filler. Enough for signature-based detection. */
function pngBytes(): Buffer {
  const bytes = Buffer.alloc(64);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);

  return bytes;
}

/** A valid PDF header. */
function pdfBytes(): Buffer {
  const bytes = Buffer.alloc(64);

  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0);

  return bytes;
}

/** A ZIP header — a real format that this application must refuse. */
function zipBytes(): Buffer {
  const bytes = Buffer.alloc(64);

  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);

  return bytes;
}

describe('Document HTTP contract', () => {
  let app: INestApplication;
  let restoreEnvironment: () => void;
  let documents: FakeDocuments;
  let storage: FakeDocumentStorage;

  beforeEach(async () => {
    const ledger = new FakeLedger([
      transactionFixture({
        id: EXPENSE_ID,
        referenceId: 'HY-EXP-000001',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 45_000n,
        paymentMethod: 'UPI',
        description: 'September electricity bill',
        categoryId: CATEGORY_ID,
        businessDate: parseBusinessDate('2026-09-05'),
      }),
      transactionFixture({
        id: OTHER_EXPENSE_ID,
        referenceId: 'HY-EXP-000002',
        transactionType: 'EXPENSE',
        incomeType: null,
        amountPaise: 9_000n,
        categoryId: CATEGORY_ID,
        businessDate: parseBusinessDate('2026-08-14'),
      }),
    ]);

    const transactions = new FakeTransactions(
      ledger,
      [],
      [],
      [categoryFixture({ id: CATEGORY_ID, name: 'Electricity', isSystem: true })],
    );

    documents = new FakeDocuments(ledger);
    storage = new FakeDocumentStorage();
    const idempotency = new FakeIdempotency();

    restoreEnvironment = applyTestProcessEnvironment();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StructuredLogger)
      .useValue(new StructuredLogger('error'))
      .overrideProvider(TransactionRepository)
      .useValue(transactions)
      .overrideProvider(AuditEventRepository)
      .useValue(new FakeAudit(ledger))
      .overrideProvider(MemberRepository)
      .useValue(new FakeMembers([]))
      .overrideProvider(ContributionPeriodRepository)
      .useValue(new FakePeriods([]))
      .overrideProvider(AppSettingRepository)
      .useValue(new FakeSettings({}))
      .overrideProvider(ExpenseCategoryRepository)
      .useValue(
        new FakeCategories([
          categoryFixture({ id: CATEGORY_ID, name: 'Electricity', isSystem: true }),
        ]),
      )
      .overrideProvider(TransactionDocumentRepository)
      .useValue(documents)
      .overrideProvider(DOCUMENT_STORAGE)
      .useValue(storage)
      .overrideProvider(IdempotencyRecordRepository)
      .useValue(idempotency)
      .overrideProvider(SessionService)
      .useValue({
        authenticate: async (token: string | undefined) =>
          token === SESSION_TOKEN
            ? fakeSession({ sessionId: 'session-documents', csrfToken: CSRF_TOKEN })
            : null,
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, TEST_ENVIRONMENT);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    restoreEnvironment();
  });

  function authGet(url: string) {
    return request(httpServer(app))
      .get(url)
      .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`]);
  }

  function authed() {
    return agent(httpServer(app))
      .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
      .set('Origin', TEST_ORIGIN)
      .set(CSRF_TOKEN_HEADER, CSRF_TOKEN);
  }

  function upload(transactionId: string, key: string, name: string, type: string, body: Buffer) {
    return authed()
      .post(`/api/v1/transactions/${transactionId}/documents`)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .attach(DOCUMENT_UPLOAD_FIELD, body, { filename: name, contentType: type });
  }

  /**
   * Uploads with a hand-built multipart body.
   *
   * `supertest`'s `.attach()` routes through `form-data`, which reduces a filename to its base name
   * before it is written to the wire. That is fine for testing the upload path, but it means no
   * assertion made through it can say anything about how the server treats a hostile
   * `Content-Disposition`. This helper writes the envelope itself so the filename the application
   * sees is exactly the one given.
   */
  function craftedUpload(
    transactionId: string,
    key: string,
    filename: string,
    contentType: string,
    body: Buffer,
  ) {
    const boundary = `----hyssop${key}`;
    const envelope = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${DOCUMENT_UPLOAD_FIELD}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
      'utf8',
    );
    const trailer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const payload = Buffer.concat([envelope, body, trailer]);

    return authed()
      .post(`/api/v1/transactions/${transactionId}/documents`)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(payload);
  }

  function removeDocument(documentId: string, key: string, body: Record<string, unknown>) {
    return authed()
      .delete(`/api/v1/documents/${documentId}`)
      .set(IDEMPOTENCY_KEY_HEADER, key)
      .send(body);
  }

  function expectApiError(response: Response, status: number, code: string): void {
    expect(response.status).toBe(status);
    expect(isApiErrorBody(response.body)).toBe(true);

    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe(code);
  }

  async function attachPng(
    transactionId = EXPENSE_ID,
    name = 'bill.png',
  ): Promise<DocumentSummary> {
    const response = await upload(
      transactionId,
      `key-${name}-${transactionId}`,
      name,
      'image/png',
      pngBytes(),
    );

    expect(response.status).toBe(201);

    return (response.body as { data: DocumentSummary }).data;
  }

  describe('authentication and CSRF', () => {
    it('refuses an unauthenticated upload', async () => {
      // Without this, a receipt becomes reachable by anyone who can reach the port.
      const response = await request(httpServer(app))
        .post(`/api/v1/transactions/${EXPENSE_ID}/documents`)
        .set(IDEMPOTENCY_KEY_HEADER, 'unauth-upload')
        .attach(DOCUMENT_UPLOAD_FIELD, pngBytes(), {
          filename: 'bill.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(401);
      expect(documents.rows.size).toBe(0);
    });

    it('refuses an unauthenticated list, detail, preview, download, and removal', async () => {
      const document = await attachPng();
      const plain = request(httpServer(app));

      expect((await plain.get(`/api/v1/transactions/${EXPENSE_ID}/documents`)).status).toBe(401);
      expect((await plain.get(`/api/v1/documents/${document.id}`)).status).toBe(401);
      expect((await plain.get(`/api/v1/documents/${document.id}/preview`)).status).toBe(401);
      expect((await plain.get(`/api/v1/documents/${document.id}/download`)).status).toBe(401);
      expect(
        (
          await plain
            .delete(`/api/v1/documents/${document.id}`)
            .set(IDEMPOTENCY_KEY_HEADER, 'unauth-remove')
            .send({ reason: 'because' })
        ).status,
      ).toBe(401);

      // Nothing was revoked by an unauthenticated attempt.
      expect(documents.rows.get(document.id)?.status).toBe('AVAILABLE');
    });

    it('refuses an upload without the CSRF token, so another site cannot submit one', async () => {
      // The session cookie alone is not authorisation to act; a cross-origin form can carry cookies.
      const response = await agent(httpServer(app))
        .post(`/api/v1/transactions/${EXPENSE_ID}/documents`)
        .set('Cookie', [`${TEST_SESSION_COOKIE}=${SESSION_TOKEN}`])
        .set('Origin', TEST_ORIGIN)
        .set(IDEMPOTENCY_KEY_HEADER, 'no-csrf')
        .attach(DOCUMENT_UPLOAD_FIELD, pngBytes(), {
          filename: 'bill.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(403);
      expect(documents.rows.size).toBe(0);
    });

    it('refuses an unauthenticated download without disclosing whether the document exists', async () => {
      const document = await attachPng();
      const response = await request(httpServer(app)).get(
        `/api/v1/documents/${document.id}/download`,
      );

      expect(response.status).toBe(401);
      expect(response.text ?? '').not.toContain(document.referenceId);
    });
  });

  describe('upload', () => {
    it('attaches a verified document and records honest metadata', async () => {
      const document = await attachPng();

      expect(document.id).toMatch(/^[0-9a-f-]{36}$/);
      // The human-facing identifier must be the project's documented document reference.
      expect(document.referenceId).toMatch(/^HY-DOC-\d{6}$/);
      expect(document.transactionId).toBe(EXPENSE_ID);
      expect(document.transactionReferenceId).toBe('HY-EXP-000001');
      expect(document.status).toBe('AVAILABLE');
      expect(document.contentAvailable).toBe(true);
      expect(document.detectedMimeType).toBe('image/png');
      expect(document.declaredMimeType).toBe('image/png');
      expect(document.byteSize).toBe(64);
      expect(document.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(document.originalFilename).toBe('bill.png');
      expect(document.removalReason).toBeNull();
      expect(document.cleanupPending).toBe(false);
    });

    it('stores the bytes and returns links the browser can use, never a filesystem path', async () => {
      const document = await attachPng();

      expect(storage.objects.size).toBe(1);
      expect(document.downloadPath).toBe(`/api/v1/documents/${document.id}/download`);
      expect(document.previewPath).toBe(`/api/v1/documents/${document.id}/preview`);

      const serialised = JSON.stringify(document);
      expect(serialised).not.toContain('storage/uploads');
      expect(serialised).not.toContain('\\');
      expect(serialised).not.toMatch(/[A-Za-z]:\\\\/);
    });

    it('attaches several documents to one transaction, each with its own reference', async () => {
      // `REQ-DOC-001` requires multiple attachments; a single-receipt model would fail here.
      const first = await attachPng(EXPENSE_ID, 'front.png');
      const second = await attachPng(EXPENSE_ID, 'back.png');
      const third = (
        (await (
          await upload(EXPENSE_ID, 'key-pdf', 'statement.pdf', 'application/pdf', pdfBytes())
        ).body) as { data: DocumentSummary }
      ).data;

      const references = [first.referenceId, second.referenceId, third.referenceId];
      expect(new Set(references).size).toBe(3);
      expect(storage.objects.size).toBe(3);
    });

    it('records the type it detected, not the type the client claimed', async () => {
      // An honest client declaring `application/octet-stream` still gets a verified stored type.
      const response = await upload(
        EXPENSE_ID,
        'key-neutral',
        'scan.bin',
        'application/octet-stream',
        pngBytes(),
      );

      const document = (response.body as { data: DocumentSummary }).data;
      expect(document.detectedMimeType).toBe('image/png');
    });

    it('rejects a request with no file at all', async () => {
      const response = await authed()
        .post(`/api/v1/transactions/${EXPENSE_ID}/documents`)
        .set(IDEMPOTENCY_KEY_HEADER, 'no-file');

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(documents.rows.size).toBe(0);
    });

    it('rejects a file whose bytes are not a supported format', async () => {
      // An executable or archive renamed to `.png`. The declared type and the extension are both
      // attacker-controlled, so only the bytes may decide.
      const response = await upload(EXPENSE_ID, 'key-zip', 'invoice.png', 'image/png', zipBytes());

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(storage.objects.size).toBe(0);
    });

    it('rejects a file whose declared type contradicts its bytes', async () => {
      // A PNG uploaded as a PDF. Accepting it would store the file as a PDF and serve it back with
      // a PDF content type.
      const response = await upload(
        EXPENSE_ID,
        'key-mismatch',
        'disguised.pdf',
        'application/pdf',
        pngBytes(),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(storage.objects.size).toBe(0);
    });

    it('rejects a file over the configured limit', async () => {
      const oversized = Buffer.alloc(TEST_ENVIRONMENT.storage.uploadMaxBytes + 1);
      oversized.set(pngBytes(), 0);

      const response = await upload(EXPENSE_ID, 'key-large', 'huge.png', 'image/png', oversized);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(storage.objects.size).toBe(0);
    });

    it('rejects a filename carrying a path, rather than quietly rewriting it', async () => {
      // Sent as a hand-built multipart body on purpose. The `form-data` client used by the other
      // cases applies `path.basename` to a filename before it leaves the machine, so a browser or a
      // well-behaved library can never deliver this. A crafted client can, and that is the request
      // the server has to refuse — silently accepting it would mean the application trusts a value
      // it cannot see.
      const response = await craftedUpload(
        EXPENSE_ID,
        'key-traversal',
        '../../../windows/system32/config/sam.png',
        'image/png',
        pngBytes(),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(documents.rows.size).toBe(0);
      expect(storage.objects.size).toBe(0);
    });

    it('rejects a filename carrying a Windows-style path', async () => {
      const response = await craftedUpload(
        EXPENSE_ID,
        'key-traversal-backslash',
        '..\\..\\windows\\system32\\config\\sam.png',
        'image/png',
        pngBytes(),
      );

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(documents.rows.size).toBe(0);
    });

    it('never lets a filename influence where the bytes land', async () => {
      // Belt and braces: even though a name carrying separators is refused, the stored key is
      // generated server-side, so no client-supplied text can influence the storage path.
      const response = await upload(
        EXPENSE_ID,
        'key-hostile-store',
        'a.b.c.png',
        'image/png',
        pngBytes(),
      );
      const document = (response.body as { data: DocumentSummary }).data;

      expect(document.originalFilename).toBe('a.b.c.png');
      expect(storage.objects.size).toBe(1);
    });

    it('refuses to attach to a transaction that does not exist', async () => {
      const response = await upload(
        UNKNOWN_TRANSACTION_ID,
        'key-unknown-tx',
        'bill.png',
        'image/png',
        pngBytes(),
      );

      expectApiError(response, 404, 'NOT_FOUND');
      expect(storage.objects.size).toBe(0);
      expect(documents.rows.size).toBe(0);
    });

    it('rejects a malformed transaction identifier as a bad request, not a missing transaction', async () => {
      // Reporting `404` for `not-a-uuid` would tell the Admin a record they can see never existed.
      const response = await upload(NOT_A_UUID, 'key-bad-id', 'bill.png', 'image/png', pngBytes());

      expectApiError(response, 400, 'VALIDATION_FAILED');
    });

    it('requires an idempotency key, so a retried upload cannot attach a second copy', async () => {
      const response = await authed()
        .post(`/api/v1/transactions/${EXPENSE_ID}/documents`)
        .attach(DOCUMENT_UPLOAD_FIELD, pngBytes(), {
          filename: 'bill.png',
          contentType: 'image/png',
        });

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(documents.rows.size).toBe(0);
    });

    it('replays an identical resend instead of attaching the receipt twice', async () => {
      // A dropped connection makes a browser resend the multipart body. Two copies of one receipt
      // would make the Admin's document list a lie about what was received.
      const first = await upload(EXPENSE_ID, 'key-retry', 'bill.png', 'image/png', pngBytes());
      const second = await upload(EXPENSE_ID, 'key-retry', 'bill.png', 'image/png', pngBytes());

      expect(second.status).toBe(201);
      expect((second.body as { data: DocumentSummary }).data.id).toBe(
        (first.body as { data: DocumentSummary }).data.id,
      );
      expect(documents.rows.size).toBe(1);
    });
  });

  describe('listing and metadata', () => {
    it('lists a transaction documents oldest first', async () => {
      await attachPng(EXPENSE_ID, 'first.png');
      await attachPng(EXPENSE_ID, 'second.png');

      const response = await authGet(`/api/v1/transactions/${EXPENSE_ID}/documents`);
      const listed = (response.body as { data: DocumentSummary[] }).data;

      expect(response.status).toBe(200);
      expect(listed).toHaveLength(2);
      expect(listed.map((row) => row.originalFilename)).toEqual(['first.png', 'second.png']);
    });

    it('does not leak another transaction documents', async () => {
      await attachPng(EXPENSE_ID, 'mine.png');
      await attachPng(OTHER_EXPENSE_ID, 'theirs.png');

      const mine = (await authGet(`/api/v1/transactions/${EXPENSE_ID}/documents`)).body as {
        data: DocumentSummary[];
      };

      expect(mine.data).toHaveLength(1);
      expect(mine.data[0]?.originalFilename).toBe('mine.png');
    });

    it('returns metadata for one document without returning its bytes', async () => {
      const document = await attachPng();
      const response = await authGet(`/api/v1/documents/${document.id}`);

      expect(response.status).toBe(200);
      expect((response.body as { data: DocumentSummary }).data.id).toBe(document.id);
      // JSON, not an image stream.
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('reports an unknown document as not found', async () => {
      expectApiError(await authGet(`/api/v1/documents/${UNKNOWN_DOCUMENT_ID}`), 404, 'NOT_FOUND');
    });

    it('rejects a malformed document identifier', async () => {
      expectApiError(await authGet(`/api/v1/documents/${NOT_A_UUID}`), 400, 'VALIDATION_FAILED');
    });
  });

  describe('preview', () => {
    it('serves a verified image inline with the detected type', async () => {
      const document = await attachPng();
      const response = await authGet(`/api/v1/documents/${document.id}/preview`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^image\/png/);
      expect(response.headers['content-disposition']).toMatch(/^inline/);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('does not offer an inline preview for a PDF', async () => {
      // A PDF is a container that can carry active content. Serving it inline would let the browser's
      // viewer render unverified markup from an uploaded file.
      const response = await upload(
        EXPENSE_ID,
        'key-pdf-preview',
        'statement.pdf',
        'application/pdf',
        pdfBytes(),
      );
      const document = (response.body as { data: DocumentSummary }).data;

      expect(document.previewAvailable).toBe(false);
      expect(document.previewPath).toBeNull();
      expectApiError(
        await authGet(`/api/v1/documents/${document.id}/preview`),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('never leaks a filesystem path in a response header', async () => {
      const document = await attachPng();
      const response = await authGet(`/api/v1/documents/${document.id}/preview`);
      const headers = JSON.stringify(response.headers);

      expect(headers).not.toContain('storage/uploads');
      expect(headers).not.toMatch(/[A-Za-z]:\\\\/);
    });
  });

  describe('download', () => {
    it('serves the exact bytes that were uploaded, as an attachment', async () => {
      const original = pngBytes();
      const response = await upload(EXPENSE_ID, 'key-download', 'bill.png', 'image/png', original);
      const document = (response.body as { data: DocumentSummary }).data;

      const download = await authGet(`/api/v1/documents/${document.id}/download`);

      expect(download.status).toBe(200);
      expect(download.headers['content-type']).toMatch(/^image\/png/);
      expect(download.headers['content-disposition']).toMatch(/^attachment/);
      expect(download.headers['content-length']).toBe(String(original.length));
      expect(Buffer.from(download.body)).toEqual(original);
    });

    it('sends the extension implied by the verified bytes, not by the uploaded name', async () => {
      // `application/octet-stream` declarations fall back to the detected type, so the download
      // still carries a real extension the browser can name correctly.
      const response = await upload(
        EXPENSE_ID,
        'key-ext',
        'scan.bin',
        'application/octet-stream',
        pngBytes(),
      );
      const document = (response.body as { data: DocumentSummary }).data;

      const download = await authGet(`/api/v1/documents/${document.id}/download`);
      expect(download.headers['content-type']).toMatch(/^image\/png/);
      expect(download.headers['content-disposition']).toContain('filename="document.png"');
    });

    it('quotes a hostile filename safely in the disposition header', async () => {
      // A quote or a parameter separator in a name must not be able to inject a second directive
      // such as `filename="evil.exe"; x=`, nor to terminate the parameter early.
      const response = await upload(
        EXPENSE_ID,
        'key-hostile-name',
        'bill"; attachment=evil.exe.png',
        'image/png',
        pngBytes(),
      );
      const document = (response.body as { data: DocumentSummary }).data;

      const disposition = (await authGet(`/api/v1/documents/${document.id}/download`)).headers[
        'content-disposition'
      ] as string;

      // The ASCII parameter is the safe fallback name built from verified content.
      expect(disposition).toContain('filename="document.png"');
      // Exactly one directive token: the injected `attachment=` did not become a second one.
      expect(
        disposition.split(';').filter((part) => part.trim().startsWith('attachment')),
      ).toHaveLength(1);
      expect(disposition.split(';')[0]).toBe('attachment');

      // The readable name survives only in the percent-encoded parameter, where a quote, a
      // semicolon, and a backslash cannot break out.
      const extended = disposition.slice(disposition.indexOf('filename*='));
      expect(extended).toContain("filename*=UTF-8''");
      expect(extended).not.toContain('"');
      expect(extended).not.toContain(';');
      expect(extended).not.toContain('\\');
    });
  });

  describe('removal', () => {
    it('requires a reason, because the removal is audited', async () => {
      const document = await attachPng();

      for (const reason of ['', '   ', undefined]) {
        const response = await removeDocument(
          document.id,
          `key-no-reason-${String(reason)}`,
          reason === undefined ? {} : { reason },
        );

        expectApiError(response, 400, 'VALIDATION_FAILED');
      }

      expect(documents.rows.get(document.id)?.status).toBe('AVAILABLE');
    });

    it('revokes content access, retains the metadata, and records the reason', async () => {
      const document = await attachPng();

      const response = await removeDocument(document.id, 'key-remove', {
        reason: 'Duplicate receipt for the same bill',
      });

      expect(response.status).toBe(200);

      const removed = (response.body as { data: DocumentSummary }).data;
      expect(removed.status).toBe('REMOVED');
      expect(removed.contentAvailable).toBe(false);
      expect(removed.previewAvailable).toBe(false);
      expect(removed.removalReason).toBe('Duplicate receipt for the same bill');
      expect(removed.removedAt).not.toBeNull();

      // Metadata survives for history — the row is not deleted.
      const listed = (
        (await authGet(`/api/v1/transactions/${EXPENSE_ID}/documents`)).body as {
          data: DocumentSummary[];
        }
      ).data;
      expect(listed).toHaveLength(1);
      expect(listed[0]?.removalReason).toBe('Duplicate receipt for the same bill');
    });

    it('answers 410 Gone for the removed bytes rather than pretending the document never existed', async () => {
      // The distinction is what lets the browser tell "never existed" from "existed, was removed".
      const document = await attachPng();
      await removeDocument(document.id, 'key-gone', { reason: 'Removed for testing' });

      expectApiError(await authGet(`/api/v1/documents/${document.id}/download`), 410, 'NOT_FOUND');
      expectApiError(await authGet(`/api/v1/documents/${document.id}/preview`), 410, 'NOT_FOUND');

      // Metadata is still readable, because it is history rather than content.
      expect((await authGet(`/api/v1/documents/${document.id}`)).status).toBe(200);
    });

    it('does not echo the removal reason into the 410 body', async () => {
      const document = await attachPng();
      await removeDocument(document.id, 'key-echo', {
        reason: 'Confidential detail the Admin typed',
      });

      const response = await authGet(`/api/v1/documents/${document.id}/download`);
      expect(JSON.stringify(response.body)).not.toContain('Confidential detail');
    });

    it('deletes the bytes and reports the cleanup as finished', async () => {
      const document = await attachPng();
      const row = documents.rows.get(document.id);

      const response = await removeDocument(document.id, 'key-deleted', { reason: 'Done' });
      const removed = (response.body as { data: DocumentSummary }).data;

      expect(removed.storageDeleted).toBe(true);
      expect(removed.cleanupPending).toBe(false);
      expect(storage.objects.has(row?.storageKey ?? '')).toBe(false);
    });

    it('keeps access revoked and reports cleanup as pending when physical deletion fails', async () => {
      // The Admin's request succeeded the moment the row committed. A storage failure must not
      // un-remove the document, and must not be reported as a failure the Admin can act on.
      const document = await attachPng();
      storage.failNextDelete = true;

      const response = await removeDocument(document.id, 'key-pending', { reason: 'Done' });
      const removed = (response.body as { data: DocumentSummary }).data;

      expect(response.status).toBe(200);
      expect(removed.status).toBe('REMOVED');
      expect(removed.contentAvailable).toBe(false);
      expect(removed.cleanupPending).toBe(true);
      expect(removed.storageDeleted).toBe(false);

      // Still inaccessible despite the leftover bytes.
      expectApiError(await authGet(`/api/v1/documents/${document.id}/download`), 410, 'NOT_FOUND');
    });

    it('reports a missing document as not found', async () => {
      expectApiError(
        await removeDocument(UNKNOWN_DOCUMENT_ID, 'key-unknown-doc', { reason: 'x' }),
        404,
        'NOT_FOUND',
      );
    });

    it('rejects an unexpected body property instead of ignoring it', async () => {
      const document = await attachPng();

      const response = await removeDocument(document.id, 'key-extra', {
        reason: 'Done',
        storageDeletedAt: '2020-01-01T00:00:00.000Z',
      });

      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(documents.rows.get(document.id)?.status).toBe('AVAILABLE');
    });
  });

  describe('receipt indication', () => {
    it('reports no receipt on a transaction before anything is attached', async () => {
      const response = await authGet(`/api/v1/transactions/${OTHER_EXPENSE_ID}`);

      expect((response.body as { data: { hasReceipt: boolean } }).data.hasReceipt).toBe(false);
    });

    it('derives the receipt state from attached documents rather than storing it', async () => {
      await attachPng(EXPENSE_ID);

      const response = await authGet(`/api/v1/transactions/${EXPENSE_ID}`);
      const data = (response.body as { data: { hasReceipt: boolean; documentCount: number } }).data;

      expect(data.hasReceipt).toBe(true);
      expect(data.documentCount).toBe(1);
    });
  });
});
