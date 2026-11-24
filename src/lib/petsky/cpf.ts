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
 * Keyed with the auth secret. Changing BETTER_AUTH_SECRET leaves the CPFs of
 * documents still waiting for a signature unmatchable: send them again.
 */
function hashKey(): string {
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

export function hashCpf(cpf: string): string {
  return createHmac("sha256", hashKey())
    .update(`${HASH_CONTEXT}:${cpf}`)
    .digest("hex");
}

export function cpfMatches(cpf: string, storedHash: string): boolean {
  const given = Buffer.from(hashCpf(cpf), "hex");
  const stored = Buffer.from(storedHash, "hex");

  return given.length === stored.length && timingSafeEqual(given, stored);
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
