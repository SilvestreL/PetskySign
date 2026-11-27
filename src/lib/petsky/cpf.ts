import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

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

/**
 * The full CPF, encrypted (AES-256-GCM), so the signed contract's certificate
 * can show it as D4Sign's does: many contracts name the tutor only "by the
 * name and CPF on the signatures page". The key comes from the same secret
 * as the hash, so a leaked database alone shows no CPF.
 */
function encryptionKey(): Buffer {
  return createHash("sha256")
    .update(
      `petskysign/signer-cpf-encryption/v1:${pepper() ?? authSecretKey()}`,
    )
    .digest();
}

export function encryptCpf(cpf: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(cpf, "utf8"), cipher.final()]);

  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

/** null when it cannot be read (another key, or tampered with). */
export function decryptCpf(value: string | null | undefined): string | null {
  const [version, iv, tag, data] = (value ?? "").split(".");

  if (version !== "v1" || !iv || !tag || !data) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64url"),
    );

    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** "078.394.104-89" */
export function formatCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
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
