// PetskySign: sends the signer a one-time code by WhatsApp (see
// sendSignerWhatsappCode), as email-code/route.ts does by email.
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/connection";
import { logRouteError } from "@/lib/security/logging";
import {
  applyRateLimit,
  buildRateLimitKey,
} from "@/lib/security/route-controls";
import { getClientIpAddress } from "@/lib/security/request";
import {
  SigningAccessError,
  SigningMutationError,
  sendSignerWhatsappCode,
} from "@/lib/signing";
import { tr } from "@/lib/petsky/locale";
import { verifiedMethodsForRequest } from "@/lib/signing-route";

type WhatsappCodeRouteContext = {
  params: Promise<{
    token: string;
  }>;
};

const NO_STORE = { "cache-control": "private, no-store" };

export async function POST(
  request: Request,
  context: WhatsappCodeRouteContext,
) {
  const { token } = await context.params;
  const rateLimitResponse = await applyRateLimit({
    category: "signing_whatsapp_code",
    key: buildRateLimitKey(["signing-whatsapp-code", token]),
    limit: 5,
    message: "Several codes were sent already. Check your WhatsApp.",
    request,
    windowMs: 60 * 60 * 1000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    return NextResponse.json(
      await sendSignerWhatsappCode(token, {
        database: getDb(),
        verifiedMethods: verifiedMethodsForRequest(token, request),
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof SigningMutationError) {
      return NextResponse.json(
        { error: error.message },
        { headers: NO_STORE, status: error.statusCode },
      );
    }

    if (error instanceof SigningAccessError) {
      return NextResponse.json(
        { error: error.message, state: error.state },
        { headers: NO_STORE, status: error.statusCode },
      );
    }

    logRouteError(error, {
      category: "signing_whatsapp_code_failure",
      ipAddress: getClientIpAddress(request.headers),
      message: "Unexpected failure while sending a signer code by WhatsApp.",
      path: request.url,
    });

    return NextResponse.json(
      { error: tr("The code could not be sent right now.") },
      { headers: NO_STORE, status: 500 },
    );
  }
}
