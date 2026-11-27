import { createHmac, timingSafeEqual } from "node:crypto";

import { isProduction, resolveAuthSecret } from "../utils/env.ts";

/**
 * PetskySign: the CPF a signer types to confirm who they are (see the
 * "identity" check in signer-checks.ts). Only a keyed hash and a masked hint
 * are stored: an 11-digit number is too small a space for a plain hash.
 */

const HASH_CONTEXT = "petskysign/signer-cpf/v1";

/** Wrong tries before the identity check stops accepting answers. */
export const IDENTITY_MAX_ATTEMPTS = 5;

/** The 11 digits, or null when it is not a valid CPF (check digits too). */
export function normalizeCpf(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const digits = input.replace(/\D/g, "");

  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) {
    return null;
  }

  const checkDigit = (length: number) => {
    let sum = 0;

    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }

    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return checkDigit(9) === Number(digits[9]) &&
    checkDigit(10) === Number(digits[10])
    ? digits
    : null;
}

/**
 * Keyed with CPF_HASH_PEPPER, a key used for nothing else: a leaked auth
 * secret (which signs sessions and the verification cookie) does not also let
 * anyone try every CPF against a leaked database. Without it, the auth secret,
 * as before. CPFs hashed with the auth secret still match after the pepper is
 * set (`legacyHashKey`), so documents already sent keep working.
 */
function authSecretKey(): string {
  const secret = resolveAuthSecret();

  if (secret) {
    return secret;
  }

  if (isProduction(process.env)) {
    throw new Error(
      "The identity check needs an auth secret: set BETTER_AUTH_SECRET.",
    );
  }

  return "petskysign-development-only";
}

function pepper(): string | null {
  return process.env.CPF_HASH_PEPPER?.trim() || null;
}

function hmacCpf(key: string, cpf: string): string {
  return createHmac("sha256", key)
    .update(`${HASH_CONTEXT}:${cpf}`)
    .digest("hex");
}

export function hashCpf(cpf: string): string {
  return hmacCpf(pepper() ?? authSecretKey(), cpf);
}

function sameHex(a: string, b: string): boolean {
  const given = Buffer.from(a, "hex");
  const stored = Buffer.from(b, "hex");

  return given.length === stored.length && timingSafeEqual(given, stored);
}

export function cpfMatches(cpf: string, storedHash: string): boolean {
  if (sameHex(hashCpf(cpf), storedHash)) {
    return true;
  }

  // Sent before CPF_HASH_PEPPER was set: hashed with the auth secret.
  return (
    pepper() !== null && sameHex(hmacCpf(authSecretKey(), cpf), storedHash)
  );
}

/** "078.***.***-89": enough to tell CPFs apart in the audit trail. */
export function maskCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`;
}

/** A full name has at least two words of two or more letters. */
export function isFullName(input: string): boolean {
  return (
    input
      .trim()
      .split(/\s+/)
      .filter((word) => word.replace(/[^\p{L}]/gu, "").length >= 2).length >= 2
  );
}
