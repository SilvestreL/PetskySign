import { randomUUID } from "node:crypto";

import { z } from "zod";

import { type DbPool, queryMany, withTransaction } from "../db/connection.ts";
import {
  createDraftEnvelope,
  deleteDraftEnvelope,
  EnvelopeMutationError,
  replaceDraftEnvelopeFields,
  replaceDraftEnvelopeSigners,
  sendDraftEnvelope,
  voidSentEnvelope,
} from "../envelopes.ts";
import {
  ReminderMutationError,
  sendManualEnvelopeNudge,
} from "../reminders.ts";
import { deadlineDaysSchema } from "../schemas/envelope.ts";
import {
  emailSchema,
  envelopeTitleSchema,
  nameSchema,
  normalizedCoordinateSchema,
  normalizedSizeSchema,
} from "../schemas/common.ts";
import { recordAuditEvent } from "../services/audit.ts";
import { DocumentImportError } from "../services/document-import.ts";
import { issueSigningLink } from "../services/signing-links.ts";
import type { ApiKeyPrincipal } from "./api-keys.ts";
import {
  DocumentBrandingError,
  documentBrandingSchema,
  prepareDocumentBranding,
} from "./document-branding.ts";
import { displayEmail, placeholderEmailFor } from "./placeholder-email.ts";
import { encryptCpf, hashCpf, maskCpf, normalizeCpf } from "./cpf.ts";
import { getEvolutionConfig, normalizeBrazilMobile } from "./whatsapp.ts";

/**
 * The integration API's operations (/api/v1/documents). A "document" here is
 * an envelope with one signer, sent as soon as it is created. Everything is
 * done through the same functions the browser uses, as the API key's
 * account, so the rules (fields, deadlines, audit trail, sealing) are the
 * same.
 */

export class ApiDocumentError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiDocumentError";
    this.statusCode = statusCode;
  }
}

export type RequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const apiFieldTypes = ["signature", "initials", "name", "date"] as const;

const placementSchema = z
  .object({
    /** 1-based. A negative number counts from the end: -1 is the last page. */
    page: z
      .number()
      .int()
      .refine((page) => page !== 0, "page cannot be 0"),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    width: normalizedSizeSchema,
    height: normalizedSizeSchema,
  })
  .refine((value) => value.x + value.width <= 1.000001, {
    message: "The field goes past the right edge of the page",
    path: ["width"],
  })
  .refine((value) => value.y + value.height <= 1.000001, {
    message: "The field goes past the bottom of the page",
    path: ["height"],
  });

const apiFieldSchema = placementSchema.and(
  z.object({ type: z.enum(apiFieldTypes) }),
);

export const createApiDocumentSchema = z
  .object({
    title: envelopeTitleSchema,
    signer: z.object({
      name: nameSchema,
      email: emailSchema.optional(),
      /** "link": nothing is emailed; the link comes back in the response. */
      channel: z.enum(["link", "email"]).default("link"),
      /**
       * The signer's CPF. When given, the signer types their full name and
       * this CPF before the document opens (the "identity" check).
       */
      cpf: z
        .string()
        .trim()
        .max(20)
        .optional()
        .refine(
          (value) => value === undefined || normalizeCpf(value) !== null,
          {
            message: "That CPF is not valid.",
          },
        ),
      /** Email a one-time code the signer must type before the document opens. */
      requireEmailCode: z.boolean().optional(),
      /** The signer's Brazilian mobile number, for a code by WhatsApp. */
      phone: z
        .string()
        .trim()
        .max(30)
        .optional()
        .refine(
          (value) =>
            value === undefined || normalizeBrazilMobile(value) !== null,
          { message: "That is not a Brazilian mobile number." },
        ),
      /**
       * Send a one-time code by WhatsApp, to `phone`, that the signer must
       * type before the document opens.
       */
      requireWhatsappCode: z.boolean().optional(),
    }),
    /**
     * Where the signer signs. Coordinates are fractions of the page, from
     * its top-left corner. Left out: one signature box at the bottom of the
     * last page.
     */
    fields: z.array(apiFieldSchema).min(1).max(20).optional(),
    expiresInDays: deadlineDaysSchema.optional(),
    /** Email channel only. Days between automatic reminders. */
    reminderIntervalDays: z.number().int().min(1).max(30).nullable().optional(),
    /** The caller's own id for this document, such as the contract id. */
    externalRef: z.string().trim().min(1).max(200).optional(),
    /** The caller's own id for the business the document belongs to. */
    companyRef: z.string().trim().min(1).max(200).optional(),
    /** The business shown to the signer: name, color, logo, contact. */
    branding: documentBrandingSchema.optional(),
    /**
     * The caller confirms the document is an ordinary agreement that may be
     * signed electronically. Recorded in the audit trail, as in the app.
     */
    permittedUseConfirmed: z.literal(true, {
      error: "Confirm permittedUseConfirmed: true to send.",
    }),
  })
  .superRefine((value, ctx) => {
    if (value.signer.requireWhatsappCode && !value.signer.phone) {
      ctx.addIssue({
        code: "custom",
        message:
          "A mobile number is required to send the signer a code by WhatsApp.",
        path: ["signer", "phone"],
      });
    }

    if (value.signer.requireEmailCode && !value.signer.email) {
      ctx.addIssue({
        code: "custom",
        message: "An email address is required to email the signer a code.",
        path: ["signer", "requireEmailCode"],
      });
    }

    if (value.signer.channel === "email" && !value.signer.email) {
      ctx.addIssue({
        code: "custom",
        message: "An email address is required for the email channel.",
        path: ["signer", "email"],
      });
    }

    if (value.signer.channel === "link" && value.reminderIntervalDays) {
      ctx.addIssue({
        code: "custom",
        message: "Automatic reminders are only sent on the email channel.",
        path: ["reminderIntervalDays"],
      });
    }

    if (
      value.fields &&
      !value.fields.some((field) => field.type === "signature")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Place at least one signature field.",
        path: ["fields"],
      });
    }
  });

