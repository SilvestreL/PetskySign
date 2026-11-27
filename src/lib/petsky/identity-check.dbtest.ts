import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PDFDocument } from "pdf-lib";
import type pg from "pg";

import { openTestDatabase } from "../db/test-database.ts";
import { ELECTRONIC_RECORDS_DISCLOSURE_VERSION } from "../electronic-records-disclosure.ts";
import {
  getSigningPayloadForToken,
  recordSignerConsent,
  SigningMutationError,
  SigningVerificationRequiredError,
  submitSigningForToken,
  verifySignerCheck,
} from "../signing.ts";
import { createApiDocument, createApiDocumentSchema } from "./api-documents.ts";
import { authenticateApiKey, createApiKey } from "./api-keys.ts";
import { decryptCpf, IDENTITY_MAX_ATTEMPTS, normalizeCpf } from "./cpf.ts";

// The identity check (full name and CPF) and the emailed code, sent through
// the API, against a real Postgres. Run with `npm run test:db`.

// A valid CPF made for tests (check digits computed, not a real person's).
const CPF = "529.982.247-25";
const OTHER_CPF = "111.444.777-35";

let database: pg.Pool;
let workDir: string;
const createdUsers: string[] = [];
const context = { ipAddress: "203.0.113.9", userAgent: "petsky-test" };

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "petskysign-identity-"));
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

async function send(signer: Record<string, unknown>) {
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
      permittedUseConfirmed: true,
      signer: { name: "Tutora Identidade", ...signer },
      title: "Contrato com CPF",
    }),
    {
      body: await pdf.save(),
      contentType: "application/pdf",
      filename: "c.pdf",
    },
    context,
    database,
  );

  return {
    documentId: sent.documentId,
    token: new URL(sent.signLink ?? "https://x/sign/none").pathname
      .split("/")
      .pop()!,
  };
}

async function pendingChecks(token: string, verifiedMethods: string[] = []) {
  try {
    await getSigningPayloadForToken(token, {
      database,
      verifiedMethods: verifiedMethods as never,
    });
    return [];
  } catch (error) {
    assert.ok(error instanceof SigningVerificationRequiredError);
    return error.details.pending;
  }
}

function verify(token: string, body: Record<string, unknown>) {
  return verifySignerCheck(
    token,
    { method: "identity", ...body },
    { database, requestMeta: context },
  );
}

test("the API refuses an invalid CPF, and an emailed code without an address", () => {
  assert.throws(() =>
    createApiDocumentSchema.parse({
      permittedUseConfirmed: true,
      signer: { cpf: "123.456.789-00", name: "Tutora" },
      title: "x",
    }),
  );
  assert.throws(() =>
    createApiDocumentSchema.parse({
      permittedUseConfirmed: true,
      signer: { name: "Tutora", requireEmailCode: true },
      title: "x",
    }),
  );
});

test("with a CPF, the document opens only after the right full name and CPF", async () => {
  const { documentId, token } = await send({ cpf: CPF });

  assert.deepEqual(await pendingChecks(token), ["identity"]);

  // Only a first name, or a CPF with bad check digits: refused before
  // counting a try.
  await assert.rejects(
    verify(token, { cpf: CPF, fullName: "Tutora" }),
    SigningMutationError,
  );
  await assert.rejects(
    verify(token, { cpf: "529.982.247-24", fullName: "Tutora Identidade" }),
    SigningMutationError,
  );

  // A valid CPF that is not the one sent: refused, and counted.
  await assert.rejects(
    verify(token, { cpf: OTHER_CPF, fullName: "Tutora Identidade" }),
    /does not match/,
  );

  const passed = await verify(token, {
    cpf: "52998224725",
    fullName: "  Tutora   Identidade ",
  });

  assert.deepEqual(passed, ["identity"]);
  assert.deepEqual(await pendingChecks(token, passed), []);

  // The audit trail keeps what was typed, with the CPF masked.
  const events = await database.query<{ event: string; metadata: unknown }>(
    `
      select event, metadata from audit_events
      where envelope_id = $1 and event in ('verified', 'verification_failed')
      order by created_at, id
    `,
    [documentId],
  );
  const verified = events.rows.find((row) => row.event === "verified");

  assert.equal(
    events.rows.filter((row) => row.event === "verification_failed").length,
    1,
  );
  assert.deepEqual(
    {
      cpf: (verified?.metadata as Record<string, unknown>)?.cpf,
      declaredName: (verified?.metadata as Record<string, unknown>)
        ?.declaredName,
      method: (verified?.metadata as Record<string, unknown>)?.method,
    },
    {
      cpf: "529.***.***-25",
      declaredName: "Tutora Identidade",
      method: "identity",
    },
  );

  // And the signature records the check it passed.
  const payload = await getSigningPayloadForToken(token, {
    database,
    verifiedMethods: passed,
  });
  const field = payload.currentSignerFields.find(
    (item) => item.type === "signature",
  );

  assert.ok(field);
  await recordSignerConsent(
    token,
    { disclosureVersion: ELECTRONIC_RECORDS_DISCLOSURE_VERSION },
    { database, verifiedMethods: passed },
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
          value: "Tutora Identidade",
        },
      ],
    },
    { database, verifiedMethods: passed },
  );

  const signed = await database.query<{
    metadata: { authMethods?: string[]; identityCpfEncrypted?: string };
  }>(
    `select metadata from audit_events where envelope_id = $1 and event = 'signed'`,
    [documentId],
  );

  assert.deepEqual(signed.rows[0]?.metadata.authMethods, ["identity"]);
  // The full CPF, for the certificate: encrypted, never in the clear.
  assert.doesNotMatch(
    JSON.stringify(signed.rows[0]?.metadata),
    new RegExp(normalizeCpf(CPF)!),
  );
  assert.equal(
    decryptCpf(signed.rows[0]?.metadata.identityCpfEncrypted),
    normalizeCpf(CPF),
  );
});

test("after too many wrong CPFs, even the right one is refused", async () => {
  const { token } = await send({ cpf: CPF });

  for (let index = 0; index < IDENTITY_MAX_ATTEMPTS; index += 1) {
    await assert.rejects(
      verify(token, { cpf: OTHER_CPF, fullName: "Tutora Identidade" }),
      SigningMutationError,
    );
  }

  await assert.rejects(
    verify(token, { cpf: CPF, fullName: "Tutora Identidade" }),
    /Too many wrong tries/,
  );
});

test("with an emailed code too, the code comes first, then name and CPF", async () => {
  const { token } = await send({
    channel: "link",
    cpf: CPF,
    email: "tutora@example.test",
    requireEmailCode: true,
  });

  assert.deepEqual(await pendingChecks(token), ["email_code", "identity"]);
  assert.deepEqual(await pendingChecks(token, ["email_code"]), ["identity"]);
});

test("without a CPF nothing changes: the document opens at once", async () => {
  const { token } = await send({});

  assert.deepEqual(await pendingChecks(token), []);
});
