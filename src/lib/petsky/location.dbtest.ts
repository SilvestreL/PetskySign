import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PDFDocument } from "pdf-lib";

import { createStorageService } from "../services/storage.ts";
import type pg from "pg";

import { openTestDatabase } from "../db/test-database.ts";
import { ELECTRONIC_RECORDS_DISCLOSURE_VERSION } from "../electronic-records-disclosure.ts";
import {
  getSigningPayloadForToken,
  recordSignerConsent,
  submitSigningForToken,
} from "../signing.ts";
import { createApiDocument, createApiDocumentSchema } from "./api-documents.ts";
import { authenticateApiKey, createApiKey } from "./api-keys.ts";
import type { IpLocation } from "./location.ts";

// The signer's location reaches the audit trail of each step: approximate by
// IP when Cloudflare sends it, and from the device when the signer allowed
// it. Run with `npm run test:db`.

let database: pg.Pool;
let workDir: string;
const createdUsers: string[] = [];
const ip: IpLocation = {
  city: "Maceió",
  country: "BR",
  latitude: -9.6658,
  longitude: -35.7353,
  region: "Alagoas",
  source: "ip",
};
const requestMeta = {
  ipAddress: "203.0.113.9",
  location: ip,
  userAgent: "petsky-test",
};

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "petskysign-location-"));
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
      externalRef: "contrato-geo",
      permittedUseConfirmed: true,
      signer: { name: "Tutor Local" },
      title: "Contrato",
    }),
    {
      body: await pdf.save(),
      contentType: "application/pdf",
      filename: "c.pdf",
    },
    { ipAddress: "203.0.113.1", userAgent: "petsky-api" },
    database,
  );

  return { sent, token: new URL(sent.signLink!).pathname.split("/").pop()! };
}

async function locationOf(documentId: string, event: string) {
  const result = await database.query<{ location: unknown }>(
    `
      select metadata->'location' as location from audit_events
      where envelope_id = $1 and event = $2
    `,
    [documentId, event],
  );

  return result.rows[0]?.location ?? null;
}

async function sign(token: string, extra: Record<string, unknown>) {
  const payload = await getSigningPayloadForToken(token, {
    database,
    requestMeta,
  });
  const field = payload.currentSignerFields.find(
    (item) => item.type === "signature",
  );

  assert.ok(field);
  await recordSignerConsent(
    token,
    { disclosureVersion: ELECTRONIC_RECORDS_DISCLOSURE_VERSION },
    { database, requestMeta },
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
          value: "Tutor Local",
        },
      ],
      ...extra,
    },
    { database, requestMeta },
  );
}

test("viewed, consented and signed carry the IP location, and signed the device's", async () => {
  const { sent, token } = await sendDocument();

  await sign(token, {
    deviceLocation: { accuracy: 12, latitude: -9.65, longitude: -35.71 },
  });

  assert.deepEqual(await locationOf(sent.documentId, "viewed"), { ip });
  assert.deepEqual(await locationOf(sent.documentId, "consented"), { ip });
  assert.deepEqual(await locationOf(sent.documentId, "signed"), {
    device: {
      accuracy: 12,
      latitude: -9.65,
      longitude: -35.71,
      source: "device",
    },
    deviceStatus: "shared",
    ip,
  });
});

test("a refused or broken device location never blocks the signature", async () => {
  const refused = await sendDocument();

  await sign(refused.token, { deviceLocationStatus: "denied" });
  assert.deepEqual(await locationOf(refused.sent.documentId, "signed"), {
    deviceStatus: "denied",
    ip,
  });

  const broken = await sendDocument();

  await sign(broken.token, {
    deviceLocation: { latitude: 500, longitude: "x" },
    deviceLocationStatus: "nonsense",
  });
  assert.deepEqual(await locationOf(broken.sent.documentId, "signed"), { ip });
});

test("the signed PDF is one file: the document, then its certificate", async () => {
  const { sent, token } = await sendDocument();

  await sign(token, { deviceLocationStatus: "denied" });

  const { rows } = await database.query<{ key: string }>(
    `select signed_pdf_key as key from envelopes where id = $1`,
    [sent.documentId],
  );
  const signed = await createStorageService().getObject(rows[0]!.key);
  const pdf = await PDFDocument.load(signed.body);

  // One page of contract, then the certificate's page or pages.
  assert.ok(pdf.getPageCount() >= 2, `pages: ${pdf.getPageCount()}`);
});