export type CreateApiDocumentInput = z.infer<typeof createApiDocumentSchema>;

/** Bottom of the last page, left-aligned under the text. */
export const DEFAULT_SIGNATURE_FIELD = {
  height: 0.07,
  page: -1,
  type: "signature",
  width: 0.38,
  x: 0.08,
  y: 0.84,
} as const;

export type CreatedApiDocument = {
  documentId: string;
  expiresAt: number | null;
  signLink: string | null;
  signerId: string;
  status: "sent";
};

export async function createApiDocument(
  principal: ApiKeyPrincipal,
  input: CreateApiDocumentInput,
  file: { body: Uint8Array; contentType: string | null; filename: string },
  context: RequestContext,
  database: DbPool,
): Promise<CreatedApiDocument> {
  const userId = principal.user.id;
  // Checked (and the logo stored) before anything else is made.
  const branding = input.branding
    ? await prepareDocumentBranding(input.branding)
    : null;
  const draft = await createDraftEnvelope(
    userId,
    { sourcePdf: file, title: input.title },
    { database },
  );
  const envelopeId = draft.envelope.id;

  try {
    await database.query(
      `
        UPDATE envelopes
        SET
          external_ref = $1,
          company_ref = $2,
          api_key_id = $3,
          brand_name = $6,
          brand_color = $7,
          brand_logo_key = $8,
          brand_contact = $9
        WHERE id = $4 AND user_id = $5
      `,
      [
        input.externalRef ?? null,
        input.companyRef ?? null,
        principal.keyId,
        envelopeId,
        userId,
        branding?.brandName ?? null,
        branding?.brandColor ?? null,
        branding?.brandLogoKey ?? null,
        branding?.brandContact ?? null,
      ],
    );

    const signerEmail = input.signer.email ?? placeholderEmailFor(randomUUID());
    const signers = await replaceDraftEnvelopeSigners(
      userId,
      envelopeId,
      {
        signers: [
          {
            email: signerEmail,
            name: input.signer.name,
            ...(input.signer.requireEmailCode
              ? { requireEmailCode: true }
              : {}),
          },
        ],
      },
      database,
    );
    const signerId = signers.signers[0]?.id;

    if (!signerId) {
      throw new ApiDocumentError("The signer could not be added.", 500);
    }

    // PetskySign: a WhatsApp code needs this site to be able to send one;
    // otherwise the signer could never open the document.
    if (input.signer.requireWhatsappCode && !getEvolutionConfig()) {
      throw new ApiDocumentError(
        "Codes by WhatsApp are not set up on this site (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE).",
        400,
      );
    }

    const phone = input.signer.phone
      ? normalizeBrazilMobile(input.signer.phone)
      : null;

    if (phone) {
      await database.query(
        `
          UPDATE signers
          SET whatsapp_phone = $1, require_whatsapp_code = $2
          WHERE id = $3 AND envelope_id = $4
        `,
        [
          phone,
          input.signer.requireWhatsappCode === true,
          signerId,
          envelopeId,
        ],
      );
    }

    const cpf = input.signer.cpf ? normalizeCpf(input.signer.cpf) : null;

    if (cpf) {
      await database.query(
        `
          UPDATE signers
          SET
            identity_cpf_hash = $1,
            identity_cpf_hint = $2,
            identity_cpf_encrypted = $5
          WHERE id = $3 AND envelope_id = $4
        `,
        [hashCpf(cpf), maskCpf(cpf), signerId, envelopeId, encryptCpf(cpf)],
      );
    }

    const pageCount = draft.envelope.pageCount;
    const fields = (input.fields ?? [DEFAULT_SIGNATURE_FIELD]).map((field) => {
      const page = field.page < 0 ? pageCount + 1 + field.page : field.page;

      if (page < 1 || page > pageCount) {
        throw new ApiDocumentError(
          `Page ${field.page} is not in this document, which has ${pageCount}.`,
          400,
        );
      }

      return {
        height: field.height,
        page,
        required: true,
        signerId,
        type: field.type,
        width: field.width,
        x: field.x,
        y: field.y,
      };
    });

    await replaceDraftEnvelopeFields(userId, envelopeId, { fields }, database);

    const sent = await sendDraftEnvelope(
      userId,
      envelopeId,
      {
        delivery: input.signer.channel,
        expiresInDays: input.expiresInDays,
        ipAddress: context.ipAddress,
        reminderIntervalDays:
          input.signer.channel === "email"
            ? (input.reminderIntervalDays ?? null)
            : null,
        senderEmail: principal.user.email,
        senderName: principal.user.name,
        userAgent: context.userAgent,
      },
      { database },
    );

    return {
      documentId: envelopeId,
      expiresAt: sent.expiresAt ?? null,
      signLink: sent.signingUrl ?? null,
      signerId,
      status: "sent",
    };
  } catch (error) {
    // Nothing half-made is left behind: the draft goes if it was not sent.
    await deleteDraftEnvelope(userId, envelopeId, { database }).catch(
      () => undefined,
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

type EnvelopeStatusRow = {
  companyRef: string | null;
  completedAt: number | null;
  createdAt: number;
  declinedAt: number | null;
  deliveryChannel: "email" | "link";
  expiresAt: number | null;
  externalRef: string | null;
  id: string;
  sentAt: number | null;
  status: "completed" | "declined" | "draft" | "sent" | "voided";
  title: string;
  voidedAt: number | null;
};

type SignerStatusRow = {
  declineReason: string | null;
  declinedAt: number | null;
  email: string;
  id: string;
  name: string;
  signOrder: number;
  signedAt: number | null;
  status: "declined" | "notified" | "pending" | "signed";
};

type SignerEventRow = {
  createdAt: number;
  event: "consented" | "viewed";
  signerId: string;
};

export type ApiDocumentStatus =
  "completed" | "declined" | "draft" | "expired" | "sent" | "voided";

export type ApiDocument = {
  channel: "email" | "link";
  companyRef: string | null;
  completedAt: string | null;
  createdAt: string;
  declinedAt: string | null;
  documentId: string;
  expiresAt: string | null;
  externalRef: string | null;
  sentAt: string | null;
  signers: Array<{
    consentedAt: string | null;
    declineReason: string | null;
    declinedAt: string | null;
    email: string | null;
    name: string;
    signedAt: string | null;
    signerId: string;
    status: "declined" | "pending" | "sent" | "signed" | "viewed";
    viewedAt: string | null;
  }>;
  status: ApiDocumentStatus;
  title: string;
  voidedAt: string | null;
};

function iso(timestamp: number | null | undefined): string | null {
  return typeof timestamp === "number"
    ? new Date(timestamp * 1000).toISOString()
    : null;
}

async function readOwnedEnvelope(
  userId: string,
  documentId: string,
  database: DbPool,
): Promise<EnvelopeStatusRow> {
  if (!z.string().uuid().safeParse(documentId).success) {
    throw new ApiDocumentError("Document not found.", 404);
  }

  const [envelope] = await queryMany<EnvelopeStatusRow>(
    database,
    `
      SELECT
        id,
        title,
        status,
        delivery_channel AS "deliveryChannel",
        external_ref AS "externalRef",
        company_ref AS "companyRef",
        created_at AS "createdAt",
        sent_at AS "sentAt",
        completed_at AS "completedAt",
        declined_at AS "declinedAt",
        voided_at AS "voidedAt",
        expires_at AS "expiresAt"
      FROM envelopes
      WHERE id = $1 AND user_id = $2
    `,
    [documentId, userId],
  );

  if (!envelope) {
    throw new ApiDocumentError("Document not found.", 404);
  }

  return envelope;
}

export async function getApiDocument(
  principal: ApiKeyPrincipal,
  documentId: string,
  database: DbPool,
  now = Math.floor(Date.now() / 1000),
): Promise<ApiDocument> {
  const envelope = await readOwnedEnvelope(
    principal.user.id,
    documentId,
    database,
  );
  const [signers, events] = await Promise.all([
    queryMany<SignerStatusRow>(
      database,
      `
        SELECT
          id,
          name,
          email,
          sign_order AS "signOrder",
          status,
          signed_at AS "signedAt",
          declined_at AS "declinedAt",
          decline_reason AS "declineReason"
        FROM signers
        WHERE envelope_id = $1
          AND sign_order < 500
        ORDER BY sign_order
      `,
      [envelope.id],
    ),
    queryMany<SignerEventRow>(
      database,
      `
        SELECT
          event,
          metadata->>'signerId' AS "signerId",
          min(created_at) AS "createdAt"
        FROM audit_events
        WHERE envelope_id = $1
          AND event IN ('viewed', 'consented')
          AND metadata->>'signerId' IS NOT NULL
        GROUP BY event, metadata->>'signerId'
      `,
      [envelope.id],
    ),
  ]);
  const firstEvent = (signerId: string, event: SignerEventRow["event"]) =>
    events.find((row) => row.signerId === signerId && row.event === event)
      ?.createdAt ?? null;

  const expired =
    envelope.status === "sent" &&
    envelope.expiresAt !== null &&
    envelope.expiresAt <= now;

  return {
    channel: envelope.deliveryChannel,
    companyRef: envelope.companyRef,
    completedAt: iso(envelope.completedAt),
    createdAt: iso(envelope.createdAt)!,
    declinedAt: iso(envelope.declinedAt),
    documentId: envelope.id,
    expiresAt: iso(envelope.expiresAt),
    externalRef: envelope.externalRef,
    sentAt: iso(envelope.sentAt),
    signers: signers.map((signer) => {
      const viewedAt = firstEvent(signer.id, "viewed");

      return {
        consentedAt: iso(firstEvent(signer.id, "consented")),
        declineReason: signer.declineReason,
        declinedAt: iso(signer.declinedAt),
        email: displayEmail(signer.email) || null,
        name: signer.name,
        signedAt: iso(signer.signedAt),
        signerId: signer.id,
        status:
          signer.status === "signed" || signer.status === "declined"
            ? signer.status
            : signer.status === "pending"
              ? "pending"
              : viewedAt
                ? "viewed"
                : "sent",
        viewedAt: iso(viewedAt),
      };
    }),
    status: expired ? "expired" : envelope.status,
    title: envelope.title,
    voidedAt: iso(envelope.voidedAt),
  };
}

// ---------------------------------------------------------------------------
// New link, reminder, cancel
// ---------------------------------------------------------------------------

type CurrentSignerRow = {
  email: string;
  id: string;
  name: string;
  signOrder: number;
};

/**
 * Issues a new signing link for the signer whose turn it is, and returns it.
 * The previous link stops working. Nothing is emailed: the caller passes the
 * link on. Recorded in the audit trail as a manual reminder.
 */
export async function issueNewSigningLink(
  principal: ApiKeyPrincipal,
  documentId: string,
  context: RequestContext,
  database: DbPool,
): Promise<{ expiresAt: string | null; signLink: string; signerId: string }> {
  const userId = principal.user.id;

  return withTransaction(async (tx) => {
    const [envelope] = await queryMany<{
      expiresAt: number | null;
      status: string;
    }>(
      tx,
      `
        SELECT status, expires_at AS "expiresAt"
        FROM envelopes
        WHERE id = $1 AND user_id = $2
        FOR NO KEY UPDATE
      `,
      [documentId, userId],
    );

    if (!envelope) {
      throw new ApiDocumentError("Document not found.", 404);
    }

    if (envelope.status !== "sent") {
      throw new ApiDocumentError(
        "This document is no longer waiting for a signature.",
        409,
      );
    }

    const now = Math.floor(Date.now() / 1000);

    if (envelope.expiresAt !== null && envelope.expiresAt <= now) {
      throw new ApiDocumentError(
        "This document's deadline has passed. Send it again.",
        409,
      );
    }

    const [signer] = await queryMany<CurrentSignerRow>(
      tx,
      `
        SELECT id, name, email, sign_order AS "signOrder"
        FROM signers
        WHERE envelope_id = $1 AND status = 'notified'
        ORDER BY sign_order
        LIMIT 1
        FOR NO KEY UPDATE
      `,
      [documentId],
    );

    if (!signer) {
      throw new ApiDocumentError(
        "This document is no longer waiting for a signature.",
        409,
      );
    }

    const link = await issueSigningLink({
      expiresInSeconds:
        envelope.expiresAt !== null ? envelope.expiresAt - now : undefined,
      issuedAt: now,
    });

    await tx.query(
      `
        UPDATE signers
        SET
          signing_token_hash = $1,
          signing_token_expires_at = $2,
          last_nudged_at = $3,
          updated_at = $3
        WHERE id = $4 AND envelope_id = $5
      `,
      [link.tokenHash, link.exp, now, signer.id, documentId],
    );
    await tx.query(`UPDATE envelopes SET updated_at = $1 WHERE id = $2`, [
      now,
      documentId,
    ]);
    await recordAuditEvent(
      {
        actorEmail: principal.user.email,
        actorType: "sender",
        createdAt: now,
        envelopeId: documentId,
        event: "reminded_manual",
        ipAddress: context.ipAddress,
        metadata: {
          deliveryChannel: "link",
          newLink: true,
          signerEmail: signer.email,
          signerId: signer.id,
          signerName: signer.name,
          signerOrder: signer.signOrder,
        },
        userAgent: context.userAgent,
      },
      tx,
    );

    return {
      expiresAt: iso(envelope.expiresAt),
      signLink: link.url,
      signerId: signer.id,
    };
  }, database);
}

/**
 * Reminds the signer. On the email channel, a reminder email goes out (with a
 * new link). On the link channel nothing can be sent from here, so a new link
 * is issued and returned for the caller to pass on.
 */
export async function remindApiDocument(
  principal: ApiKeyPrincipal,
  documentId: string,
  context: RequestContext,
  database: DbPool,
): Promise<{ channel: "email" | "link"; signLink: string | null }> {
  const envelope = await readOwnedEnvelope(
    principal.user.id,
    documentId,
    database,
  );

  if (envelope.deliveryChannel === "link") {
    const issued = await issueNewSigningLink(
      principal,
      documentId,
      context,
      database,
    );

    return { channel: "link", signLink: issued.signLink };
  }

  await sendManualEnvelopeNudge(
    principal.user.id,
    documentId,
    {
      ipAddress: context.ipAddress,
      senderEmail: principal.user.email,
      senderName: principal.user.name,
      userAgent: context.userAgent,
    },
    { database },
  );

  return { channel: "email", signLink: null };
}

export async function cancelApiDocument(
  principal: ApiKeyPrincipal,
  documentId: string,
  reason: string | null,
  context: RequestContext,
  database: DbPool,
): Promise<{ voidedAt: string | null }> {
  const envelope = await readOwnedEnvelope(
    principal.user.id,
    documentId,
    database,
  );

  if (envelope.status === "voided") {
    return { voidedAt: iso(envelope.voidedAt) };
  }

  const result = await voidSentEnvelope(
    principal.user.id,
    documentId,
    {
      ipAddress: context.ipAddress,
      reason,
      senderEmail: principal.user.email,
      senderName: principal.user.name,
      userAgent: context.userAgent,
    },
    { database },
  );

  return { voidedAt: iso(result.voidedAt) };
}

/** Maps the errors of the functions above to a status and a message. */
export function describeApiError(
  error: unknown,
): { message: string; status: number } | null {
  if (error instanceof ApiDocumentError) {
    return { message: error.message, status: error.statusCode };
  }

  if (error instanceof EnvelopeMutationError) {
    return { message: error.message, status: error.statusCode };
  }

  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";

    return {
      message: `${where}${issue?.message ?? "Invalid request."}`,
      status: 400,
    };
  }

  if (error instanceof ReminderMutationError) {
    return { message: error.message, status: error.statusCode };
  }

  if (error instanceof DocumentBrandingError) {
    return { message: error.message, status: 400 };
  }

  if (error instanceof DocumentImportError) {
    return { message: error.message, status: 400 };
  }

  return null;
}
