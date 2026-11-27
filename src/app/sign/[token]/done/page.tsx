import { BrandingProvider } from "@/components/layout/branding-provider";
import { SigningDoneShell } from "@/components/signing/signing-done-shell";
import { getDb } from "@/lib/db/connection";
import {
  applyDocumentBranding,
  getDocumentBranding,
} from "@/lib/petsky/document-branding";
import {
  formatCompletionDate,
  getSignerCompletionForToken,
} from "@/lib/petsky/signer-completion";
import { hashOpaqueToken } from "@/lib/services/opaque-tokens";
import { getBranding } from "@/lib/settings";
import {
  readVerifiedMethods,
  verificationCookieName,
} from "@/lib/signer-checks";
import { cookies } from "next/headers";

type SignDonePageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{
    d?: string | string[];
    title?: string | string[];
  }>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignDonePage({
  params,
  searchParams,
}: SignDonePageProps) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const database = getDb();
  // PetskySign: what this signer may see and download now, found from their
  // signing link (signer-completion.ts). The query string is only a fallback
  // for the title when the link no longer matches a signer.
  const completion = await getSignerCompletionForToken(token, {
    database,
  }).catch(() => null);
  const envelopeId = completion?.envelopeId ?? first(resolvedSearchParams?.d);
  const documentBranding = envelopeId
    ? await getDocumentBranding(envelopeId, database).catch(() => null)
    : null;
  const downloadBase = `/api/signing/${encodeURIComponent(token)}/download`;
  // The sender asked for the CPF: the copy needs it again in this browser.
  const tokenHash = hashOpaqueToken(token);
  const copyLocked =
    completion?.identityRequired === true &&
    !readVerifiedMethods(
      tokenHash,
      (await cookies()).get(verificationCookieName(tokenHash))?.value,
    ).includes("identity");

  return (
    <BrandingProvider
      branding={applyDocumentBranding(await getBranding(), documentBranding)}
    >
      <SigningDoneShell
        completion={
          completion
            ? {
                awaitingCount: completion.awaitingCount,
                certificateUrl: completion.downloadAvailable
                  ? `${downloadBase}/certificate`
                  : null,
                copyUnlockUrl: copyLocked
                  ? `/api/signing/${encodeURIComponent(token)}/copy`
                  : null,
                completedAtLabel: completion.completedAt
                  ? formatCompletionDate(completion.completedAt)
                  : null,
                downloadUntilLabel: completion.downloadUntil
                  ? formatCompletionDate(completion.downloadUntil)
                  : null,
                signedAtLabel: completion.signedAt
                  ? formatCompletionDate(completion.signedAt)
                  : null,
                signedPdfSha256: completion.signedPdfSha256,
                signedPdfUrl: completion.downloadAvailable
                  ? `${downloadBase}/signed`
                  : null,
                signerName: completion.signerName,
              }
            : null
        }
        deliveryChannel={documentBranding?.deliveryChannel ?? "email"}
        envelopeTitle={completion?.title ?? first(resolvedSearchParams?.title)}
      />
    </BrandingProvider>
  );
}
