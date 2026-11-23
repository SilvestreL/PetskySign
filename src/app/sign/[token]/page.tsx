import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { BrandingProvider } from "@/components/layout/branding-provider";
import { SigningShell } from "@/components/signing/signing-shell";
import { getDb } from "@/lib/db/connection";
import {
  applyDocumentBranding,
  getDocumentBranding,
  getDocumentBrandingForToken,
} from "@/lib/petsky/document-branding";
import { getSignerCompletionForToken } from "@/lib/petsky/signer-completion";
import { getBranding } from "@/lib/settings";
import { getClientIpAddress } from "@/lib/security/request";
import type { SigningVerificationState } from "@/lib/schemas/signing";
import { verifiedMethodsFromCookies } from "@/lib/signer-checks";
import {
  SigningAccessError,
  SigningVerificationRequiredError,
  getSigningPayloadForToken,
} from "@/lib/signing";

type SignPageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{ signatureProblem?: string | string[] }>;
};

const SIGNATURE_PROBLEMS = ["cancelled", "expired", "failed", "name"] as const;

export default async function SignPage({
  params,
  searchParams,
}: SignPageProps) {
  const { token } = await params;
  const { signatureProblem: problemParam } = await searchParams;
  const signatureProblem =
    SIGNATURE_PROBLEMS.find((problem) => problem === problemParam) ?? null;
  let initialState:
    "already-signed" | "declined" | "error" | "expired" | "voided" | undefined;
  let record: Awaited<ReturnType<typeof getSigningPayloadForToken>> | null =
    null;
  let verification: SigningVerificationState | null = null;

  try {
    const requestHeaders = await headers();
    const cookieStore = await cookies();

    record = await getSigningPayloadForToken(token, {
      database: getDb(),
      requestMeta: {
        ipAddress: getClientIpAddress(requestHeaders),
        userAgent: requestHeaders.get("user-agent")?.trim() ?? null,
      },
      verifiedMethods: verifiedMethodsFromCookies(
        token,
        (name) => cookieStore.get(name)?.value,
      ),
    });
  } catch (error) {
    if (error instanceof SigningVerificationRequiredError) {
      verification = error.details;
    } else if (error instanceof SigningAccessError) {
      initialState = error.state;
    } else {
      initialState = "error";
    }
  }

  // PetskySign: a signer who opens their link again after signing goes to
  // the page with their copy and its status (sign/[token]/done).
  if (
    initialState === "already-signed" ||
    (initialState === "expired" &&
      (await getSignerCompletionForToken(token, { database: getDb() })
        .then((completion) => completion?.signerStatus === "signed")
        .catch(() => false)))
  ) {
    redirect(`/sign/${encodeURIComponent(token)}/done`);
  }

  // PetskySign: the business that sent the document, over the install's
  // own name, logo and color.
  const documentBranding = record
    ? await getDocumentBranding(record.envelopeId, getDb())
    : await getDocumentBrandingForToken(token, getDb()).catch(() => null);

  return (
    <BrandingProvider
      branding={applyDocumentBranding(await getBranding(), documentBranding)}
    >
      <SigningShell
        initialState={initialState}
        key={token}
        record={record ?? undefined}
        signatureProblem={signatureProblem}
        token={token}
        verification={verification ?? undefined}
      />
    </BrandingProvider>
  );
}
