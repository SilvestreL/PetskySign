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
  getSigningPayloadForToken,
  sendSignerWhatsappCode,
  SigningMutationError,
  SigningVerificationRequiredError,
  verifySignerCheck,
} from "../signing.ts";
import {
  ApiDocumentError,
  createApiDocument,
  createApiDocumentSchema,
} from "./api-documents.ts";
import { authenticateApiKey, createApiKey } from "./api-keys.ts";
import { maskPhone, normalizeBrazilMobile } from "./whatsapp.ts";

// The one-time code by WhatsApp, sent through the API, against a real
// Postgres. Nothing is sent: a fake sender keeps the message.
// Run with `npm run test:db`.

let database: pg.Pool;
let workDir: string;
const createdUsers: string[] = [];
const context = { ipAddress: "203.0.113.9", userAgent: "petsky-test" };
const sent: Array<{ text: string; to: string }> = [];
const fakeSender = async (to: string, text: string) => {
  sent.push({ text, to });
};

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "petskysign-whatsapp-"));
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
  delete process.env.EVOLUTION_API_URL;
  delete process.env.EVOLUTION_API_KEY;
  delete process.env.EVOLUTION_INSTANCE;
});

function configureEvolution(on: boolean) {
  if (on) {
    process.env.EVOLUTION_API_URL = "https://evolution.example.test";
    process.env.EVOLUTION_API_KEY = "test-key";
    process.env.EVOLUTION_INSTANCE = "PETSKY";
  } else {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    delete process.env.EVOLUTION_INSTANCE;
  }
}

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

  const result = await createApiDocument(
    principal,
    createApiDocumentSchema.parse({
      permittedUseConfirmed: true,
      signer: { name: "Tutora WhatsApp", ...signer },
      title: "Contrato por WhatsApp",
    }),
    {
      body: await pdf.save(),
      contentType: "application/pdf",
      filename: "c.pdf",
    },
    context,
    database,
  );

  return new URL(result.signLink!).pathname.split("/").pop()!;
}

async function pending(token: string, verifiedMethods: string[] = []) {
  try {
    await getSigningPayloadForToken(token, {
      database,
      verifiedMethods: verifiedMethods as never,
    });
    return [];
  } catch (error) {
    assert.ok(error instanceof SigningVerificationRequiredError);
    return error.details;
  }
}

test("Brazilian mobile numbers are normalized and masked", () => {
  assert.equal(normalizeBrazilMobile("+55 (82) 99605-7758"), "5582996057758");
  assert.equal(normalizeBrazilMobile("82996057758"), "5582996057758");
  assert.equal(normalizeBrazilMobile("(82) 3333-4444"), null);
  assert.equal(normalizeBrazilMobile("123"), null);
  assert.equal(maskPhone("5582996057758"), "(82) •••••-7758");
});

test("the API needs a mobile number, and this site able to send by WhatsApp", async () => {
  assert.throws(() =>
    createApiDocumentSchema.parse({
      permittedUseConfirmed: true,
      signer: { name: "Tutora", requireWhatsappCode: true },
      title: "x",
    }),
  );
  assert.throws(() =>
    createApiDocumentSchema.parse({
      permittedUseConfirmed: true,
      signer: { name: "Tutora", phone: "(82) 3333-4444" },
      title: "x",
    }),
  );

  configureEvolution(false);
  await assert.rejects(
    send({ phone: "82996057758", requireWhatsappCode: true }),
    ApiDocumentError,
  );
});

test("the document opens only with the code sent by WhatsApp", async () => {
  configureEvolution(true);
  const token = await send({
    phone: "+55 82 99605-7758",
    requireWhatsappCode: true,
  });
  const details = await pending(token);

  assert.ok(!Array.isArray(details));
  assert.deepEqual(details.pending, ["whatsapp_code"]);
  assert.equal(details.maskedPhone, "(82) •••••-7758");

  const delivered = await sendSignerWhatsappCode(token, {
    database,
    sendWhatsapp: fakeSender,
  });
  const message = sent.at(-1);

  assert.equal(delivered.maskedPhone, "(82) •••••-7758");
  assert.equal(message?.to, "5582996057758");

  const code = message?.text.match(/\b(\d{6})\b/)?.[1];

  assert.ok(code, message?.text);

  // Asking again at once does not send another code.
  await sendSignerWhatsappCode(token, { database, sendWhatsapp: fakeSender });
  assert.equal(sent.at(-1), message);

  const wrong = code === "000000" ? "111111" : "000000";

  await assert.rejects(
    verifySignerCheck(
      token,
      { code: wrong, method: "whatsapp_code" },
      { database, requestMeta: context },
    ),
    SigningMutationError,
  );

  const passed = await verifySignerCheck(
    token,
    { code, method: "whatsapp_code" },
    { database, requestMeta: context },
  );

  assert.deepEqual(passed, ["whatsapp_code"]);
  assert.deepEqual(await pending(token, passed), []);

  // Used once.
  await assert.rejects(
    verifySignerCheck(
      token,
      { code, method: "whatsapp_code" },
      { database, requestMeta: context },
    ),
    /expired/,
  );
});

test("a send that fails can be tried again at once", async () => {
  configureEvolution(true);
  const token = await send({ phone: "82996057758", requireWhatsappCode: true });

  await assert.rejects(
    sendSignerWhatsappCode(token, {
      database,
      sendWhatsapp: async () => {
        throw new Error("down");
      },
    }),
    SigningMutationError,
  );

  const before = sent.length;

  await sendSignerWhatsappCode(token, { database, sendWhatsapp: fakeSender });
  assert.equal(sent.length, before + 1);
});

test("with a CPF too, name and CPF come first, then the WhatsApp code", async () => {
  configureEvolution(true);
  const token = await send({
    cpf: "529.982.247-25",
    phone: "82996057758",
    requireWhatsappCode: true,
  });
  const details = await pending(token);

  assert.ok(!Array.isArray(details));
  assert.deepEqual(details.pending, ["identity", "whatsapp_code"]);
});

test("a phone without requireWhatsappCode asks for nothing", async () => {
  configureEvolution(false);
  const token = await send({ phone: "82996057758" });

  assert.deepEqual(await pending(token), []);
});
