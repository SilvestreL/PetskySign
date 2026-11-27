import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PDFDocument } from "pdf-lib";
import type pg from "pg";

import { openTestDatabase } from "../db/test-database.ts";
import {
  DownloadAccessError,
  getSignerEnvelopeDownload,
} from "../downloads.ts";
import { ELECTRONIC_RECORDS_DISCLOSURE_VERSION } from "../electronic-records-disclosure.ts";
import {
  getSigningPayloadForToken,
  recordSignerConsent,
  submitSigningForToken,
} from "../signing.ts";
import { createApiDocument, createApiDocumentSchema } from "./api-documents.ts";
import { authenticateApiKey, createApiKey } from "./api-keys.ts";
import { hashCpf, IDENTITY_MAX_ATTEMPTS } from "./cpf.ts";
import {
  CopyUnlockError,
  DOWNLOAD_WINDOW_SECONDS,
  getSignerCompletionForToken,
  unlockSignerCopy,
} from "./signer-completion.ts";

// The page a signer lands on after signing, against a real Postgres.
// Run with `npm run test:db`.

let database: pg.Pool;
let workDir: string;
const createdUsers: string[] = [];
const context = { ipAddress: "203.0.113.9", userAgent: "petsky-test" };

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "petskysign-completion-"));
  process.env.APP_URL = "https://assinar.example.test";
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = path.join(workDir, "storage");
  process.env.EMAIL_DRIVER = "capture";
  process.env.EMAIL_CAPTURE_DIR = path.join(workDir, "outbox");
  process.env.WEBHOOK_DELIVERY_ON_COMMIT = "0";
  database = await openTestDatabase();
  globalThis.__signudocPgPool = database;
});

after(async () => {
  await database.query(`delete from public."user" where id = any($1)`, [
    createdUsers,
  ]);
  await database.end();
  await rm(workDir, { force: true, recursive: true });
});

async function sendDocument() {
  const userId = randomUUID();

  createdUsers.push(userId);
  await database.query(
    `
      insert into public."user" (id, name, email, "emailVerified", role)
      values ($1, 'Petsky', $2, true, 'user')
    `,
    [userId, `${userId}@example.test`],
  );

  const created = await createApiKey({ name: "test", userId }, database);
  const principal = await authenticateApiKey(created.key, database);
  const pdf = await PDFDocument.create();

  assert.ok(principal);
  pdf.addPage([595, 842]);

  const sent = await createApiDocument(
    principal,
    createApiDocumentSchema.parse({
      companyRef: "casa-1",
      externalRef: "contrato-1",
      permittedUseConfirmed: true,
      signer: { name: "Tutor Link" },
      title: "Termo de adesão",
    }),
    {
      body: await pdf.save(),
      contentType: "application/pdf",
      filename: "c.pdf",
    },
    context,
    database,
  );

  return new URL(sent.signLink!).pathname.split("/").pop()!;
}

async function sign(token: string) {
  const payload = await getSigningPayloadForToken(token, { database });
  const field = payload.currentSignerFields.find(
    (item) => item.type === "signature",
  );

  assert.ok(field);
  await recordSignerConsent(
    token,
    { disclosureVersion: ELECTRONIC_RECORDS_DISCLOSURE_VERSION },
    { database },
  );
  await submitSigningForToken(
    token,
    {
      clientTimezoneOffsetMinutes: 180,
      fields: [
        {
          fieldId: field.id,
          inputMethod: "typed",
          type: "signature",
          value: "Tutor Link",
        },
      ],
    },
    { database },
  );
}

test("an unknown or empty link finds nothing", async () => {
  assert.equal(
    await getSignerCompletionForToken("not-a-real-token", { database }),
    null,
  );
  assert.equal(await getSignerCompletionForToken("", { database }), null);
});

test("before signing nothing can be downloaded", async () => {
  const token = await sendDocument();
  const completion = await getSignerCompletionForToken(token, { database });

  assert.ok(completion);
  assert.equal(completion.signerStatus, "notified");
  assert.equal(completion.downloadAvailable, false);
  assert.equal(completion.downloadUntil, null);
  await assert.rejects(
    getSignerEnvelopeDownload(
      completion.signerId,
      completion.envelopeId,
      "signed",
      { database },
    ),
    DownloadAccessError,
  );
});

test("once everyone has signed, the signer gets the PDF, certificate and hash", async () => {
  const token = await sendDocument();

  await sign(token);

  const completion = await getSignerCompletionForToken(token, { database });

  assert.ok(completion);
  assert.equal(completion.title, "Termo de adesão");
  assert.equal(completion.signerName, "Tutor Link");
  assert.equal(completion.signerStatus, "signed");
  assert.equal(completion.envelopeStatus, "completed");
  assert.equal(completion.awaitingCount, 0);
  assert.equal(completion.downloadAvailable, true);
  assert.equal(
    completion.downloadUntil,
    completion.completedAt! + DOWNLOAD_WINDOW_SECONDS,
  );
  assert.match(completion.signedPdfSha256 ?? "", /^[0-9a-f]{64}$/);

  for (const fileType of ["signed", "evidence"]) {
    const download = await getSignerEnvelopeDownload(
      completion.signerId,
      completion.envelopeId,
      fileType,
      { database },
    );

    assert.equal(download.contentType, "application/pdf");
    assert.equal(download.envelopeId, completion.envelopeId);
    assert.equal(download.fileType, fileType);
    assert.ok(download.key.length > 0);
  }
});

test("the downloads stop after the window, and are refused for another envelope", async () => {
  const token = await sendDocument();

  await sign(token);

  const completion = await getSignerCompletionForToken(token, { database });

  assert.ok(completion?.completedAt);

  const later = await getSignerCompletionForToken(token, {
    database,
    now: completion.completedAt + DOWNLOAD_WINDOW_SECONDS,
  });

  assert.equal(later?.downloadAvailable, false);
  assert.equal(later?.downloadUntil, null);

  // A signer id from one envelope does not open another.
  const otherToken = await sendDocument();

  await sign(otherToken);

  const other = await getSignerCompletionForToken(otherToken, { database });

  assert.ok(other);
  await assert.rejects(
    getSignerEnvelopeDownload(completion.signerId, other.envelopeId, "signed", {
      database,
    }),
    DownloadAccessError,
  );
});

test("with a CPF on file, the copy asks for it again, with its own tries", async () => {
  const token = await sendDocument();

  await sign(token);
  // As if the sender had sent the CPF: the copy now needs it.
  const signer = await getSignerCompletionForToken(token, { database });

  assert.ok(signer);
  assert.equal(signer.identityRequired, false);
  await database.query(
    `update signers set identity_cpf_hash = $1 where id = $2`,
    [hashCpf("52998224725"), signer.signerId],
  );
  assert.equal(
    (await getSignerCompletionForToken(token, { database }))?.identityRequired,
    true,
  );

  await assert.rejects(
    unlockSignerCopy(token, { cpf: "111.444.777-35" }, { database }),
    (error) => error instanceof CopyUnlockError && error.statusCode === 400,
  );
  // The right CPF clears the count; wrong ones then lock the copy.
  await unlockSignerCopy(token, { cpf: "529.982.247-25" }, { database });

  for (let index = 0; index < IDENTITY_MAX_ATTEMPTS; index += 1) {
    await assert.rejects(
      unlockSignerCopy(token, { cpf: "111.444.777-35" }, { database }),
      CopyUnlockError,
    );
  }

  await assert.rejects(
    unlockSignerCopy(token, { cpf: "529.982.247-25" }, { database }),
    (error) => error instanceof CopyUnlockError && error.statusCode === 429,
  );
});
