"use client";

import { Brand } from "@/components/layout/brand";
import { PublicLegalFooter } from "@/components/layout/public-legal-links";
import { useBranding } from "@/components/layout/branding-provider";
import { tr } from "@/lib/petsky/locale";
import { useRouter } from "next/navigation";
import { useState } from "react";

type SigningDoneShellProps = {
  /**
   * PetskySign: "link" when the signer was not reached by email, so no
   * email with the signed copy is coming either.
   */
  deliveryChannel?: "email" | "link";
  envelopeTitle?: string | null;
  /**
   * PetskySign: what this signer can see and download now, from their
   * signing link (see signer-completion.ts). Null when the link no longer
   * matches a signer: the page then only confirms the signature.
   */
  completion?: {
    awaitingCount: number;
    certificateUrl: string | null;
    /** Set when the copy needs the CPF again first (POST it here). */
    copyUnlockUrl?: string | null;
    completedAtLabel: string | null;
    downloadUntilLabel: string | null;
    signedAtLabel: string | null;
    signedPdfSha256: string | null;
    signedPdfUrl: string | null;
    signerName: string;
  } | null;
};

export function SigningDoneShell({
  completion = null,
  deliveryChannel = "email",
  envelopeTitle,
}: SigningDoneShellProps) {
  const { productName } = useBranding();
  const resolvedEnvelopeTitle =
    envelopeTitle && envelopeTitle.trim().length > 0
      ? envelopeTitle.trim()
      : tr("this document");

  return (
    <div className="flex min-h-screen flex-col">
      <header>
        <div className="page-width flex items-center py-4">
          <Brand href="/" />
        </div>
      </header>

      <main className="page-width flex flex-1 items-center justify-center py-10">
        <section
          className="panel w-full max-w-[640px] px-6 py-12 text-center sm:px-12 sm:py-16"
          data-animate="enter"
        >
          <div
            aria-hidden="true"
            className="mx-auto inline-flex size-[4.5rem] items-center justify-center rounded-full bg-(--success-soft)"
          >
            <svg
              className="size-9 text-(--success)"
              fill="none"
              viewBox="0 0 36 36"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10 18.5L15.25 23.75L26.5 12.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
            </svg>
          </div>

          {completion?.signedPdfUrl ? (
            <CompletedDetails
              completion={completion}
              title={resolvedEnvelopeTitle}
            />
          ) : (
            <>
              <h1 className="mt-7 text-[clamp(1.875rem,4.5vw,2.375rem)] font-extrabold tracking-[-0.035em] text-(--fg)">
                {tr("You're all done.")}
              </h1>
              <p className="mx-auto mt-4 max-w-[480px] text-base leading-7 text-(--secondary)">
                {tr('Your signature has been recorded for "{title}".', {
                  title: resolvedEnvelopeTitle,
                })}
              </p>
              {completion && completion.awaitingCount > 0 ? (
                <p className="mx-auto mt-3 max-w-[480px] text-base leading-7 text-(--secondary)">
                  {completion.awaitingCount === 1
                    ? tr(
                        "One more person still has to sign. When they do, open this same link again to download the signed document.",
                      )
                    : tr(
                        "{count} more people still have to sign. When they do, open this same link again to download the signed document.",
                        { count: completion.awaitingCount },
                      )}
                </p>
              ) : (
                <p className="mx-auto mt-3 max-w-[480px] text-base leading-7 text-(--secondary)">
                  {deliveryChannel === "link"
                    ? tr(
                        "{business} will send you the signed document once all parties have signed.",
                        { business: productName },
                      )
                    : tr(
                        "You'll receive an email with the signed document once all parties have signed.",
                      )}
                </p>
              )}
              <p className="mt-8 inline-flex rounded-full bg-(--surface) px-4 py-2 text-sm font-semibold text-(--secondary)">
                {tr("You can close this tab.")}
              </p>
            </>
          )}
        </section>
      </main>

      <PublicLegalFooter />
    </div>
  );
}

type Completion = NonNullable<SigningDoneShellProps["completion"]>;

