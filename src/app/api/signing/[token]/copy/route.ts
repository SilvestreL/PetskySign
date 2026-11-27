import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/connection";
import { tr } from "@/lib/petsky/locale";
import {
  CopyUnlockError,
  unlockSignerCopy,
} from "@/lib/petsky/signer-completion";
import { logRouteError } from "@/lib/security/logging";
import {
  applyRateLimit,
  buildRateLimitKey,
} from "@/lib/security/route-controls";
import { getClientIpAddress } from "@/lib/security/request";
import { hashOpaqueToken } from "@/lib/services/opaque-tokens";
import {
  buildVerificationCookieValue,
  verificationCookieName,
} from "@/lib/signer-checks";
import { resolveAppUrl } from "@/lib/utils/env";

// PetskySign: the CPF again, to download the signed copy from the signing
// link (signer-completion.ts). Passing sets the same verification cookie the
// check before signing sets, so the download routes accept this browser.

type CopyRouteContext = { params: Promise<{ token: string }> };

const NO_STORE = { "cache-control": "private, no-store" };

export async function POST(request: Request, context: CopyRouteContext) {
  const { token } = await context.params;
  const rateLimitResponse = await applyRateLimit({
    category: "signing_verify",
    key: buildRateLimitKey(["signing-copy", token]),
    limit: 10,
    message: "Too many tries. Wait a few minutes and try again.",
    request,
    windowMs: 15 * 60 * 1000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await unlockSignerCopy(token, await request.json().catch(() => null), {
      database: getDb(),
    });

    const tokenHash = hashOpaqueToken(token);
    const cookie = buildVerificationCookieValue(tokenHash, ["identity"]);
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });

    response.cookies.set(verificationCookieName(tokenHash), cookie.value, {
      httpOnly: true,
      maxAge: cookie.maxAge,
      path: "/",
      sameSite: "lax",
      secure: resolveAppUrl()?.startsWith("https://") ?? false,
    });

    return response;
  } catch (error) {
    if (error instanceof CopyUnlockError) {
      return NextResponse.json(
        { error: tr(error.message, error.params) },
        { headers: NO_STORE, status: error.statusCode },
      );
    }

    logRouteError(error, {
      category: "public_download_failure",
      ipAddress: getClientIpAddress(request.headers),
      message: "Unexpected failure while unlocking a signer copy.",
      path: new URL(request.url).pathname.replace(token, "[token]"),
    });

    return NextResponse.json(
      { error: tr("Something went wrong. Try again.") },
      { headers: NO_STORE, status: 500 },
    );
  }
}
