import { randomUUID } from "node:crypto";

import { PDFDocument, type PDFImage, type PDFPage, rgb } from "pdf-lib";

import {
  auditEventRecordSchema,
  type AuditEventRecord,
  type EnvelopeRecord,
} from "../schemas/envelope.ts";
import type { FieldRecord } from "../schemas/field.ts";
import type { SignerRecord } from "../schemas/signer.ts";
import { buildSignatureManifestation } from "../signature-meanings.ts";
import { describeSignerCorrectedEvent } from "./audit.ts";
import { canonicalJson } from "../utils/canonical-json.ts";
import { normalizedRectToPdfRect } from "../utils/pdf-coords.ts";
import { embedTextFaces, type TextFace } from "./pdf-fonts.ts";
import { sha256Hex } from "./pdf-seal.ts";
import { getBranding } from "../settings.ts";
import {
  finishSignerSignedPdf,
  getSealIdentity,
  saveInstallSealedPdf,
  type SealPurpose,
} from "./seal-identity.ts";
import {
  buildEnvelopeCertificateKey,
  buildEnvelopeSignedPdfKey,
} from "./storage-keys.ts";
import {
  createStorageService,
  type StorageObjectRef,
  type StorageService,
} from "./storage.ts";
import { appLocale, displayTimeZone, tr } from "../petsky/locale.ts";
import { resolveAppUrl } from "../utils/env.ts";
import { encode as encodeQr } from "uqr";
import { isPlaceholderEmail } from "../petsky/placeholder-email.ts";
import { getDb } from "../db/connection.ts";
import { getDocumentBranding } from "../petsky/document-branding.ts";

const DEFAULT_AUDIT_PAGE_SIZE = {
  height: 792,
  width: 612,
} as const;

export type StoredSealedPdf = StorageObjectRef & {
  body: Uint8Array;
  sha256: string;
};

export type FinalizedEnvelopeArtifacts = {
  certificate: StoredSealedPdf;
  generatedAt: number;
  recipientCertificate: StoredSealedPdf;
  signedPdf: StoredSealedPdf;
};

/** Saves a finished PDF. The default seals it with the install's key. */
export type PdfSealer = (
  pdfDocument: PDFDocument,
  purpose: SealPurpose,
) => Promise<Uint8Array>;

const defaultSealer: PdfSealer = (pdfDocument, purpose) =>
  saveInstallSealedPdf(pdfDocument, purpose);

/**
 * The install's sealer, with what it reads from the database (the seal key
 * and the install's name) read now. Sealing with it then needs no database
 * connection, so a caller can seal while it holds one in a transaction
 * without waiting on a pool that its own concurrent requests have filled.
 */
export async function loadInstallSealer(): Promise<PdfSealer> {
  const identity = await getSealIdentity();
  const branding = await getBranding();

  return (pdfDocument, purpose) =>
    saveInstallSealedPdf(pdfDocument, purpose, { branding, identity });
}

const CERTIFICATE_FINGERPRINT_VERSION = 1;

/**
 * A SHA-256 over every audit event the certificate is built from, in order,
 * unredacted. Printed on both certificates, so the record held by the sender
 * can later be shown to be the one the certificate was made from.
 */
export function computeAuditFingerprint(
  auditEvents: readonly AuditEventRecord[],
): string {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson({
        // One fixed order (time, then id by code unit), whatever order the
        // list was built or read back in.
        events: [...auditEvents]
          .sort(
            (left, right) =>
              (left.createdAt ?? 0) - (right.createdAt ?? 0) ||
              (String(left.id) < String(right.id)
                ? -1
                : String(left.id) > String(right.id)
                  ? 1
                  : 0),
          )
          .map((event) => [
            event.id,
            event.createdAt,
            event.event,
            event.actorType,
            event.actorEmail ?? null,
            event.ipAddress ?? null,
            event.userAgent ?? null,
            event.metadata ?? null,
          ]),
        version: CERTIFICATE_FINGERPRINT_VERSION,
      }),
    ),
  );
}

export class PdfFinalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfFinalizeError";
  }
}

function redactAuditEventMetadataForRecipients(
  metadata: AuditEventRecord["metadata"],
): AuditEventRecord["metadata"] {
  if (!metadata) {
    return null;
  }

  const nextMetadata = { ...metadata };

  delete nextMetadata.signerEmail;
  // Who an email went to is another party's address.
  delete nextMetadata.recipient;
  // A correction's previous address is the same kind of third-party email.
  delete nextMetadata.previousEmail;

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

function redactAuditEventForRecipients(
  event: AuditEventRecord,
): AuditEventRecord {
  return auditEventRecordSchema.parse({
    ...event,
    actorEmail:
      event.actorType === "signer" ? null : (event.actorEmail ?? null),
    ipAddress: null,
    metadata: redactAuditEventMetadataForRecipients(event.metadata ?? null),
    userAgent: null,
  });
}

/**
 * Who did what an audit row records. An event's `signerName` and
 * `signerEmail` metadata name the signer it concerns, which is the actor
 * only on the signer's own events: a send or a reminder names the signer it
 * went to while the sender (or the system) did it, so the signer's name must
 * never be put in front of the sender's address (issue #52).
 */
export function describeAuditActor(
  event: AuditEventRecord,
  // PetskySign: the business that sent the document, shown for the sender's
  // own events in its certificate instead of the API account's address.
  options: { senderName?: string | null } = {},
): string {
  if (event.actorType !== "signer") {
    if (event.actorType === "sender" && options.senderName) {
      return options.senderName;
    }

    return event.actorEmail ?? tr(event.actorType);
  }

  // PetskySign: in the signers' copy addresses are taken out; the name says
  // who it was without a "<signer>" where the address was.
  if (
    !event.actorEmail &&
    typeof event.metadata?.signerEmail !== "string" &&
    typeof event.metadata?.signerName === "string"
  ) {
    return event.metadata.signerName;
  }

  const actor =
    event.actorEmail ??
    (typeof event.metadata?.signerEmail === "string"
      ? event.metadata.signerEmail
      : tr(event.actorType));
  const signerName =
    typeof event.metadata?.signerName === "string"
      ? event.metadata.signerName
      : null;

  // PetskySign: a link-only signer has no address to show.
  if (isPlaceholderEmail(actor)) {
    return signerName ?? "signer";
  }

  return signerName && actor !== signerName
    ? `${signerName} <${actor}>`
    : actor;
}

type WrappedLine = {
  font: TextFace;
  size: number;
  text: string;
};

/**
 * PetskySign: how a certificate line is drawn (see appendAuditTrailPages),
 * in the layout of D4Sign's certificate: sections with a rule above, a
 * check mark before each signer, bold event times, quieter details.
 */
type CertificateLine = WrappedLine & {
  color?: [number, number, number];
  gapAfter?: number;
  gapBefore?: number;
  icon?: "check" | "cross" | "dot";
  indent?: number;
  /** A thin rule above the line: a new section starts here. */
  rule?: boolean;
  /** Narrower, to leave room for the QR code on the first page. */
  besideQr?: boolean;
  /** Narrower, to leave room for the signer's signature on the right. */
  besideSignature?: boolean;
  /** The signer whose signature is drawn on the right of this line. */
  signatureOf?: string;
};

/** PetskySign: a signer's signature, as they made it, for the certificate. */
type CertificateSignature = { image: PDFImage } | { text: string };

const CERT_SIGNATURE_WIDTH = 150;
const CERT_SIGNATURE_HEIGHT = 30;

const CERT_INK: [number, number, number] = [0.094, 0.165, 0.227];
const CERT_MUTED: [number, number, number] = [0.36, 0.42, 0.5];
const CERT_ACCENT: [number, number, number] = [0.176, 0.435, 0.82];
const CERT_SUCCESS: [number, number, number] = [0.086, 0.44, 0.29];
const CERT_DANGER: [number, number, number] = [0.71, 0.14, 0.09];
const CERT_QR_SIZE = 76;

function formatAuditTimestamp(timestamp: number | null | undefined): string {
  if (typeof timestamp !== "number") {
    return "—";
  }

  const value = new Date(timestamp * 1000);

  // PetskySign: Brasília time in pt-BR, as D4Sign's certificate; the page
  // header says so. ISO in UTC otherwise, as before.
  if (appLocale() === "pt-BR") {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      second: "2-digit",
      timeZone: displayTimeZone(),
      year: "numeric",
    })
      .format(value)
      .replace(" de ", " ")
      .replace(" de ", " ")
      .replace(".", "");
  }

  return value.toISOString().replace(".000Z", " UTC");
}

