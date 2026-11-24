"use client";

import { ShieldCheckIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Brand } from "@/components/layout/brand";
import { PublicLegalFooter } from "@/components/layout/public-legal-links";
import { FieldShell, ShellButton } from "@/components/shared/form-shell";
import { tr } from "@/lib/petsky/locale";
import type { SigningVerificationState } from "@/lib/schemas/signing";

type Method = SigningVerificationState["required"][number];

const METHOD_COPY: Record<Method, { helper: string; label: string }> = {
  access_code: {
    helper: "The sender gave you this code separately, for example by phone.",
    label: "Access code",
  },
  account: {
    helper:
      "This document is signed with your own account here. Enter the password you sign in with.",
    label: "Password",
  },
  email_code: {
    helper: "We email a 6-digit code to the address this document was sent to.",
    label: "Code from your email",
  },
  // PetskySign: a code sent by WhatsApp to the number the sender has.
  whatsapp_code: {
    helper: "We send a 6-digit code to your WhatsApp.",
    label: "Code from your WhatsApp",
  },
  // PetskySign: full name and CPF, checked against the CPF the sender has.
  identity: {
    helper: "The CPF must be the one the sender has for you.",
    label: "CPF",
  },
};

/** "07822016489" as "078.220.164-89" while it is typed. */
function formatCpfInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);

  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

export function SignerVerificationScreen({
  state,
  token,
}: {
  state: SigningVerificationState;
  token: string;
}) {
  const method = state.pending[0]!;
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    state.emailCodeSentAt && method === "email_code"
      ? tr("A code was sent to {maskedEmail}.", {
          maskedEmail: state.maskedEmail,
        })
      : state.whatsappCodeSentAt && method === "whatsapp_code"
        ? tr("A code was sent to the WhatsApp {phone}.", {
            phone: state.maskedPhone ?? "",
          })
        : null,
  );
  const [isChecking, setIsChecking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const base = `/api/signing/${encodeURIComponent(token)}`;

  async function sendCode() {
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch(
        `${base}/verify/${method === "whatsapp_code" ? "whatsapp-code" : "email-code"}`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        maskedEmail?: string;
        maskedPhone?: string;
      } | null;

      if (!response.ok) {
        setError(payload?.error ?? tr("The code could not be sent right now."));
        return;
      }

      setNotice(
        method === "whatsapp_code"
          ? tr("A code was sent to the WhatsApp {phone}.", {
              phone: payload?.maskedPhone ?? state.maskedPhone ?? "",
            })
          : tr("A code was sent to {maskedEmail}.", {
              maskedEmail: payload?.maskedEmail ?? state.maskedEmail,
            }),
      );
    } catch {
      setError(tr("The code could not be sent right now."));
    } finally {
      setIsSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsChecking(true);
    setError(null);

    try {
      const response = await fetch(`${base}/verify`, {
        body: JSON.stringify(
          method === "account"
            ? { email, method, password: code }
            : method === "identity"
              ? { cpf: code, fullName, method }
              : { code, method },
        ),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setError(
          payload?.error ?? tr("The code could not be checked right now."),
        );
        return;
      }

      // The page reads the new cookie and shows the next check or the
      // document.
      window.location.reload();
    } catch {
      setError(tr("The code could not be checked right now."));
    } finally {
      setIsChecking(false);
    }
  }

  const copy = METHOD_COPY[method];
  const step = state.required.indexOf(method) + 1;

  return (
    <div className="flex min-h-screen flex-col">
      <header>
        <div className="page-width flex items-center py-4">
          <Brand href="/" />
        </div>
      </header>
      <main className="page-width flex flex-1 items-center justify-center py-10">
        <section
          className="panel w-full max-w-[560px] px-6 py-10 sm:px-10 sm:py-12"
          data-animate="enter"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-14 items-center justify-center rounded-2xl bg-(--accent-soft) text-(--accent)"
          >
            <ShieldCheckIcon className="size-6" strokeWidth={2.2} />
          </span>
          <h1 className="mt-6 text-[clamp(1.625rem,4vw,2rem)] font-extrabold leading-tight tracking-[-0.03em] text-(--fg)">
            {tr("Confirm it's you")}
          </h1>
          <p className="mt-3 text-base leading-7 text-(--secondary)">
            {tr("{sender} asked for a check before you open “{title}”.", {
              sender: state.senderName,
              title: state.envelopeTitle,
            })}
            {state.required.length > 1
              ? ` ${tr("Step {step} of {count}.", { count: state.required.length, step })}`
              : ""}
          </p>
          <form className="mt-8 grid gap-5" onSubmit={handleSubmit}>
            {method === "account" ? (
              <FieldShell
                autoComplete="username"
                helper={tr("The address this document was sent to ({email}).", {
                  email: state.maskedEmail,
                })}
                label={tr("Email address")}
                name="signer-email"
                onChange={(event) => setEmail(event.target.value)}
                readOnly={false}
                type="email"
                value={email}
              />
            ) : null}
            {method === "identity" ? (
              <FieldShell
                autoComplete="name"
                helper={tr("As it is on your documents.")}
                label={tr("Full name")}
                name="signer-full-name"
                onChange={(event) => setFullName(event.target.value)}
                readOnly={false}
                type="text"
                value={fullName}
              />
            ) : null}
            <FieldShell
              autoComplete={
                method === "account"
                  ? "current-password"
                  : method === "identity"
                    ? "off"
                    : "one-time-code"
              }
              helper={tr(copy.helper)}
              label={tr(copy.label)}
              inputMode={method === "identity" ? "numeric" : undefined}
              name="signer-code"
              onChange={(event) =>
                setCode(
                  method === "identity"
                    ? formatCpfInput(event.target.value)
                    : event.target.value,
                )
              }
              placeholder={method === "identity" ? "000.000.000-00" : undefined}
              readOnly={false}
              type={method === "account" ? "password" : "text"}
              value={code}
            />
            {notice ? (
              <p className="notice notice-accent" role="status">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className="notice notice-danger" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              <ShellButton
                disabled={
                  code.trim().length === 0 ||
                  (method === "account" && email.trim().length === 0) ||
                  (method === "identity" && fullName.trim().length === 0)
                }
                loading={isChecking}
                type="submit"
              >
                {tr("Continue")}
              </ShellButton>
              {method === "email_code" || method === "whatsapp_code" ? (
                <ShellButton
                  loading={isSending}
                  onClick={sendCode}
                  variant="secondary"
                >
                  {notice
                    ? tr("Send a new code")
                    : method === "whatsapp_code"
                      ? tr("Send me a code on WhatsApp")
                      : tr("Email me a code")}
                </ShellButton>
              ) : null}
            </div>
          </form>
        </section>
      </main>
      <PublicLegalFooter />
    </div>
  );
}