/** PetskySign: everyone has signed; the signer can take their copy. */
function CompletedDetails({
  completion,
  title,
}: {
  completion: Completion;
  title: string;
}) {
  return (
    <>
      <h1 className="mt-7 text-[clamp(1.875rem,4.5vw,2.375rem)] font-extrabold tracking-[-0.035em] text-(--fg)">
        {tr("Document signed")}
      </h1>
      <p className="mx-auto mt-4 max-w-[480px] text-base leading-7 text-(--secondary)">
        {tr('Everyone has signed "{title}". Download your copy below.', {
          title,
        })}
      </p>

      <dl className="mx-auto mt-8 max-w-[480px] space-y-3 rounded-2xl bg-(--surface) px-5 py-4 text-left text-sm">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-(--secondary)">{tr("Signed by")}</dt>
          <dd className="font-semibold text-(--fg)">{completion.signerName}</dd>
        </div>
        {completion.signedAtLabel ? (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="text-(--secondary)">{tr("Your signature")}</dt>
            <dd className="font-semibold text-(--fg)">
              {completion.signedAtLabel}
            </dd>
          </div>
        ) : null}
        {completion.completedAtLabel ? (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="text-(--secondary)">{tr("Finished")}</dt>
            <dd className="font-semibold text-(--fg)">
              {completion.completedAtLabel}
            </dd>
          </div>
        ) : null}
      </dl>

      {completion.copyUnlockUrl ? (
        <CopyUnlockForm url={completion.copyUnlockUrl} />
      ) : (
        <div className="mx-auto mt-6 flex max-w-[480px] flex-col gap-3 sm:flex-row sm:justify-center">
          <a
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-(--accent) px-5 text-[0.9375rem] font-semibold text-white transition hover:bg-(--accent-hover)"
            download
            href={completion.signedPdfUrl ?? undefined}
          >
            {tr("Download signed document")}
          </a>
          {completion.certificateUrl ? (
            <a
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-(--border-strong) bg-(--paper) px-5 text-[0.9375rem] font-semibold text-(--fg) transition hover:border-(--border-hover)"
              download
              href={completion.certificateUrl}
            >
              {tr("Download certificate")}
            </a>
          ) : null}
        </div>
      )}

      {completion.signedPdfSha256 ? (
        <div className="mx-auto mt-8 max-w-[480px] rounded-2xl border border-(--border) px-5 py-4 text-left">
          <p className="text-sm font-semibold text-(--fg)">
            {tr("Verification code (SHA-256)")}
          </p>
          <p className="mt-2 font-mono text-xs leading-5 break-all text-(--secondary)">
            {completion.signedPdfSha256}
          </p>
          <p className="mt-3 text-sm text-(--secondary)">
            {tr(
              "Anyone can check that a copy of this document is authentic at",
            )}{" "}
            <a
              className="font-semibold text-(--accent-ink) underline underline-offset-4"
              href="/verify"
            >
              {tr("Verify a document")}
            </a>
            .
          </p>
        </div>
      ) : null}

      {completion.downloadUntilLabel ? (
        <p className="mx-auto mt-6 max-w-[480px] text-xs leading-5 text-(--tertiary)">
          {tr(
            "These downloads stay available on this link until {date}. Save your copy.",
            { date: completion.downloadUntilLabel },
          )}
        </p>
      ) : null}
    </>
  );
}

/** The CPF again before the copy downloads: a forwarded link alone gets no file. */
function CopyUnlockForm({ url }: { url: string }) {
  const router = useRouter();
  const [cpf, setCpf] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch(url, {
      body: JSON.stringify({ cpf }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }).catch(() => null);
    setBusy(false);

    if (response?.ok) {
      router.refresh();
      return;
    }

    const body = (await response?.json().catch(() => null)) as {
      error?: string;
    } | null;
    setError(body?.error ?? tr("Something went wrong. Try again."));
  }

  return (
    <form
      className="mx-auto mt-6 flex max-w-[480px] flex-col gap-3 text-left"
      onSubmit={submit}
    >
      <label className="text-sm font-semibold text-(--fg)" htmlFor="copy-cpf">
        {tr("To download your copy, type your CPF")}
      </label>
      <input
        autoComplete="off"
        className="min-h-12 rounded-xl border border-(--border-strong) bg-(--paper) px-4 text-base text-(--fg)"
        id="copy-cpf"
        inputMode="numeric"
        onChange={(event) => setCpf(event.target.value)}
        placeholder="000.000.000-00"
        value={cpf}
      />
      {error ? (
        <p className="rounded-xl bg-(--danger-soft,#fdecec) px-4 py-3 text-sm font-semibold text-(--danger,#b42318)">
          {error}
        </p>
      ) : null}
      <button
        className="inline-flex min-h-12 items-center justify-center rounded-xl bg-(--accent) px-5 text-[0.9375rem] font-semibold text-white transition hover:bg-(--accent-hover) disabled:opacity-60"
        disabled={busy || cpf.replace(/\D/g, "").length !== 11}
        type="submit"
      >
        {tr("Continue")}
      </button>
    </form>
  );
}
