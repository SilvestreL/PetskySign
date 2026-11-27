import { type DbExecutor, getDb, queryOne } from "../db/connection.ts";
import { hashOpaqueToken } from "../services/opaque-tokens.ts";
import { cpfMatches, IDENTITY_MAX_ATTEMPTS, normalizeCpf } from "./cpf.ts";
import { displayTimeZone, intlLocale } from "./locale.ts";

/**
 * PetskySign: what the page a signer lands on after signing can show them,
 * found from the signing link they used. Signing clears the link's hash from
 * signing_token_hash, so it cannot sign again, and keeps it in
 * signed_link_token_hash for this page only.
 *
 * Once everyone has signed, that page offers the signed PDF and its
 * certificate, so a signer reached only by a link (no email address, see
 * placeholder-email.ts) still gets their copy. The link is in their chat
 * history for good, so the downloads stop DOWNLOAD_WINDOW_SECONDS after the
 * document was finished; after that the business sends the copy.
 *
 * When the sender asked for the CPF, the copy asks for it again
 * (`unlockSignerCopy`), unless this browser passed the CPF check for this
 * link within the verification cookie's lifetime (the signer who just
 * signed). A forwarded link alone gets no file.
 */

export const DOWNLOAD_WINDOW_SECONDS = 30 * 24 * 60 * 60;

export type SignerCompletion = {
  /** Signers, other than this one, who still have to sign. */
  awaitingCount: number;
  completedAt: number | null;
  /** The sender asked for the CPF: downloading needs it again. */
  identityRequired: boolean;
  /** Whether the signed PDF and certificate can be downloaded from here. */
  downloadAvailable: boolean;
  /** When the downloads stop, if they are available. */
  downloadUntil: number | null;
  envelopeId: string;
  envelopeStatus: string;
  signedAt: number | null;
  signedPdfSha256: string | null;
  signerId: string;
  signerName: string;
  signerStatus: string;
  title: string;
};

type CompletionRow = {
  awaitingCount: string | number;
  completedAt: string | number | null;
  envelopeId: string;
  envelopeStatus: string;
  identityRequired: boolean;
  signedAt: string | number | null;
  signedPdfSha256: string | null;
  signerId: string;
  signerName: string;
  signerStatus: string;
  title: string;
};

function toNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

export async function getSignerCompletionForToken(
  token: string,
  {
    database = getDb(),
    now = Math.floor(Date.now() / 1000),
  }: { database?: DbExecutor; now?: number } = {},
): Promise<SignerCompletion | null> {
  if (!token || token.length > 512) {
    return null;
  }

  const row = await queryOne<CompletionRow>(
    database,
    `
      SELECT
        s.id AS "signerId",
        s.name AS "signerName",
        s.status AS "signerStatus",
        s.signed_at AS "signedAt",
        (s.identity_cpf_hash IS NOT NULL) AS "identityRequired",
        e.id AS "envelopeId",
        e.title,
        e.status AS "envelopeStatus",
        e.completed_at AS "completedAt",
        e.signed_pdf_sha256 AS "signedPdfSha256",
        (
          SELECT count(*)
          FROM signers other
          WHERE other.envelope_id = e.id
            AND other.id <> s.id
            AND other.status <> 'signed'
        ) AS "awaitingCount"
      FROM signers s
      JOIN envelopes e ON e.id = s.envelope_id
      WHERE s.signing_token_hash = $1 OR s.signed_link_token_hash = $1
      LIMIT 1
    `,
    [hashOpaqueToken(token)],
  );

  if (!row) {
    return null;
  }

  const completedAt = toNumber(row.completedAt);
  const downloadUntil =
    completedAt === null ? null : completedAt + DOWNLOAD_WINDOW_SECONDS;
  const downloadAvailable =
    row.envelopeStatus === "completed" &&
    row.signerStatus === "signed" &&
    downloadUntil !== null &&
    now < downloadUntil;

  return {
    awaitingCount: Number(row.awaitingCount),
    completedAt,
    downloadAvailable,
    downloadUntil: downloadAvailable ? downloadUntil : null,
    envelopeId: row.envelopeId,
    envelopeStatus: row.envelopeStatus,
    identityRequired: Boolean(row.identityRequired),
    signedAt: toNumber(row.signedAt),
    signedPdfSha256: row.signedPdfSha256,
    signerId: row.signerId,
    signerName: row.signerName,
    signerStatus: row.signerStatus,
    title: row.title,
  };
}

/** "23 de novembro de 2026, 13:27", in the app's language and time zone. */
export function formatCompletionDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "long",
    timeZone: displayTimeZone(),
    year: "numeric",
  }).format(new Date(unixSeconds * 1000));
}

export class CopyUnlockError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly params: Record<string, number> = {},
  ) {
    super(message);
  }
}

/**
 * The CPF again, to download the copy. Same keyed hash as before signing, its
 * own count of tries, counted in the same statement that reads the hash.
 */
export async function unlockSignerCopy(
  token: string,
  input: unknown,
  { database = getDb() }: { database?: DbExecutor } = {},
): Promise<void> {
  const cpf = normalizeCpf(
    typeof input === "object" && input !== null
      ? (input as { cpf?: unknown }).cpf
      : null,
  );

  if (!cpf) {
    throw new CopyUnlockError("That CPF is not valid.", 400);
  }

  const row = await queryOne<{ attempts: number; hash: string; id: string }>(
    database,
    `
      UPDATE signers
      SET copy_unlock_attempts = copy_unlock_attempts + 1
      WHERE signed_link_token_hash = $1
        AND status = 'signed'
        AND identity_cpf_hash IS NOT NULL
        AND copy_unlock_attempts < $2
      RETURNING id, identity_cpf_hash AS hash, copy_unlock_attempts AS attempts
    `,
    [hashOpaqueToken(token), IDENTITY_MAX_ATTEMPTS],
  );

  if (!row) {
    throw new CopyUnlockError(
      "Too many wrong tries. Ask the business that sent the document for a copy.",
      429,
    );
  }

  if (cpfMatches(cpf, row.hash)) {
    // Whoever types the right CPF owns it: the count is for guesses.
    await database.query(
      `UPDATE signers SET copy_unlock_attempts = 0 WHERE id = $1`,
      [row.id],
    );
    return;
  }

  const left = IDENTITY_MAX_ATTEMPTS - row.attempts;

  throw new CopyUnlockError(
    left === 0
      ? "Too many wrong tries. Ask the business that sent the document for a copy."
      : left === 1
        ? "That CPF does not match the one the sender has. 1 try is left."
        : "That CPF does not match the one the sender has. {count} tries are left.",
    left === 0 ? 429 : 400,
    { count: left },
  );
}