function chunkLongWord(
  font: TextFace,
  size: number,
  maxWidth: number,
  word: string,
): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) {
    return [word];
  }

  const chunks: string[] = [];
  let buffer = "";

  for (const character of word) {
    const candidate = `${buffer}${character}`;

    if (buffer && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      chunks.push(buffer);
      buffer = character;
      continue;
    }

    buffer = candidate;
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

function wrapText(
  font: TextFace,
  size: number,
  maxWidth: number,
  text: string,
): WrappedLine[] {
  const normalized = text.trim();

  if (!normalized) {
    return [];
  }

  const rawWords = normalized
    .split(/\s+/)
    .flatMap((word) => chunkLongWord(font, size, maxWidth, word));
  const lines: string[] = [];
  let currentLine = "";

  for (const word of rawWords) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.map((line) => ({
    font,
    size,
    text: line,
  }));
}

function fitTextSize(
  font: TextFace,
  text: string,
  maxWidth: number,
  maxHeight: number,
  preferredSize: number,
): number {
  let size = Math.min(preferredSize, maxHeight);

  while (size > 4 && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }

  return Math.max(4, size);
}

function getFieldPadding(widthPt: number, heightPt: number): number {
  return Math.max(2, Math.min(widthPt, heightPt) * 0.12);
}

export function shouldStampField(field: FieldRecord): boolean {
  if (field.type === "checkbox" || field.type === "radio") {
    return typeof field.checked === "boolean";
  }

  return typeof field.submittedAt === "number";
}

function buildCompletedAuditEvent(
  envelopeId: string,
  generatedAt: number,
): AuditEventRecord {
  return {
    actorEmail: null,
    actorType: "system",
    createdAt: generatedAt,
    envelopeId,
    event: "completed",
    id: randomUUID(),
    ipAddress: null,
    metadata: null,
    userAgent: null,
  };
}

async function getEmbeddedPng(
  imageKey: string,
  imageCache: Map<string, PDFImage>,
  pdfDocument: PDFDocument,
  storageService: StorageService,
): Promise<PDFImage> {
  const cachedImage = imageCache.get(imageKey);

  if (cachedImage) {
    return cachedImage;
  }

  const imageObject = await storageService.getObject(imageKey);
  const embeddedImage = await pdfDocument.embedPng(imageObject.body);

  imageCache.set(imageKey, embeddedImage);

  return embeddedImage;
}

function stripCompletedAuditEvents(
  auditEvents: readonly AuditEventRecord[],
): AuditEventRecord[] {
  return auditEvents.filter((event) => event.event !== "completed");
}

/** PetskySign: an audit event's name in the app's language. */
function auditEventLabel(event: string): string {
  const key = `audit event: ${event}`;
  const label = tr(key);

  return label === key ? event : label;
}

function getEnvelopeStatusLabel(status: EnvelopeRecord["status"]): string {
  switch (status) {
    case "completed":
      return tr("Completed");
    case "declined":
      return tr("Declined");
    case "voided":
      return tr("Voided");
    case "sent":
      return tr("Sent");
    case "draft":
      return tr("Draft");
    default:
      return status;
  }
}

function getCertificateTitle(envelope: EnvelopeRecord): string {
  return envelope.status === "completed"
    ? tr("SignuDoc Certificate of Completion")
    : tr("SignuDoc Audit Certificate");
}

function getTerminalTimestampLabel(envelope: EnvelopeRecord): string {
  switch (envelope.status) {
    case "completed":
      return tr("Completed at");
    case "declined":
      return tr("Declined at");
    case "voided":
      return tr("Voided at");
    default:
      return tr("Recorded at");
  }
}

function resolveTerminalTimestamp(
  envelope: EnvelopeRecord,
  fallbackTimestamp: number,
): number {
  switch (envelope.status) {
    case "completed":
      return envelope.completedAt ?? fallbackTimestamp;
    case "declined":
      return envelope.declinedAt ?? fallbackTimestamp;
    case "voided":
      return envelope.voidedAt ?? fallbackTimestamp;
    default:
      return fallbackTimestamp;
  }
}

function buildCertificateAuditEvents(input: {
  auditEvents: AuditEventRecord[];
  envelope: EnvelopeRecord;
  terminalTimestamp: number;
}): AuditEventRecord[] {
  const baseAuditEvents =
    input.envelope.status === "completed"
      ? stripCompletedAuditEvents(input.auditEvents)
      : input.auditEvents;
  const terminalAuditEvents =
    input.envelope.status === "completed"
      ? [buildCompletedAuditEvent(input.envelope.id, input.terminalTimestamp)]
      : [];

  return [...baseAuditEvents, ...terminalAuditEvents].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

export async function stampFieldValue(
  field: FieldRecord,
  page: PDFPage,
  fonts: {
    auditRegular: TextFace;
    signature: TextFace;
  },
  imageCache: Map<string, PDFImage>,
  pdfDocument: PDFDocument,
  storageService: StorageService,
): Promise<void> {
  if (!shouldStampField(field)) {
    return;
  }

  const rect = normalizedRectToPdfRect(field, {
    heightPt: page.getHeight(),
    widthPt: page.getWidth(),
  });
  const padding = getFieldPadding(rect.widthPt, rect.heightPt);

  switch (field.type) {
    case "signature":
    case "initials": {
      if (field.inputMethod === "drawn" && field.imageKey) {
        const image = await getEmbeddedPng(
          field.imageKey,
          imageCache,
          pdfDocument,
          storageService,
        );
        const maxWidth = Math.max(4, rect.widthPt - padding * 2);
        const maxHeight = Math.max(4, rect.heightPt - padding * 2);
        const scaled = image.scaleToFit(maxWidth, maxHeight);
        const x = rect.xPt + (rect.widthPt - scaled.width) / 2;
        const y = rect.yPt + (rect.heightPt - scaled.height) / 2;

        page.drawImage(image, {
          height: scaled.height,
          width: scaled.width,
          x,
          y,
        });

        return;
      }

      const signatureValue = field.value?.trim();

      if (!signatureValue) {
        return;
      }

      const maxWidth = Math.max(12, rect.widthPt - padding * 2);
      const maxHeight = Math.max(10, rect.heightPt - padding * 2);
      const fontSize = fitTextSize(
        fonts.signature,
        signatureValue,
        maxWidth,
        maxHeight,
        Math.min(maxHeight, rect.heightPt * 0.9),
      );

      fonts.signature.drawText(page, signatureValue, {
        color: rgb(0.12, 0.12, 0.12),
        size: fontSize,
        x: rect.xPt + padding,
        y: rect.yPt + (rect.heightPt - fontSize) / 2 + fontSize * 0.1,
      });

      return;
    }
    case "date":
    case "name":
    case "text":
    case "number":
    case "dropdown": {
      const textValue = field.value?.trim();

      if (!textValue) {
        return;
      }

      const maxWidth = Math.max(12, rect.widthPt - padding * 2);
      const maxHeight = Math.max(10, rect.heightPt - padding * 2);
      const fontSize = fitTextSize(
        fonts.auditRegular,
        textValue,
        maxWidth,
        maxHeight,
        Math.min(maxHeight, rect.heightPt * 0.64),
      );

      fonts.auditRegular.drawText(page, textValue, {
        color: rgb(0.12, 0.12, 0.12),
        size: fontSize,
        x: rect.xPt + padding,
        y: rect.yPt + (rect.heightPt - fontSize) / 2 + fontSize * 0.2,
      });

      return;
    }
    case "checkbox": {
      const boxSize = Math.min(rect.widthPt, rect.heightPt, 14);
      const x = rect.xPt + padding / 2;
      const y = rect.yPt + (rect.heightPt - boxSize) / 2;

      page.drawRectangle({
        borderColor: rgb(0.18, 0.18, 0.18),
        borderWidth: 1.1,
        height: boxSize,
        width: boxSize,
        x,
        y,
      });

      if (field.checked) {
        page.drawLine({
          color: rgb(0.08, 0.08, 0.08),
          end: { x: x + boxSize * 0.42, y: y + boxSize * 0.2 },
          start: { x: x + boxSize * 0.16, y: y + boxSize * 0.5 },
          thickness: 1.4,
        });
        page.drawLine({
          color: rgb(0.08, 0.08, 0.08),
          end: { x: x + boxSize * 0.84, y: y + boxSize * 0.82 },
          start: { x: x + boxSize * 0.4, y: y + boxSize * 0.18 },
          thickness: 1.4,
        });
      }

      return;
    }
    case "radio": {
      // A ring for every button, and a dot in the one that was chosen.
      const diameter = Math.min(rect.widthPt, rect.heightPt, 14);
      const center = {
        x: rect.xPt + padding / 2 + diameter / 2,
        y: rect.yPt + rect.heightPt / 2,
      };

      page.drawCircle({
        borderColor: rgb(0.18, 0.18, 0.18),
        borderWidth: 1.1,
        size: diameter / 2,
        ...center,
      });

      if (field.checked) {
        page.drawCircle({
          color: rgb(0.08, 0.08, 0.08),
          size: diameter * 0.24,
          ...center,
        });
      }

      return;
    }
    default:
      return;
  }
}

/**
 * Prints a Part 11 signature's manifestation just under the signature, or
 * just above it when the field sits at the foot of the page.
 */
function stampSignatureManifestation(
  field: FieldRecord,
  page: PDFPage,
  font: TextFace,
  text: string,
): void {
  const pageWidth = page.getWidth();
  const rect = normalizedRectToPdfRect(field, {
    heightPt: page.getHeight(),
    widthPt: pageWidth,
  });
  const margin = 2;
  const fullWidth = pageWidth - margin * 2;
  const minimumSize = 5;
  // One line when it fits at a readable size, otherwise one line per part
  // (name, time, meaning), so nothing is shrunk away or runs off the page.
  const oneLineSize = fitTextSize(font, text, fullWidth, 7, 6.5);
  const lines =
    font.widthOfTextAtSize(text, oneLineSize) <= fullWidth &&
    oneLineSize >= minimumSize
      ? [text]
      : text.split(" | ");
  const size = Math.max(
    minimumSize,
    Math.min(
      ...lines.map((line) => fitTextSize(font, line, fullWidth, 7, 6.5)),
    ),
  );
  const lineHeight = size + 1.5;
  const blockHeight = lineHeight * lines.length;
  const below = rect.yPt - blockHeight;
  // The top line's baseline. Below the field when there is room, above it
  // at the foot of the page.
  const top =
    below >= margin
      ? rect.yPt - lineHeight
      : Math.min(
          rect.yPt + rect.heightPt + blockHeight - size,
          page.getHeight() - size - margin,
        );

  lines.forEach((line, index) => {
    const width = font.widthOfTextAtSize(line, size);
    // Starts under the field, moved left if it would run off the page.
    const x = Math.max(margin, Math.min(rect.xPt, pageWidth - width - margin));

    font.drawText(page, line, {
      color: rgb(0.2, 0.2, 0.24),
      size,
      x,
      y: top - index * lineHeight,
    });
  });
}

function buildAuditLines(input: {
  auditEvents: AuditEventRecord[];
  auditFingerprint?: string | null;
  completedAt: number;
  copyRecipients?: readonly CertificateCopyRecipient[];
  envelope: EnvelopeRecord;
  fonts: {
    bold: TextFace;
    regular: TextFace;
  };
  maxWidth: number;
  redactForRecipients?: boolean;
  /** PetskySign: shrinks text and spacing so the certificate fits a page. */
  scale?: number;
  senderName?: string | null;
  signedPdfSha256?: string | null;
  signers: SignerRecord[];
}) {
  const scale = input.scale ?? 1;
  const titleFontSize = 15 * scale;
  const sectionFontSize = 12 * scale;
  const nameFontSize = 10.5 * scale;
  const bodyFontSize = 9 * scale;
  const smallFontSize = 7.75 * scale;
  const lines: CertificateLine[] = [];

  const pushParagraph = (
    text: string,
    font: TextFace,
    size: number,
    options: Omit<CertificateLine, "font" | "size" | "text"> = {},
  ) => {
    const indent = options.indent ?? 0;
    const width =
      input.maxWidth -
      indent -
      (options.besideQr ? CERT_QR_SIZE + 16 : 0) -
      (options.besideSignature ? CERT_SIGNATURE_WIDTH + 12 : 0);
    const wrapped = wrapText(font, size, width, text);

    wrapped.forEach((line, index) => {
      const first = index === 0;
      const last = index === wrapped.length - 1;

      lines.push({
        ...line,
        besideQr: options.besideQr,
        besideSignature: options.besideSignature,
        signatureOf: first ? options.signatureOf : undefined,
        color: options.color,
        gapAfter:
          last && options.gapAfter ? options.gapAfter * scale : undefined,
        gapBefore:
          first && options.gapBefore ? options.gapBefore * scale : undefined,
        icon: first ? options.icon : undefined,
        indent,
        rule: first ? options.rule : undefined,
      });
    });
  };
  const section = (title: string) =>
    pushParagraph(title, input.fonts.bold, sectionFontSize, {
      color: CERT_INK,
      gapAfter: 6,
      gapBefore: 12,
      rule: true,
    });

  const terminalTimestamp = resolveTerminalTimestamp(
    input.envelope,
    input.completedAt,
  );
  const auditEvents = buildCertificateAuditEvents({
    auditEvents: input.auditEvents,
    envelope: input.envelope,
    terminalTimestamp,
  });

  // The document: its title, code and status, beside the QR code.
  pushParagraph(
    getCertificateTitle(input.envelope),
    input.fonts.bold,
    smallFontSize,
    { besideQr: true, color: CERT_ACCENT, gapAfter: 4 },
  );
  pushParagraph(input.envelope.title, input.fonts.bold, titleFontSize, {
    besideQr: true,
    color: CERT_INK,
    gapAfter: 4,
  });
  pushParagraph(
    tr("Envelope ID: {id}", { id: input.envelope.id }),
    input.fonts.regular,
    bodyFontSize,
    { besideQr: true, color: CERT_MUTED },
  );
  pushParagraph(
    tr("Document title: {title}", { title: input.envelope.title }),
    input.fonts.regular,
    bodyFontSize,
    { besideQr: true, color: CERT_MUTED },
  );
  pushParagraph(
    tr("Status: {status}", {
      status: getEnvelopeStatusLabel(input.envelope.status),
    }),
    input.fonts.regular,
    bodyFontSize,
    { besideQr: true, color: CERT_MUTED },
  );
  pushParagraph(
    `${getTerminalTimestampLabel(input.envelope)}: ${formatAuditTimestamp(terminalTimestamp)}`,
    input.fonts.regular,
    bodyFontSize,
    { besideQr: true, color: CERT_MUTED, gapAfter: 10 },
  );

  section(tr("Signers"));

  for (const signer of input.signers) {
    const actionLabel = getSignerCertificateActionLabel(input.envelope, signer);
    const showEmail =
      !input.redactForRecipients && !isPlaceholderEmail(signer.email);

    pushParagraph(
      `${signer.signOrder}. ${signer.name}`,
      input.fonts.bold,
      nameFontSize,
      {
        besideSignature: true,
        color: CERT_INK,
        gapBefore: 6,
        signatureOf: signer.id ?? undefined,
        icon:
          signer.status === "signed"
            ? "check"
            : signer.status === "declined"
              ? "cross"
              : "dot",
        indent: 20,
      },
    );
    pushParagraph(
      showEmail ? `<${signer.email}> | ${actionLabel}` : actionLabel,
      input.fonts.regular,
      bodyFontSize,
      { besideSignature: true, color: CERT_MUTED, indent: 20 },
    );

    for (const detail of describeSignerEvidence(
      signer,
      input.auditEvents,
      Boolean(input.redactForRecipients),
    )) {
      pushParagraph(detail, input.fonts.regular, smallFontSize + 0.5, {
        besideSignature: true,
        color: CERT_MUTED,
        indent: 20,
      });
    }
  }

  if (input.copyRecipients && input.copyRecipients.length > 0) {
    section(tr("Copy recipients"));
    pushParagraph(
      tr("Sent a copy of the finished document. They did not sign it."),
      input.fonts.regular,
      bodyFontSize,
      { color: CERT_MUTED, gapAfter: 4 },
    );

    for (const recipient of input.copyRecipients) {
      pushParagraph(
        input.redactForRecipients
          ? recipient.name
          : `${recipient.name} <${recipient.email}>`,
        input.fonts.regular,
        bodyFontSize,
        { color: CERT_INK, icon: "dot", indent: 20 },
      );
    }
  }

  section(tr("Audit events"));

  for (const event of auditEvents) {
    const actorLabel = describeAuditActor(event, {
      senderName: input.senderName,
    });
    const eventLabel =
      event.event === "signer_corrected"
        ? tr("Signer corrected")
        : auditEventLabel(event.event);

    pushParagraph(
      formatAuditTimestamp(event.createdAt),
      input.fonts.bold,
      bodyFontSize,
      { color: CERT_INK, gapBefore: 4 },
    );
    pushParagraph(
      appLocale() === "pt-BR"
        ? `${eventLabel.charAt(0).toUpperCase()}${eventLabel.slice(1)} ${tr("by")} ${actorLabel}`
        : `${eventLabel} | ${actorLabel}`,
      input.fonts.regular,
      bodyFontSize,
      { color: CERT_INK },
    );

    for (const detail of describeEventEvidence(event)) {
      pushParagraph(detail, input.fonts.regular, smallFontSize + 0.5, {
        color: CERT_MUTED,
        indent: 10,
      });
    }
  }

  section(tr("Document hashes"));
  pushParagraph(
    tr("Source PDF: {file}", { file: input.envelope.sourcePdfFilename }),
    input.fonts.regular,
    bodyFontSize,
    { color: CERT_MUTED },
  );
  pushParagraph(
    tr("Source document hash: {hash}", { hash: input.envelope.sourcePdfHash }),
    input.fonts.regular,
    smallFontSize,
    { color: CERT_INK },
  );

  if (input.signedPdfSha256) {
    pushParagraph(
      tr("Signed document SHA-256: {hash}", { hash: input.signedPdfSha256 }),
      input.fonts.regular,
      smallFontSize,
      { color: CERT_INK },
    );
  }

  if (input.auditFingerprint) {
    pushParagraph(
      tr("Audit trail fingerprint (SHA-256): {hash}", {
        hash: input.auditFingerprint,
      }),
      input.fonts.regular,
      smallFontSize,
      { color: CERT_INK },
    );
  }

  pushParagraph(
    tr("This record belongs only to the documents with the hashes above."),
    input.fonts.regular,
    smallFontSize,
    { color: CERT_MUTED, gapBefore: 4 },
  );

  pushParagraph(
    tr("How to check this record"),
    input.fonts.bold,
    bodyFontSize,
    {
      color: CERT_INK,
      gapBefore: 8,
    },
  );
  pushParagraph(
    tr(
      "The signed document and this certificate are each sealed with a digital signature. A PDF reader shows the seal as valid only if the file has not changed since it was sealed. The SHA-256 values above can also be checked on this site's Verify page.",
    ),
    input.fonts.regular,
    smallFontSize + 0.5,
    { color: CERT_MUTED, gapAfter: 6 },
  );
  pushParagraph(
    tr(
      "Electronic signatures have legal validity in Brazil under MP 2.200-2/2001 and Law 14.063/2020.",
    ),
    input.fonts.bold,
    bodyFontSize,
    { color: CERT_INK },
  );

  return lines;
}

const AUTHENTICATION_LABELS: Record<string, string> = {
  access_code: "access code from the sender",
  account: "own account, with email address and password to open it",
  email_code: "one-time code sent by email",
  // PetskySign: see the identity check in signer-checks.ts.
  identity: "full name and CPF matching the sender's records",
  whatsapp_code: "one-time code sent by WhatsApp",
};

function authenticationLabel(method: string): string {
  return Object.hasOwn(AUTHENTICATION_LABELS, method)
    ? tr(AUTHENTICATION_LABELS[method]!)
    : method;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * A signature the signer made with their own certificate through the
 * install's signing provider: its level, the provider, and the certificate.
 */
function describeProviderSignatureEvidence(
  signed: AuditEventRecord | undefined,
  redacted: boolean,
): string[] {
  const value = signed?.metadata?.providerSignature;

  if (!value || typeof value !== "object") {
    return [];
  }

  const signature = value as Record<string, unknown>;
  const level =
    signature.level === "qualified"
      ? "a qualified electronic signature"
      : signature.level === "advanced"
        ? "an advanced electronic signature"
        : null;

  if (!level) {
    return [];
  }

  const provider =
    typeof signature.provider === "string"
      ? ` through ${signature.provider}`
      : "";
  const method =
    typeof signature.method === "string" ? ` (${signature.method})` : "";
  const details = [
    `Signed with ${level}${provider}${method}; the signature is in the signed PDF`,
  ];

  if (!redacted && typeof signature.certificateSubject === "string") {
    const issuer =
      typeof signature.certificateIssuer === "string"
        ? `, issued by ${signature.certificateIssuer}`
        : "";
    const serial =
      typeof signature.certificateSerialNumber === "string"
        ? `, serial ${signature.certificateSerialNumber}`
        : "";
    const validTo =
      typeof signature.certificateValidTo === "number"
        ? `, valid to ${formatAuditTimestamp(signature.certificateValidTo)}`
        : "";

    details.push(
      `Signing certificate: ${signature.certificateSubject}${issuer}${serial}${validTo}`,
    );
  }

  if (signature.timestamped === true) {
    details.push(
      "The signature carries a timestamp from a time-stamping service",
    );
  }

  return details;
}

function isRevertedSignerCorrection(event: AuditEventRecord): boolean {
  return (
    event.event === "signer_corrected" && event.metadata?.reverted === true
  );
}

/**
 * Index at which this signer's current identity begins. A correction that
 * was later reversed restores the previous identity, so earlier consent
 * still counts.
 */
function currentSignerIdentityStart(
  events: readonly AuditEventRecord[],
): number {
  const starts = [0];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];

    if (event?.event !== "signer_corrected") {
      continue;
    }

    if (isRevertedSignerCorrection(event)) {
      if (starts.length > 1) {
        starts.pop();
      }
    } else {
      starts.push(index + 1);
    }
  }

  return starts[starts.length - 1] ?? 0;
}

/** What the record shows about how one signer was identified and agreed. */
function describeSignerEvidence(
  signer: SignerRecord,
  auditEvents: readonly AuditEventRecord[],
  redacted: boolean,
): string[] {
  const forSigner = auditEvents.filter(
    (event) => event.metadata?.signerId === signer.id,
  );
  const details: string[] = [];
  const signed = forSigner.find((event) => event.event === "signed");
  // A correction clears the row's consent. The first consented event for
  // this signer id can still be the previous person's, so only agreement
  // recorded after the latest standing correction counts as this
  // recipient's. A reversal restores the earlier identity, including that
  // earlier agreement.
  const identityStart = currentSignerIdentityStart(forSigner);
  let consented: AuditEventRecord | undefined;

  for (let index = forSigner.length - 1; index >= identityStart; index -= 1) {
    const event = forSigner[index];

    if (event?.event === "consented") {
      consented = event;
      break;
    }
  }

  const checks = [
    tr("possession of the emailed signing link"),
    ...readStringArray(signed?.metadata?.authMethods).map((method) =>
      authenticationLabel(method),
    ),
  ];

  const part11 =
    signed?.metadata?.part11 && typeof signed.metadata.part11 === "object"
      ? (signed.metadata.part11 as Record<string, unknown>)
      : null;

  if (part11) {
    checks.push("email address and password given again to sign");
  }

  if (signed || signer.status === "declined") {
    details.push(tr("Identified by: {checks}", { checks: checks.join(", ") }));
  }

  const manifestation = buildSignatureManifestation(signer);

  if (part11 && manifestation) {
    details.push(manifestation);

    if (typeof part11.meaningStatement === "string") {
      details.push(
        `Meaning confirmed by the signer: "${part11.meaningStatement}"`,
      );
    }
  }

  if (consented) {
    details.push(
      tr("Agreed to use electronic records and signatures at {time}", {
        time: formatAuditTimestamp(consented.createdAt),
      }) +
        (typeof consented.metadata?.disclosureVersion === "string"
          ? ` (${tr("disclosure {version}", { version: consented.metadata.disclosureVersion })})`
          : ""),
    );
  }

  const methods = readStringArray(signed?.metadata?.signatureMethods);

  if (methods.length > 0) {
    details.push(
      tr("Signature adopted by: {methods}", {
        methods: methods.map((method) => tr(method)).join(", "),
      }),
    );
  }

  details.push(...describeProviderSignatureEvidence(signed, redacted));

  if (!redacted && signed?.ipAddress) {
    details.push(tr("Signed from IP {ip}", { ip: signed.ipAddress }));
  }

  return details;
}

function describeEventEvidence(event: AuditEventRecord): string[] {
  const details: string[] = [];
  const metadata = event.metadata ?? {};

  if (event.ipAddress || event.userAgent) {
    details.push(
      [
        event.ipAddress ? `IP ${event.ipAddress}` : null,
        event.userAgent
          ? `${tr("browser")} ${event.userAgent.slice(0, 160)}`
          : null,
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }

  if (typeof metadata.timezoneOffsetMinutes === "number") {
    const offset = -metadata.timezoneOffsetMinutes;
    const sign = offset >= 0 ? "+" : "-";
    const hours = Math.floor(Math.abs(offset) / 60);
    const minutes = Math.abs(offset) % 60;

    details.push(
      tr("signer's clock: {offset}", {
        offset: `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
      }),
    );
  }

  if (event.event === "email_sent") {
    const recipient =
      typeof metadata.recipient === "string" ? metadata.recipient : null;
    const kind =
      typeof metadata.template === "string" ? metadata.template : null;
    const messageId =
      typeof metadata.messageId === "string" ? metadata.messageId : null;

    details.push(
      [
        kind ? `email ${kind.replaceAll("_", " ")}` : "email",
        recipient ? `to ${recipient}` : null,
        messageId ? `accepted by the mail provider as ${messageId}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  if (event.event === "signer_corrected") {
    details.push(describeSignerCorrectedEvent(metadata));
  }

  if (event.event === "verified" && typeof metadata.method === "string") {
    details.push(
      tr("passed: {check}", { check: authenticationLabel(metadata.method) }),
    );

    // PetskySign: what the signer typed at the identity check.
    if (
      metadata.method === "identity" &&
      typeof metadata.declaredName === "string" &&
      typeof metadata.cpf === "string"
    ) {
      details.push(
        tr("declared name: {name}; CPF: {cpf}", {
          cpf: metadata.cpf,
          name: metadata.declaredName,
        }),
      );
    }
  }

  if (
    event.event === "verification_failed" &&
    typeof metadata.method === "string"
  ) {
    details.push(
      // PetskySign: the identity label says "matching", so a failure needs
      // its own words.
      metadata.method === "identity"
        ? tr("the CPF typed did not match the sender's records")
        : tr("wrong {check}", { check: authenticationLabel(metadata.method) }),
    );
  }

  return details;
}

function getSignerCertificateActionLabel(
  envelope: EnvelopeRecord,
  signer: SignerRecord,
): string {
  switch (signer.status) {
    case "signed":
      return tr("Signed at {time}", {
        time: formatAuditTimestamp(signer.signedAt),
      });
    case "declined":
      return tr("Declined at {time}", {
        time: formatAuditTimestamp(signer.declinedAt),
      });
    case "notified":
      if (envelope.status === "voided") {
        return tr("Awaiting signature when envelope was voided");
      }

      if (envelope.status === "declined") {
        return tr("Awaiting signature when envelope was declined");
      }

      return tr("Awaiting signature");
    case "pending":
      return tr("Not reached");
    default: {
      const exhaustiveStatus: never = signer.status;
      return exhaustiveStatus;
    }
  }
}

function appendAuditTrailPages(input: {
  auditEvents: AuditEventRecord[];
  auditFingerprint?: string | null;
  completedAt: number;
  copyRecipients?: readonly CertificateCopyRecipient[];
  envelope: EnvelopeRecord;
  fonts: {
    bold: TextFace;
    regular: TextFace;
  };
  pdfDocument: PDFDocument;
  /** PetskySign: the name in each page's header. */
  productName?: string;
  redactForRecipients?: boolean;
  senderName?: string | null;
  signatureFace?: TextFace;
  /** PetskySign: each signer's signature, by signer id. */
  signatures?: ReadonlyMap<string, CertificateSignature>;
  signedPdfSha256?: string | null;
  signers: SignerRecord[];
}) {
  const templatePage = input.pdfDocument.getPageCount()
    ? input.pdfDocument.getPage(0)
    : null;
  const pageSize = templatePage
    ? {
        height: templatePage.getHeight(),
        width: templatePage.getWidth(),
      }
    : DEFAULT_AUDIT_PAGE_SIZE;
  const margin = 48;
  // PetskySign: room for the header and footer drawn on every page.
  const headerHeight = 64;
  const footerHeight = 30;
  const maxWidth = pageSize.width - margin * 2;
  const lineHeightMultiplier = 1.24;
  const top = pageSize.height - margin - headerHeight;
  const bottom = margin + footerHeight;
  const buildAt = (scale: number) =>
    buildAuditLines({
      auditEvents: input.auditEvents,
      auditFingerprint: input.auditFingerprint,
      completedAt: input.completedAt,
      copyRecipients: input.copyRecipients,
      envelope: input.envelope,
      fonts: input.fonts,
      maxWidth,
      redactForRecipients: input.redactForRecipients,
      scale,
      senderName: input.senderName,
      signedPdfSha256: input.signedPdfSha256,
      signers: input.signers,
    });
  const heightOf = (candidate: CertificateLine[]) =>
    candidate.reduce(
      (total, line) =>
        total +
        (line.gapBefore ?? 0) +
        (line.rule ? 6 : 0) +
        line.size * lineHeightMultiplier +
        (line.gapAfter ?? 0),
      0,
    );
  // PetskySign: one page, as D4Sign's. The text shrinks in steps until it
  // fits; only a document with many signers and events goes on to a second
  // page, at the smallest step.
  const scales = [1, 0.94, 0.88, 0.82, 0.76, 0.7];
  let lines = buildAt(scales[0]!);

  for (const scale of scales.slice(1)) {
    if (heightOf(lines) <= top - bottom) {
      break;
    }

    lines = buildAt(scale);
  }

  const pages: PDFPage[] = [];
  const newPage = () => {
    const created = input.pdfDocument.addPage([
      pageSize.width,
      pageSize.height,
    ]);

    pages.push(created);
    return created;
  };

  let page = newPage();
  let cursorY = top;
  const contentTop = cursorY;

  for (const line of lines) {
    cursorY -= line.gapBefore ?? 0;

    const lineHeight = line.size * lineHeightMultiplier;

    if (cursorY - lineHeight < bottom) {
      page = newPage();
      cursorY = top;
    }

    if (line.rule) {
      page.drawLine({
        color: rgb(0.85, 0.88, 0.92),
        end: { x: pageSize.width - margin, y: cursorY + 6 },
        start: { x: margin, y: cursorY + 6 },
        thickness: 0.8,
      });
      cursorY -= 6;
    }

    const x = margin + (line.indent ?? 0);
    const baseline = cursorY - line.size;

    const signature = line.signatureOf
      ? input.signatures?.get(line.signatureOf)
      : undefined;

    if (signature) {
      drawCertificateSignature(
        page,
        signature,
        input.signatureFace,
        pageSize.width - margin - CERT_SIGNATURE_WIDTH,
        baseline + line.size - CERT_SIGNATURE_HEIGHT + 4,
      );
    }

    if (line.icon) {
      drawCertificateIcon(
        page,
        line.icon,
        margin + 7,
        baseline + line.size * 0.35,
      );
    }

    line.font.drawText(page, line.text, {
      color: rgb(...(line.color ?? CERT_INK)),
      size: line.size,
      x,
      y: baseline,
    });

    cursorY -= lineHeight;
    cursorY -= line.gapAfter ?? 0;
  }

  // The QR code on the first page, beside the document's title: it opens
  // the page where anyone can check a copy.
  const verifyUrl = `${(resolveAppUrl() ?? "").replace(/\/+$/, "")}/verify`;

  if (verifyUrl.startsWith("http")) {
    drawQrCode(
      pages[0]!,
      verifyUrl,
      pageSize.width - margin - CERT_QR_SIZE,
      contentTop - CERT_QR_SIZE,
      CERT_QR_SIZE,
    );
  }

  // Page chrome, now that the page count is known.
  const generatedAt = formatAuditTimestamp(Math.floor(Date.now() / 1000));
  const productName = input.productName?.trim() || "Petsky";

  pages.forEach((current, index) => {
    const { height, width } = {
      height: pageSize.height,
      width: pageSize.width,
    };

    // Frame: the patterned band of a security paper, as D4Sign's.
    drawSecurityFrame(current, width, height);

    // Header: the product on the left, the page count and time zone right.
    const headerY = height - margin - 16;

    input.fonts.bold.drawText(current, productName, {
      color: rgb(...CERT_ACCENT),
      size: 16,
      x: margin,
      y: headerY,
    });
    input.fonts.regular.drawText(current, tr("Electronic signature"), {
      color: rgb(...CERT_MUTED),
      size: 7.5,
      x: margin,
      y: headerY - 12,
    });

    const rightLines = [
      appLocale() === "pt-BR"
        ? pages.length === 1
          ? tr("1 page - Times in Brasília time")
          : tr("{count} pages - Times in Brasília time", {
              count: pages.length,
            })
        : pages.length === 1
          ? tr("1 page - Times in UTC")
          : tr("{count} pages - Times in UTC", { count: pages.length }),
      tr("Certificate generated {date}", { date: generatedAt }),
    ];

    rightLines.forEach((text, lineIndex) => {
      const size = 7.5;
      const face = lineIndex === 0 ? input.fonts.bold : input.fonts.regular;

      face.drawText(current, text, {
        color: rgb(...CERT_MUTED),
        size,
        x: width - margin - face.widthOfTextAtSize(text, size),
        y: headerY + 4 - lineIndex * 11,
      });
    });

    current.drawLine({
      color: rgb(...CERT_ACCENT),
      end: { x: width - margin, y: height - margin - headerHeight + 22 },
      start: { x: margin, y: height - margin - headerHeight + 22 },
      thickness: 1,
    });

    // Footer: the document code and the page.
    const footerY = margin - 6;
    const code = tr("Envelope ID: {id}", { id: input.envelope.id });
    const pageLabel = tr("Page {page} of {count}", {
      count: pages.length,
      page: index + 1,
    });

    input.fonts.regular.drawText(current, code, {
      color: rgb(...CERT_MUTED),
      size: 7,
      x: margin,
      y: footerY,
    });
    input.fonts.regular.drawText(current, pageLabel, {
      color: rgb(...CERT_MUTED),
      size: 7,
      x: width - margin - input.fonts.regular.widthOfTextAtSize(pageLabel, 7),
      y: footerY,
    });
  });
}

/**
 * PetskySign: the patterned band around each page of the certificate, like
 * the security paper of a notary's document (and D4Sign's certificate): fine
 * lines crossing at 45 degrees, from green at the bottom left to blue at the
 * top right, between two thin rules.
 */
function drawSecurityFrame(page: PDFPage, width: number, height: number) {
  const outer = 10;
  const band = 18;
  const spacing = 2.6;
  const green: [number, number, number] = [0.33, 0.7, 0.36];
  const blue: [number, number, number] = [0.18, 0.47, 0.84];
  // The four sides of the band, as [x0, y0, x1, y1].
  const sides: Array<[number, number, number, number]> = [
    [outer, height - outer - band, width - outer, height - outer],
    [outer, outer, width - outer, outer + band],
    [outer, outer + band, outer + band, height - outer - band],
    [width - outer - band, outer + band, width - outer, height - outer - band],
  ];
  const colorAt = (x: number, y: number) => {
    const t = Math.min(1, Math.max(0, (x + y) / (width + height)));

    return rgb(
      green[0] + (blue[0] - green[0]) * t,
      green[1] + (blue[1] - green[1]) * t,
      green[2] + (blue[2] - green[2]) * t,
    );
  };

  for (const [x0, y0, x1, y1] of sides) {
    page.drawRectangle({
      color: rgb(0.95, 0.98, 0.96),
      height: y1 - y0,
      width: x1 - x0,
      x: x0,
      y: y0,
    });

    // y = x + c, rising lines, kept inside this side.
    for (let c = y0 - x1; c <= y1 - x0; c += spacing) {
      const start = Math.max(x0, y0 - c);
      const end = Math.min(x1, y1 - c);

      if (end > start) {
        page.drawLine({
          color: colorAt((start + end) / 2, (start + end) / 2 + c),
          end: { x: end, y: end + c },
          start: { x: start, y: start + c },
          thickness: 0.35,
        });
      }
    }

    // y = -x + c, falling lines.
    for (let c = x0 + y0; c <= x1 + y1; c += spacing) {
      const start = Math.max(x0, c - y1);
      const end = Math.min(x1, c - y0);

      if (end > start) {
        page.drawLine({
          color: colorAt((start + end) / 2, c - (start + end) / 2),
          end: { x: end, y: c - end },
          start: { x: start, y: c - start },
          thickness: 0.35,
        });
      }
    }
  }

  // The rules on both edges of the band.
  for (const [inset, thickness] of [
    [outer, 1.2],
    [outer + band, 1],
  ] as const) {
    page.drawRectangle({
      borderColor: rgb(0.2, 0.52, 0.62),
      borderWidth: thickness,
      height: height - inset * 2,
      width: width - inset * 2,
      x: inset,
      y: inset,
    });
  }
}

/**
 * PetskySign: a signer's signature on the right of their name, as D4Sign's
 * certificate shows it: the drawn image, or the typed name in the signature
 * face, fitted in a box over a thin line.
 */
function drawCertificateSignature(
  page: PDFPage,
  signature: CertificateSignature,
  face: TextFace | undefined,
  x: number,
  y: number,
) {
  if ("image" in signature) {
    const scaled = signature.image.scaleToFit(
      CERT_SIGNATURE_WIDTH,
      CERT_SIGNATURE_HEIGHT - 4,
    );

    page.drawImage(signature.image, {
      height: scaled.height,
      width: scaled.width,
      x: x + (CERT_SIGNATURE_WIDTH - scaled.width) / 2,
      y: y + 4,
    });
  } else if (face) {
    const size = fitTextSize(
      face,
      signature.text,
      CERT_SIGNATURE_WIDTH,
      CERT_SIGNATURE_HEIGHT - 6,
      18,
    );

    face.drawText(page, signature.text, {
      color: rgb(0.12, 0.12, 0.12),
      size,
      x:
        x +
        (CERT_SIGNATURE_WIDTH - face.widthOfTextAtSize(signature.text, size)) /
          2,
      y: y + 6,
    });
  } else {
    return;
  }

  page.drawLine({
    color: rgb(0.75, 0.79, 0.85),
    end: { x: x + CERT_SIGNATURE_WIDTH, y: y + 2 },
    start: { x, y: y + 2 },
    thickness: 0.5,
  });
}

/** A check, a cross or a dot in a small circle, before a signer's name. */
function drawCertificateIcon(
  page: PDFPage,
  icon: NonNullable<CertificateLine["icon"]>,
  centerX: number,
  centerY: number,
) {
  const color =
    icon === "check"
      ? CERT_SUCCESS
      : icon === "cross"
        ? CERT_DANGER
        : CERT_MUTED;

  if (icon === "dot") {
    page.drawCircle({
      color: rgb(...color),
      size: 2.2,
      x: centerX,
      y: centerY,
    });
    return;
  }

  page.drawCircle({
    borderColor: rgb(...color),
    borderWidth: 1.2,
    size: 6.5,
    x: centerX,
    y: centerY,
  });

  const stroke = { color: rgb(...color), thickness: 1.4 };

  if (icon === "check") {
    page.drawLine({
      ...stroke,
      end: { x: centerX - 0.6, y: centerY - 2.6 },
      start: { x: centerX - 3, y: centerY - 0.2 },
    });
    page.drawLine({
      ...stroke,
      end: { x: centerX + 3.4, y: centerY + 2.6 },
      start: { x: centerX - 0.6, y: centerY - 2.6 },
    });
  } else {
    page.drawLine({
      ...stroke,
      end: { x: centerX + 2.4, y: centerY + 2.4 },
      start: { x: centerX - 2.4, y: centerY - 2.4 },
    });
    page.drawLine({
      ...stroke,
      end: { x: centerX + 2.4, y: centerY - 2.4 },
      start: { x: centerX - 2.4, y: centerY + 2.4 },
    });
  }
}

/** A QR code drawn as squares, so nothing but pdf-lib is needed. */
function drawQrCode(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  size: number,
) {
  const { data, size: modules } = encodeQr(value, { border: 1, ecc: "M" });
  const cell = size / modules;

  page.drawRectangle({ color: rgb(1, 1, 1), height: size, width: size, x, y });

  data.forEach((row, rowIndex) => {
    row.forEach((on, columnIndex) => {
      if (on) {
        page.drawRectangle({
          color: rgb(...CERT_INK),
          height: cell + 0.05,
          width: cell + 0.05,
          x: x + columnIndex * cell,
          y: y + size - (rowIndex + 1) * cell,
        });
      }
    });
  });
}

/** Someone sent a copy of the finished document who did not sign it. */
export type CertificateCopyRecipient = { email: string; name: string };

type CertificateInput = {
  auditEvents: AuditEventRecord[];
  copyRecipients?: readonly CertificateCopyRecipient[];
  envelope: EnvelopeRecord;
  redactForRecipients?: boolean;
  /**
   * PetskySign: the document's fields, to show each signer's signature
   * beside their name. Without them the certificate has no signatures.
   */
  fields?: readonly FieldRecord[];
  /**
   * PetskySign: the business that sent the document, for the sender's
   * events. Read from the document's branding when left out.
   */
  senderName?: string | null;
  /** The finished signed PDF's SHA-256, printed when there is one. */
  signedPdfSha256?: string | null;
  signers: SignerRecord[];
};

type SealOption = {
  seal?: PdfSealer;
};

function assertTerminalEnvelope(envelope: EnvelopeRecord, noun: string) {
  if (
    envelope.status !== "completed" &&
    envelope.status !== "declined" &&
    envelope.status !== "voided"
  ) {
    throw new PdfFinalizeError(
      `${noun} can only be generated for terminal envelopes.`,
    );
  }
}

export async function storeEnvelopeCertificatePdf(
  input: CertificateInput & { certificate: StorageObjectRef },
  {
    seal,
    storageService = createStorageService(),
  }: SealOption & {
    storageService?: StorageService;
  } = {},
): Promise<StoredSealedPdf> {
  assertTerminalEnvelope(input.envelope, "Certificates");

  const body = await renderEnvelopeCertificatePdf(input, {
    seal,
    storageService,
  });
  const stored = await storageService.putObject({
    body,
    contentType: "application/pdf",
    key: input.certificate.key,
  });

  return { ...stored, body, sha256: sha256Hex(body) };
}

export async function storeRecipientEnvelopeCertificatePdf(
  input: Omit<CertificateInput, "redactForRecipients"> & {
    certificate: StorageObjectRef;
  },
  {
    seal,
    storageService = createStorageService(),
  }: SealOption & {
    storageService?: StorageService;
  } = {},
): Promise<StoredSealedPdf> {
  assertTerminalEnvelope(input.envelope, "Evidence bundles");

  return storeEnvelopeCertificatePdf(
    {
      ...input,
      redactForRecipients: true,
    },
    {
      seal,
      storageService,
    },
  );
}

/** PetskySign: the business on the document's branding, if it has one. */
async function readSenderName(envelopeId: string): Promise<string | null> {
  try {
    return (await getDocumentBranding(envelopeId, getDb()))?.name ?? null;
  } catch {
    return null;
  }
}

export async function renderEnvelopeCertificatePdf(
  input: CertificateInput,
  {
    seal = defaultSealer,
    storageService,
  }: SealOption & { storageService?: StorageService } = {},
): Promise<Uint8Array> {
  assertTerminalEnvelope(input.envelope, "Certificates");

  const pdfDocument = await PDFDocument.create();
  // PetskySign: each signer's first signature, shown beside their name.
  const signatureFields = new Map<string, FieldRecord>();

  for (const field of input.fields ?? []) {
    if (
      field.type === "signature" &&
      shouldStampField(field) &&
      !signatureFields.has(field.signerId)
    ) {
      signatureFields.set(field.signerId, field);
    }
  }

  const typedSignatures = [...signatureFields.values()]
    .filter((field) => field.inputMethod !== "drawn" && field.value?.trim())
    .map((field) => field.value!.trim());
  const faces = await embedTextFaces(
    pdfDocument,
    [
      input.envelope,
      input.signers,
      input.auditEvents,
      input.copyRecipients ?? [],
      typedSignatures,
    ],
    {
      bold: true,
      certificate: true,
      signature: typedSignatures.length > 0,
    },
  );
  const signatures = new Map<string, CertificateSignature>();
  const imageCache = new Map<string, PDFImage>();

  for (const [signerId, field] of signatureFields) {
    if (field.inputMethod === "drawn" && field.imageKey) {
      try {
        signatures.set(signerId, {
          image: await getEmbeddedPng(
            field.imageKey,
            imageCache,
            pdfDocument,
            storageService ?? createStorageService(),
          ),
        });
      } catch {
        // A missing image leaves the name without a signature beside it.
      }
    } else if (field.value?.trim()) {
      signatures.set(signerId, { text: field.value.trim() });
    }
  }
  const terminalTimestamp = resolveTerminalTimestamp(
    input.envelope,
    Math.floor(Date.now() / 1000),
  );

  appendAuditTrailPages({
    auditEvents: input.redactForRecipients
      ? input.auditEvents.map(redactAuditEventForRecipients)
      : input.auditEvents,
    auditFingerprint: computeAuditFingerprint(
      stripCompletedAuditEvents(input.auditEvents),
    ),
    completedAt: terminalTimestamp,
    copyRecipients: input.copyRecipients,
    envelope: input.envelope,
    fonts: faces,
    pdfDocument,
    productName: await getBranding()
      .then((branding) => branding.productName)
      .catch(() => "Petsky"),
    senderName: input.senderName ?? (await readSenderName(input.envelope.id)),
    signatureFace: typedSignatures.length > 0 ? faces.signature : undefined,
    signatures,
    redactForRecipients: input.redactForRecipients,
    signedPdfSha256: input.signedPdfSha256,
    signers: input.signers,
  });
  pdfDocument.setTitle(
    tr("Audit certificate: {title}", { title: input.envelope.title }),
  );
  pdfDocument.setProducer("Petsky");

  return seal(pdfDocument, "certificate");
}

export class SourceDocumentChangedError extends PdfFinalizeError {
  constructor() {
    super(
      "The stored source document no longer matches the one that was sent for signing.",
    );
    this.name = "SourceDocumentChangedError";
  }
}

export async function renderFinalizedEnvelopePdf(
  input: {
    auditEvents: AuditEventRecord[];
    completedAt: number;
    copyRecipients?: readonly CertificateCopyRecipient[];
    envelope: EnvelopeRecord;
    fields: FieldRecord[];
    includeAuditTrail?: boolean;
    signers: SignerRecord[];
    sourcePdfKey: string;
  },
  {
    seal = defaultSealer,
    storageService = createStorageService(),
  }: SealOption & {
    storageService?: StorageService;
  } = {},
): Promise<Uint8Array> {
  const sourcePdfObject = await storageService.getObject(input.sourcePdfKey);

  // The certificate states the source document's hash, so the stamped copy
  // must be made from exactly that file.
  if (sha256Hex(sourcePdfObject.body) !== input.envelope.sourcePdfHash) {
    throw new SourceDocumentChangedError();
  }

  const pdfDocument = await PDFDocument.load(sourcePdfObject.body);

  const stampedFields = input.fields
    .filter(shouldStampField)
    .sort((left, right) => left.page - right.page || left.y - right.y);
  // Part 11: the signer's name, the time and the meaning, printed beside
  // each of their signatures (21 CFR 11.50).
  const manifestations = new Map<string, string>();

  if (input.envelope.part11) {
    for (const signer of input.signers) {
      const text = signer.id ? buildSignatureManifestation(signer) : null;

      if (text && signer.id) {
        manifestations.set(signer.id, text);
      }
    }
  }
  // The signed document embeds glyphs for the stamped values only. The
  // certificate's wording is added when the audit trail is appended to it.
  const faces = await embedTextFaces(
    pdfDocument,
    [
      stampedFields.map((field) => field.value),
      [...manifestations.values()],
      input.includeAuditTrail
        ? [
            input.envelope,
            input.signers,
            input.auditEvents,
            input.copyRecipients ?? [],
          ]
        : [],
    ],
    {
      bold: Boolean(input.includeAuditTrail),
      certificate: Boolean(input.includeAuditTrail),
      signature: stampedFields.some(
        (field) =>
          (field.type === "signature" || field.type === "initials") &&
          field.inputMethod !== "drawn",
      ),
    },
  );
  const imageCache = new Map<string, PDFImage>();

  for (const field of stampedFields) {
    const page = pdfDocument.getPage(field.page - 1);

    if (!page) {
      throw new PdfFinalizeError(
        `Field ${field.id} references missing page ${field.page}.`,
      );
    }

    await stampFieldValue(
      field,
      page,
      { auditRegular: faces.regular, signature: faces.signature },
      imageCache,
      pdfDocument,
      storageService,
    );

    const manifestation =
      field.type === "signature" ? manifestations.get(field.signerId) : null;

    if (manifestation) {
      stampSignatureManifestation(field, page, faces.regular, manifestation);
    }
  }

  try {
    pdfDocument.getForm().flatten();
  } catch {
    // Many source PDFs have no AcroForm. Stamping still produces the final locked view.
  }

  if (input.includeAuditTrail) {
    appendAuditTrailPages({
      auditEvents: stripCompletedAuditEvents(input.auditEvents),
      completedAt: input.completedAt,
      copyRecipients: input.copyRecipients,
      envelope: input.envelope,
      fonts: faces,
      pdfDocument,
      signers: input.signers,
    });
  }

  return seal(pdfDocument, "signed-document");
}

export async function finalizeEnvelope(
  input: {
    auditEvents: AuditEventRecord[];
    copyRecipients?: readonly CertificateCopyRecipient[];
    envelope: EnvelopeRecord;
    fields: FieldRecord[];
    signers: SignerRecord[];
    sourcePdf: StorageObjectRef;
  },
  {
    seal,
    signedRevision,
    storageService = createStorageService(),
  }: SealOption & {
    /**
     * The last signer's revision, when the signers signed with their own
     * certificates: it is the signed document, and gets validation data.
     */
    signedRevision?: Uint8Array;
    storageService?: StorageService;
  } = {},
): Promise<FinalizedEnvelopeArtifacts> {
  const generatedAt = Math.floor(Date.now() / 1000);
  const storageIdentity = {
    envelopeId: input.envelope.id,
    userId: input.envelope.userId,
  };
  const signedPdfBytes = signedRevision
    ? await finishSignerSignedPdf(signedRevision)
    : await renderFinalizedEnvelopePdf(
        {
          auditEvents: input.auditEvents,
          completedAt: generatedAt,
          copyRecipients: input.copyRecipients,
          envelope: input.envelope,
          fields: input.fields,
          signers: input.signers,
          sourcePdfKey: input.sourcePdf.key,
        },
        {
          seal,
          storageService,
        },
      );
  const signedPdfSha256 = sha256Hex(signedPdfBytes);
  const completedEnvelope = {
    ...input.envelope,
    completedAt: generatedAt,
    status: "completed" as const,
    updatedAt: generatedAt,
  };
  let signedPdf: StoredSealedPdf | null = null;
  let certificate: StoredSealedPdf | null = null;
  let recipientCertificate: StoredSealedPdf | null = null;

  try {
    signedPdf = {
      ...(await storageService.putObject({
        body: signedPdfBytes,
        contentType: "application/pdf",
        key: buildEnvelopeSignedPdfKey(storageIdentity),
      })),
      body: signedPdfBytes,
      sha256: signedPdfSha256,
    };

    certificate = await storeEnvelopeCertificatePdf(
      {
        auditEvents: input.auditEvents,
        certificate: {
          bucketName: input.sourcePdf.bucketName,
          key: buildEnvelopeCertificateKey({
            ...storageIdentity,
            audience: "internal",
          }),
        },
        copyRecipients: input.copyRecipients,
        envelope: completedEnvelope,
        fields: input.fields,
        signedPdfSha256,
        signers: input.signers,
      },
      {
        seal,
        storageService,
      },
    );
    recipientCertificate = await storeRecipientEnvelopeCertificatePdf(
      {
        auditEvents: input.auditEvents,
        certificate: {
          bucketName: input.sourcePdf.bucketName,
          key: buildEnvelopeCertificateKey({
            ...storageIdentity,
            audience: "recipient",
          }),
        },
        copyRecipients: input.copyRecipients,
        envelope: completedEnvelope,
        fields: input.fields,
        signedPdfSha256,
        signers: input.signers,
      },
      {
        seal,
        storageService,
      },
    );

    return {
      certificate,
      generatedAt,
      recipientCertificate,
      signedPdf,
    };
  } catch (error) {
    await Promise.all([
      ...(signedPdf
        ? [storageService.deleteObject(signedPdf.key).catch(() => undefined)]
        : []),
      ...(certificate
        ? [storageService.deleteObject(certificate.key).catch(() => undefined)]
        : []),
      ...(recipientCertificate
        ? [
            storageService
              .deleteObject(recipientCertificate.key)
              .catch(() => undefined),
          ]
        : []),
    ]);
    throw error;
  }
}
