import { type DbExecutor, getDb, queryOne } from "../db/connection.ts";
import { hashOpaqueToken } from "../services/opaque-tokens.ts";
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
 */

export const DOWNLOAD_WINDOW_SECONDS = 30 * 24 * 60 * 60;

export type SignerCompletion = {
  /** Signers, other than this one, who still have to sign. */
  awaitingCount: number;
  completedAt: number | null;
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
