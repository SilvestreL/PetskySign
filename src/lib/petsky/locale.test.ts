import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { appLocale, intlLocale, tr } from "./locale.ts";
import { PT_BR } from "./pt-br.ts";
import { PT_BR_ADMIN } from "./pt-br-admin.ts";
import { PT_BR_ENVELOPES } from "./pt-br-envelopes.ts";
import { PT_BR_MISC } from "./pt-br-misc.ts";
import { PT_BR_SETTINGS } from "./pt-br-settings.ts";

const original = process.env.NEXT_PUBLIC_APP_LOCALE;

afterEach(() => {
  if (original === undefined) {
    delete process.env.NEXT_PUBLIC_APP_LOCALE;
  } else {
    process.env.NEXT_PUBLIC_APP_LOCALE = original;
  }
});

test("English by default: text comes back as written, placeholders filled", () => {
  delete process.env.NEXT_PUBLIC_APP_LOCALE;

  assert.equal(appLocale(), "en");
  assert.equal(intlLocale(), "en-US");
  assert.equal(tr("Finish signing"), "Finish signing");
  assert.equal(
    tr("Page {page} of {count}", { count: 3, page: 1 }),
    "Page 1 of 3",
  );
});

test("pt-BR translates, fills placeholders, and leaves unknown text in English", () => {
  process.env.NEXT_PUBLIC_APP_LOCALE = "pt-BR";

  assert.equal(appLocale(), "pt-BR");
  assert.equal(intlLocale(), "pt-BR");
  assert.equal(tr("Finish signing"), "Concluir assinatura");
  assert.equal(
    tr("Page {page} of {count}", { count: 3, page: 1 }),
    "Página 1 de 3",
  );
  assert.equal(tr("Text nobody translated yet"), "Text nobody translated yet");
  // A placeholder with no value is left visible rather than dropped.
  assert.equal(tr("Page {page}"), "Página {page}");
});

test("every translation uses exactly the placeholders of its English key", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

  for (const [english, portuguese] of Object.entries({
    ...PT_BR,
    ...PT_BR_ADMIN,
    ...PT_BR_ENVELOPES,
    ...PT_BR_SETTINGS,
    ...PT_BR_MISC,
  })) {
    assert.deepEqual(
      placeholders(portuguese),
      placeholders(english),
      `placeholders differ for: ${english}`,
    );
    assert.ok(portuguese.trim().length > 0, `empty translation: ${english}`);
  }
});
