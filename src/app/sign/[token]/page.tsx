import type { Metadata } from "next";
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
import { getIpLocation } from "@/lib/petsky/location";
import { getLinkPreviewForToken } from "@/lib/petsky/link-preview";
import { tr } from "@/lib/petsky/locale";
import { resolveAppUrl } from "@/lib/utils/env";

type SignPageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{ signatureProblem?: string | string[] }>;
};

// PetskySign: what WhatsApp and the like show for the link: the document,
// who sent it and their logo. Reading it records nothing.
export async function generateMetadata({
  params,
}: Pick<SignPageProps, "params">): Promise<Metadata> {
  const { token } = await params;
  const preview = await getLinkPreviewForToken(token, getDb()).catch(
    () => null,
  );

  if (!preview) {
    return { robots: { follow: false, index: false } };
  }

  const sender = preview.name?.trim() || "Petsky";
  const description = tr(
    "{sender} sent you this document to sign electronically.",
    { sender },
  );
  const appUrl = resolveAppUrl();
  const image = appUrl
    ? new URL(
        `/api/brand/link-preview/${encodeURIComponent(preview.envelopeId)}`,
        appUrl,
      ).toString()
    : undefined;

  return {
    description,
    openGraph: {
      description,
      images: image
        ? [{ alt: sender, height: 630, url: image, width: 1200 }]
        : undefined,
      siteName: sender,
      title: preview.title,
      type: "website",
    },
    robots: { follow: false, index: false },
    title: `${preview.title} - ${sender}`,
    twitter: {
      card: image ? "summary_large_image" : "summary",
      description,
      images: image ? [image] : undefined,
      title: preview.title,
    },
  };
}

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
        location: getIpLocation(requestHeaders),
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
