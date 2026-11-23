"use client";

import { useState } from "react";

import { FieldShell, ShellButton } from "@/components/shared/form-shell";
import { tr } from "@/lib/petsky/locale";

// Answers a signer who asks what is stored about them, or for it to be
// erased. Administrators only.

type ErasureResult = {
  deletedEnvelopes: number;
  removedFromDrafts: number;
  keptPart11?: { id: string; title: string }[];
  skippedInProgress: { id: string; title: string }[];
};

export function SignerDataPanel() {
  const [email, setEmail] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isErasing, setIsErasing] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    tone: "error" | "success";
  } | null>(null);
  const trimmed = email.trim();
  const exportHref = `/api/admin/signer-data?email=${encodeURIComponent(trimmed)}`;

  async function erase() {
    setIsErasing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/signer-data", {
        body: JSON.stringify({ confirmation, email: trimmed }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as
        (ErasureResult & { error?: string }) | null;

      if (!response.ok || !payload) {
        setMessage({
          text: payload?.error ?? tr("That request could not be completed."),
          tone: "error",
        });
        return;
      }

      const skipped = payload.skippedInProgress.length
        ? tr(
            " {length} envelope(s) still out for signature were left alone: void them first, then erase again.",
            { length: String(payload.skippedInProgress.length) },
          )
        : "";
      const kept = payload.keptPart11?.length
        ? tr(
            " {length} Part 11 record(s) were kept: they are deleted by hand only, once the rules that apply to them allow it.",
            { length: String(payload.keptPart11.length) },
          )
        : "";

      setMessage({
        text: tr(
          "Deleted {deletedEnvelopes} finished envelope(s) and removed the signer from {removedFromDrafts} draft(s).{skipped}{kept}",
          {
            deletedEnvelopes: String(payload.deletedEnvelopes),
            removedFromDrafts: String(payload.removedFromDrafts),
            skipped,
            kept,
          },
        ),
        tone: "success",
      });
      setConfirmation("");
    } catch {
      setMessage({
        text: tr("That request could not be completed."),
        tone: "error",
      });
    } finally {
      setIsErasing(false);
    }
  }

  return (
    <div className="space-y-5 border-t border-(--border) pt-8">
      <div className="space-y-2">
        <h3 className="text-lg font-extrabold tracking-[-0.02em] text-(--fg)">
          {tr("Signer data requests")}
        </h3>
        <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
          {tr(
            "When a signer asks what you hold about them, download it here. When they ask for it to be erased, you can delete every finished envelope they signed, with its files and audit trail. Signed records are often ones you must keep, so erase only when no law or open dispute requires them.",
          )}
        </p>
      </div>
      <div className="grid max-w-xl gap-4">
        <FieldShell
          label={tr("Signer's email")}
          name="signer-data-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder={tr("jane@company.com")}
          readOnly={false}
          type="email"
          value={email}
        />
        <a
          aria-disabled={trimmed.length === 0}
          className={`btn-quiet min-h-12 w-fit px-5 text-sm ${trimmed.length === 0 ? "pointer-events-none" : ""}`}
          download
          href={exportHref}
        >
          {tr("Download their data (JSON)")}
        </a>
        <FieldShell
          helper={tr(
            "Type the email again to confirm erasure. This cannot be undone.",
          )}
          label={tr("Confirm erasure")}
          name="signer-data-confirm"
          onChange={(event) => setConfirmation(event.target.value)}
          readOnly={false}
          value={confirmation}
        />
        <ShellButton
          className="w-fit border-[rgba(180,35,24,0.35)] text-(--danger) hover:border-(--danger) hover:bg-(--danger-soft) hover:text-(--danger)"
          disabled={
            trimmed.length === 0 ||
            confirmation.trim().toLowerCase() !== trimmed.toLowerCase()
          }
          loading={isErasing}
          onClick={erase}
          variant="secondary"
        >
          {tr("Erase this signer's records")}
        </ShellButton>
        {message ? (
          <p
            className={`notice ${message.tone === "error" ? "notice-danger" : "notice-success"}`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
