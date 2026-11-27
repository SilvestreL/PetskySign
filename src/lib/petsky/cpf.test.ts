import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cpfMatches,
  hashCpf,
  isFullName,
  maskCpf,
  normalizeCpf,
} from "./cpf.ts";

// A valid CPF made for tests (check digits computed, not a real person's).
const CPF = "52998224725";

test("a CPF is normalized to its 11 digits and its check digits are checked", () => {
  assert.equal(normalizeCpf("529.982.247-25"), CPF);
  assert.equal(normalizeCpf(" 52998224725 "), CPF);
  assert.equal(normalizeCpf("529.982.247-24"), null);
  assert.equal(normalizeCpf("111.111.111-11"), null);
  assert.equal(normalizeCpf("1234567890"), null);
  assert.equal(normalizeCpf(undefined), null);
});

test("the hash matches only the same CPF, and the hint hides the middle", () => {
  const stored = hashCpf(CPF);

  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.equal(cpfMatches(CPF, stored), true);
  assert.equal(cpfMatches("11144477735", stored), false);
  assert.equal(maskCpf(CPF), "529.***.***-25");
});

test("a full name has a first and a last name", () => {
  assert.equal(isFullName("Isabela Moreira"), true);
  assert.equal(isFullName("  Ana   da   Silva "), true);
  assert.equal(isFullName("Isabela"), false);
  assert.equal(isFullName("A B"), false);
});

test("with CPF_HASH_PEPPER, new hashes use it and old ones still match", () => {
  const legacy = hashCpf(CPF);

  process.env.CPF_HASH_PEPPER = "pepper-for-tests";
  try {
    const peppered = hashCpf(CPF);

    assert.notEqual(peppered, legacy);
    assert.equal(cpfMatches(CPF, peppered), true);
    assert.equal(cpfMatches(CPF, legacy), true);
    assert.equal(cpfMatches("11144477735", legacy), false);
  } finally {
    delete process.env.CPF_HASH_PEPPER;
  }
});
