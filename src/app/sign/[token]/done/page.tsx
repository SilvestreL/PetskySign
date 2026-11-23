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
import { getBranding } from "@/lib/settings";

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
