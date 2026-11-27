import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/connection";
import { createDownloadResponse } from "@/lib/download-response";
import {
  DownloadAccessError,
  getSignerEnvelopeDownload,
} from "@/lib/downloads";
import { tr } from "@/lib/petsky/locale";
import { getSignerCompletionForToken } from "@/lib/petsky/signer-completion";
import { logRouteError } from "@/lib/security/logging";
import {
  applyRateLimit,
  buildRateLimitKey,
} from "@/lib/security/route-controls";
import { getClientIpAddress } from "@/lib/security/request";
import { verifiedMethodsForRequest } from "@/lib/signing-route";

// PetskySign: the signed PDF ("signed") or certificate ("certificate") for
// the signer whose signing link this is, offered on the page they land on
// after signing. signer-completion.ts says for how long.
type SignerDownloadRouteContext = {
  params: Promise<{
    fileType: string;
    token: string;
  }>;
};

/** The address names the files; downloads.ts calls the certificate "evidence". */
const FILE_TYPES: Record<string, "evidence" | "signed"> = {
  certificate: "evidence",
  signed: "signed",
};

function textResponse(message: string, status: number) {
  return new NextResponse(message, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
    },
    status,
  });
}

export async function GET(
  request: Request,
  context: SignerDownloadRouteContext,
) {
  const { fileType, token } = await context.params;
  const rateLimitResponse = await applyRateLimit({
    category: "public_download",
    key: buildRateLimitKey([
      "signer-download",
      token,
      getClientIpAddress(request.headers) ?? "unknown",
    ]),
    limit: 20,
    request,
    windowMs: 10 * 60 * 1000,
  });

  if (rateLimitResponse) {
    return textResponse(tr("Too many requests. Please try again soon."), 429);
  }

  const unavailable = tr(
    "This download is no longer available. Ask the business that sent the document for a copy.",
  );

  const downloadFileType = Object.hasOwn(FILE_TYPES, fileType)
    ? FILE_TYPES[fileType]
    : undefined;

  if (!downloadFileType) {
    return textResponse(unavailable, 404);
  }

  try {
    const database = getDb();
    const completion = await getSignerCompletionForToken(token, { database });

    if (!completion?.downloadAvailable) {
      return textResponse(unavailable, 410);
    }

    // The sender asked for the CPF: a forwarded link alone gets no file.
    if (
      completion.identityRequired &&
      !verifiedMethodsForRequest(token, request).includes("identity")
    ) {
      return textResponse(
        tr("Confirm your CPF on the signing page to download your copy."),
        403,
      );
    }

    const download = await getSignerEnvelopeDownload(
      completion.signerId,
      completion.envelopeId,
      downloadFileType,
      { database },
    );

    return await createDownloadResponse(download);
  } catch (error) {
    if (error instanceof DownloadAccessError) {
      return textResponse(unavailable, error.statusCode);
    }

    logRouteError(error, {
      category: "public_download_failure",
      ipAddress: getClientIpAddress(request.headers),
      message: "Unexpected failure while starting a signer download.",
      path: new URL(request.url).pathname.replace(token, "[token]"),
    });

    return textResponse(tr("Unable to start this download."), 500);
  }
}
