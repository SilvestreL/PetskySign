"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { FieldShell, ShellButton } from "@/components/shared/form-shell";
import { BrandingPanel } from "@/components/settings/branding-panel";
import { Part11Panel } from "@/components/settings/part11-panel";
import { PeoplePanel } from "@/components/settings/people-panel";
import { SecurityPanel } from "@/components/settings/security-panel";
import { SignerDataPanel } from "@/components/settings/signer-data-panel";
import type { EmailDnsRecord, EmailStatus } from "@/lib/email-status";
import type {
  OrganizationSettingsField,
  OrganizationSettingsView,
} from "@/lib/organization-settings";
import type { SignupMode } from "@/lib/signup-policy";
import { tr } from "@/lib/petsky/locale";

// The administrator's part of Settings: what the install is called, who can
// sign up, where email comes from, and whether email works yet.

const GENERIC_ERROR_MESSAGE = tr("Something went wrong. Please try again.");
const RESEND_DOMAINS_URL = "https://resend.com/domains";
const RESEND_MARKETPLACE_URL = "https://vercel.com/marketplace/resend";

type OrganizationSettingsProps = {
  initialSettings: OrganizationSettingsView;
};

type FormErrors = Partial<Record<OrganizationSettingsField, string>>;

type Feedback = {
  message: string;
  tone: "error" | "success";
} | null;

type SettingsResponse = {
  error?: string;
  fieldErrors?: FormErrors;
  settings?: OrganizationSettingsView;
} | null;

type EmailResponse = {
  error?: string;
  status?: EmailStatus;
  test?: { sent: true; to: string } | { sent: false; message: string };
} | null;

type EmailAction = "add_domain" | "recheck" | "send_test";

const signupModeOptions: Array<{
  description: string;
  label: string;
  value: SignupMode;
}> = [
  {
    description: tr(
      "Only people whose email address is at one of your domains can create an account.",
    ),
    label: tr("People at my organization"),
    value: "domains",
  },
  {
    description: tr("Nobody new can create an account."),
    label: "Nobody",
    value: "closed",
  },
  {
    description: tr("Anyone who finds this site can create an account."),
    label: "Anyone",
    value: "open",
  },
];

export function OrganizationSettings({
  initialSettings,
}: OrganizationSettingsProps) {
  const router = useRouter();
  const [values, setValues] = useState(initialSettings);
  const [errors, setErrors] = useState<FormErrors>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Bumped after a save, so the email panel looks again: a new sender
  // address means a different domain to check.
  const [emailRevision, setEmailRevision] = useState(0);

  function handleChange(field: OrganizationSettingsField) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;

      setValues((currentValues) => ({ ...currentValues, [field]: nextValue }));
      setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
      setFeedback(null);
    };
  }

  function handleBrandColorChange(brandColor: string) {
    setValues((currentValues) => ({ ...currentValues, brandColor }));
    setErrors((currentErrors) => ({ ...currentErrors, brandColor: undefined }));
    setFeedback(null);
  }

  function handleSignupModeChange(signupMode: SignupMode) {
    setValues((currentValues) => ({ ...currentValues, signupMode }));
    setErrors((currentErrors) => ({
      ...currentErrors,
      allowedEmailDomains: undefined,
      signupMode: undefined,
    }));
    setFeedback(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setErrors({});
    setFeedback(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/admin/settings", {
        body: JSON.stringify({
          allowedEmailDomains: values.allowedEmailDomains,
          brandColor: values.brandColor,
          organizationName: values.organizationName,
          privacyUrl: values.privacyUrl,
          retentionDays: values.retentionDays,
          senderAddress: values.senderAddress,
          signupMode: values.signupMode,
          supportAddress: values.supportAddress,
          termsUrl: values.termsUrl,
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as SettingsResponse;

      if (!response.ok || !payload?.settings) {
        setErrors(payload?.fieldErrors ?? {});
        setFeedback({
          message: payload?.error ?? GENERIC_ERROR_MESSAGE,
          tone: "error",
        });
        return;
      }

      setValues(payload.settings);
      setEmailRevision((revision) => revision + 1);
      setFeedback({
        message: tr("Organization settings saved."),
        tone: "success",
      });
      // The header and the accent color come from the layout around this
      // page, which only looks them up again when asked to.
      router.refresh();
    } catch {
      setFeedback({ message: GENERIC_ERROR_MESSAGE, tone: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      className="panel scroll-mt-6 p-6 sm:p-8"
      data-animate="enter"
      data-animate-delay="2"
      id="organization"
    >
      <div className="space-y-8">
        <div className="space-y-2">
          <p className="section-eyebrow">{tr("Administrator")}</p>
          <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-(--fg)">
            {tr("Organization")}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
            {tr(
              "These settings apply to everyone who uses this site. Only you, the administrator, can see and change them.",
            )}
          </p>
        </div>

        {feedback ? (
          <p
            className={`notice ${
              feedback.tone === "success" ? "notice-success" : "notice-danger"
            }`}
            role={feedback.tone === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </p>
        ) : null}

        <form className="space-y-8" noValidate onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldShell
              disabled={isSaving}
              error={errors.organizationName}
              helper={tr(
                "Shown in the header and in every email this site sends.",
              )}
              label={tr("Organization name")}
              name="organization-name"
              onChange={handleChange("organizationName")}
              readOnly={false}
              value={values.organizationName}
            />
          </div>

          {/* The hosted service runs under its own name, mark and color. */}
          {!values.hosted ? (
            <BrandingPanel
              brandColor={values.brandColor}
              brandColorError={errors.brandColor}
              disabled={isSaving}
              logoUrl={values.logoUrl}
              onBrandColorChange={handleBrandColorChange}
              onLogoChange={(logoUrl) =>
                setValues((currentValues) => ({ ...currentValues, logoUrl }))
              }
            />
          ) : null}

          <fieldset className="space-y-4 border-t border-(--border) pt-8">
            <legend className="float-left mb-4 w-full text-lg font-extrabold tracking-[-0.02em] text-(--fg)">
              {tr("Who can create an account")}
            </legend>
            <p className="clear-both max-w-2xl text-sm leading-6 text-(--secondary)">
              {tr(
                "This is about people who send documents. People who are sent a document to sign never need an account.",
              )}
            </p>
            <div className="space-y-3">
              {signupModeOptions.map((option) => (
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-2xl bg-(--surface) px-4 py-3.5 ring-2 ring-transparent transition has-[:checked]:bg-(--accent-softer) has-[:checked]:ring-(--accent)"
                  key={option.value}
                >
                  <input
                    checked={values.signupMode === option.value}
                    className="mt-1 size-4 accent-(--accent)"
                    disabled={isSaving}
                    name="signup-mode"
                    onChange={() => handleSignupModeChange(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-bold text-(--fg)">
                      {option.label}
                    </span>
                    <span className="block text-sm leading-6 text-(--secondary)">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {values.signupMode === "domains" || errors.allowedEmailDomains ? (
              <div className="max-w-xl">
                <FieldShell
                  disabled={isSaving}
                  error={errors.allowedEmailDomains}
                  helper={tr("Separate several domains with commas.")}
                  label={tr("Email domains")}
                  name="allowed-email-domains"
                  onChange={handleChange("allowedEmailDomains")}
                  placeholder={tr("yourcompany.com")}
                  readOnly={false}
                  value={values.allowedEmailDomains}
                />
              </div>
            ) : null}
          </fieldset>

          <div className="space-y-5 border-t border-(--border) pt-8">
            <h3 className="text-lg font-extrabold tracking-[-0.02em] text-(--fg)">
              {tr("Email addresses")}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldShell
                disabled={isSaving || values.senderAddressFromEnv}
                error={errors.senderAddress}
                helper={
                  values.senderAddressFromEnv
                    ? tr("Set by the RESEND_FROM_EMAIL environment variable.")
                    : tr(
                        "The address emails come from, at a domain you own. A subdomain such as notifications@sign.yourcompany.com keeps this site's mail apart from your everyday email.",
                      )
                }
                label={tr("Send email from")}
                name="sender-address"
                onChange={handleChange("senderAddress")}
                placeholder={tr("sign@yourcompany.com")}
                readOnly={values.senderAddressFromEnv}
                type="email"
                value={values.senderAddress}
              />
              <FieldShell
                disabled={isSaving || values.supportAddressFromEnv}
                error={errors.supportAddress}
                helper={
                  values.supportAddressFromEnv
                    ? tr("Set by the SUPPORT_EMAIL environment variable.")
                    : tr("Where replies and questions from signers go.")
                }
                label={tr("Support address")}
                name="support-address"
                onChange={handleChange("supportAddress")}
                placeholder={tr("help@yourcompany.com")}
                readOnly={values.supportAddressFromEnv}
                type="email"
                value={values.supportAddress}
              />
            </div>
          </div>

          {!values.hosted ? (
            <div className="space-y-5 border-t border-(--border) pt-8">
              <div className="space-y-2">
                <h3 className="text-lg font-extrabold tracking-[-0.02em] text-(--fg)">
                  {tr("Your terms and privacy policy")}
                </h3>
                <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
                  {tr(
                    "Optional. Links to pages on your own website, shown in the footer of this site and of its emails.",
                  )}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldShell
                  disabled={isSaving}
                  error={errors.termsUrl}
                  label={tr("Terms link")}
                  name="terms-url"
                  onChange={handleChange("termsUrl")}
                  placeholder={tr("https://yourcompany.com/terms")}
                  readOnly={false}
                  value={values.termsUrl}
                />
                <FieldShell
                  disabled={isSaving}
                  error={errors.privacyUrl}
                  label={tr("Privacy policy link")}
                  name="privacy-url"
                  onChange={handleChange("privacyUrl")}
                  placeholder={tr("https://yourcompany.com/privacy")}
                  readOnly={false}
                  value={values.privacyUrl}
                />
              </div>
              <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
                {tr("Without a privacy policy link, signers see")}{" "}
                <a
                  className="font-semibold text-(--accent-ink) underline decoration-[rgb(var(--accent-rgb)/0.35)] underline-offset-4"
                  href="/signer-privacy"
                  target="_blank"
                >
                  {tr("a notice built from these settings")}
                </a>
                {tr(". Check that it is right for your organization.")}
              </p>
            </div>
          ) : null}

          <div className="space-y-5 border-t border-(--border) pt-8">
            <div className="space-y-2">
              <h3 className="text-lg font-extrabold tracking-[-0.02em] text-(--fg)">
                {tr("How long to keep finished documents")}
              </h3>
              <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
                {tr(
                  "Optional. After this many days a completed, declined or voided envelope is deleted with its audit trail. Its sender is emailed 30 days before. Leave empty to keep them until someone deletes them. Many records must be kept for years, so check what applies to you before setting this.",
                )}
              </p>
            </div>
            <div className="max-w-xs">
              <FieldShell
                disabled={isSaving || values.part11Mode}
                error={errors.retentionDays}
                helper={
                  values.part11Mode
                    ? tr(
                        "Off while Part 11 mode is on: those records are deleted by hand only.",
                      )
                    : undefined
                }
                label={tr("Days to keep")}
                name="retention-days"
                onChange={handleChange("retentionDays")}
                placeholder={tr("Keep until deleted")}
                readOnly={false}
                value={values.retentionDays}
              />
            </div>
          </div>

          <ShellButton className="w-fit" loading={isSaving} type="submit">
            {isSaving ? tr("Saving...") : tr("Save organization settings")}
          </ShellButton>
        </form>

        <EmailSetupPanel key={emailRevision} />

        {/* The hosted service's accounts are strangers to each other, not
            one organization, so it has no list of them here. */}
        {!values.hosted ? <PeoplePanel part11Mode={values.part11Mode} /> : null}

        {!values.hosted ? (
          <SecurityPanel
            initialRequireTwoFactor={values.requireTwoFactor}
            initialSessionIdleMinutes={values.sessionIdleMinutes}
            initialSessionMaxHours={values.sessionMaxHours}
          />
        ) : null}

        {!values.hosted ? (
          <Part11Panel initialEnabled={values.part11Mode} />
        ) : null}

        <SignerDataPanel />
      </div>
    </section>
  );
}

async function fetchEmailStatus(
  signal: AbortSignal,
): Promise<{ error: string; status: null } | { status: EmailStatus }> {
  const response = await fetch("/api/admin/email", { signal });
  const payload = (await response.json().catch(() => null)) as EmailResponse;

  if (!response.ok || !payload?.status) {
    return { error: payload?.error ?? GENERIC_ERROR_MESSAGE, status: null };
  }

  return { status: payload.status };
}

function EmailSetupPanel() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<EmailAction | null>(null);
  const [testResult, setTestResult] = useState<Feedback>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchEmailStatus(controller.signal)
      .then((result) => {
        if (result.status) {
          setLoadError(null);
          setStatus(result.status);
        } else {
          setLoadError(result.error);
        }
      })
      .catch((error: unknown) => {
        // Leaving the page cancels the request; that is not a failure.
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError(GENERIC_ERROR_MESSAGE);
        }
      });

    return () => controller.abort();
  }, []);

  async function runAction(action: EmailAction) {
    if (pendingAction) {
      return;
    }

    setPendingAction(action);
    setTestResult(null);

    try {
      const response = await fetch("/api/admin/email", {
        body: JSON.stringify({ action }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as EmailResponse;

      if (payload?.status) {
        setLoadError(null);
        setStatus(payload.status);
      }

      if (payload?.test) {
        setTestResult(
          payload.test.sent
            ? {
                message: tr("Test email sent to {to}. Check that inbox.", {
                  to: payload.test.to,
                }),
                tone: "success",
              }
            : { message: payload.test.message, tone: "error" },
        );
      } else if (!response.ok) {
        setLoadError(payload?.error ?? GENERIC_ERROR_MESSAGE);
      }
    } catch {
      setLoadError(GENERIC_ERROR_MESSAGE);
    } finally {
      setPendingAction(null);
    }
  }

  const summary = status ? describeEmailStatus(status) : null;
  const canSendTest =
    status !== null &&
    status.state !== "missing_key" &&
    status.state !== "capture";

  return (
    <div className="space-y-5 border-t border-(--border) pt-8" id="email-setup">
      <h3 className="text-lg font-extrabold tracking-[-0.02em] text-(--fg)">
        {tr("Email setup")}
      </h3>

      {loadError ? (
        <p className="notice notice-danger" role="alert">
          {loadError}
        </p>
      ) : null}

      {!summary ? (
        loadError ? null : (
          <p className="text-sm text-(--secondary)">{tr("Checking email…")}</p>
        )
      ) : (
        <div
          className={`space-y-2 rounded-2xl px-5 py-4 ${summary.ready ? "bg-(--success-soft)" : "bg-(--surface)"}`}
          data-email-state={status?.state}
        >
          <p className="text-sm font-bold text-(--fg)">{summary.title}</p>
          {summary.lines.map((line) => (
            <p className="text-sm leading-6 text-(--secondary)" key={line}>
              {line}
            </p>
          ))}
          {summary.steps ? (
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-(--secondary) marker:font-semibold marker:text-(--fg)">
              {summary.steps.map((step) => (
                <li key={step.text}>
                  {step.text}
                  {step.link ? (
                    <>
                      {" "}
                      <a
                        className="font-semibold text-(--accent-ink) underline underline-offset-4"
                        href={step.link.href}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {step.link.label}
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      )}

      {status?.state === "domain_pending" ? (
        <DnsRecordsTable domain={status.domain} records={status.records} />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {status?.state === "domain_missing" ? (
          <ShellButton
            disabled={pendingAction !== null}
            loading={pendingAction === "add_domain"}
            onClick={() => void runAction("add_domain")}
          >
            {pendingAction === "add_domain"
              ? tr("Adding...")
              : tr("Set up {domain}", { domain: status.domain })}
          </ShellButton>
        ) : null}
        {status?.state === "domain_pending" ? (
          <ShellButton
            disabled={pendingAction !== null}
            loading={pendingAction === "recheck"}
            onClick={() => void runAction("recheck")}
          >
            {pendingAction === "recheck"
              ? tr("Checking...")
              : tr("Check DNS records")}
          </ShellButton>
        ) : null}
        {canSendTest ? (
          <ShellButton
            disabled={pendingAction !== null}
            loading={pendingAction === "send_test"}
            onClick={() => void runAction("send_test")}
            variant="secondary"
          >
            {pendingAction === "send_test"
              ? tr("Sending...")
              : tr("Send me a test email")}
          </ShellButton>
        ) : null}
        {status?.state === "restricted_key" ||
        status?.state === "error" ||
        status?.state === "test_sender" ? (
          <ShellButton href={RESEND_DOMAINS_URL} variant="ghost">
            {tr("Open Resend")}
          </ShellButton>
        ) : null}
      </div>

      {testResult ? (
        <p
          className={`notice ${
            testResult.tone === "success" ? "notice-success" : "notice-danger"
          }`}
          role={testResult.tone === "error" ? "alert" : "status"}
        >
          {testResult.message}
        </p>
      ) : null}
    </div>
  );
}

type EmailStep = {
  link?: { href: string; label: string };
  text: string;
};

function describeEmailStatus(status: EmailStatus): {
  lines: string[];
  ready: boolean;
  steps?: EmailStep[];
  title: string;
} {
  switch (status.state) {
    case "capture":
      return {
        lines: [
          tr(
            "This is a development setup. Emails are saved to a folder on this machine instead of being sent.",
          ),
        ],
        ready: true,
        title: tr("Emails are being captured, not sent"),
      };
    case "missing_key":
      return status.onVercel
        ? {
            lines: [
              tr(
                "This site has no Resend API key, so it cannot send anything: no sign-up confirmations and no signing invitations.",
              ),
            ],
            ready: false,
            steps: [
              {
                link: {
                  href: RESEND_MARKETPLACE_URL,
                  label: tr("Resend on the Vercel Marketplace"),
                },
                text: tr(
                  "Open Resend on the Vercel Marketplace. Choose Install (or Connect Project if your team already has Resend) and connect it to this project.",
                ),
              },
              {
                text: tr(
                  "In this project on Vercel, open Settings, then Environment Variables, and check that RESEND_API_KEY is listed for Production.",
                ),
              },
              {
                text: tr(
                  "Open Deployments, open the ••• menu on the latest Production deployment and choose Redeploy. Environment variables only reach deployments made after they were added, so a site deployed before Resend was connected still has no key until it is redeployed.",
                ),
              },
              {
                text: tr("When the new deployment is ready, reload this page."),
              },
            ],
            title: tr("Email is not connected"),
          }
        : {
            lines: [
              tr(
                "This site has no Resend API key, so it cannot send anything: no sign-up confirmations and no signing invitations.",
              ),
            ],
            ready: false,
            steps: [
              {
                link: {
                  href: "https://resend.com/api-keys",
                  label: tr("Resend API keys"),
                },
                text: tr(
                  "Create an API key in Resend with full access, so this page can add your domain and check its DNS records.",
                ),
              },
              {
                text: tr(
                  "Set it as the RESEND_API_KEY environment variable where this site runs.",
                ),
              },
              { text: tr("Restart the app, then reload this page.") },
            ],
            title: tr("Email is not connected"),
          };
    case "test_sender":
      return {
        lines: [
          tr(
            "Emails are going out from Resend's shared test address ({senderAddress}). Resend only delivers those to the owner of the Resend account, so signers and new users will not receive anything yet.",
            { senderAddress: status.senderAddress },
          ),
          tr(
            'Enter an address at your own domain in "Send email from" above and save. The DNS records to add will appear here.',
          ),
        ],
        ready: false,
        title: tr("Email only reaches you so far"),
      };
    case "domain_missing":
      return {
        lines: [
          tr(
            "{domain} has not been added to your Resend account yet. Set it up here to get the DNS records that prove you own it.",
            { domain: status.domain },
          ),
        ],
        ready: false,
        title: tr("{domain} needs to be set up", { domain: status.domain }),
      };
    case "domain_pending":
      return {
        lines: [
          tr(
            "Add these records where {domain}'s DNS is managed, then check them. DNS changes can take a few minutes to be seen, and sometimes longer.",
            { domain: status.domain },
          ),
          ...(status.mayAlreadySend
            ? [
                tr(
                  "Resend has verified part of this domain, so sending may already work. Send yourself a test email to find out. If it arrives, email is working.",
                ),
              ]
            : []),
        ],
        ready: false,
        title: tr("Waiting for {domain}'s DNS records", {
          domain: status.domain,
        }),
      };
    case "restricted_key":
      return {
        lines: [
          tr(
            "This site's Resend key is only allowed to send email, so it cannot check {domain} from here. Open Resend to add the domain and see its DNS records.",
            { domain: status.domain },
          ),
          tr(
            "When that is done, send yourself a test email. If it arrives, email is working.",
          ),
        ],
        ready: false,
        title: tr("Finish the domain in Resend"),
      };
    case "ready":
      return {
        lines: [
          tr(
            "Emails are sent from {senderAddress}, and {domain} is verified.",
            { senderAddress: status.senderAddress, domain: status.domain },
          ),
        ],
        ready: true,
        title: tr("Email is working"),
      };
    case "error":
      return {
        lines: [
          tr("Resend could not be asked about this site's email: {message}", {
            message: status.message,
          }),
        ],
        ready: false,
        title: tr("Email could not be checked"),
      };
  }
}

function DnsRecordsTable({
  domain,
  records,
}: {
  domain: string;
  records: readonly EmailDnsRecord[];
}) {
  if (records.length === 0) {
    return (
      <p className="text-sm leading-6 text-(--secondary)">
        {tr("Resend did not list any records for")} {domain}
        {tr(". Open Resend to see them.")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-(--border)">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">
          {tr("DNS records to add for")} {domain}
        </caption>
        <thead>
          <tr className="border-b border-(--border) bg-(--surface) text-xs text-(--tertiary)">
            <th className="px-4 py-3 font-semibold" scope="col">
              {tr("Type")}
            </th>
            <th className="px-4 py-3 font-semibold" scope="col">
              {tr("Name")}
            </th>
            <th className="px-4 py-3 font-semibold" scope="col">
              {tr("Value")}
            </th>
            <th className="px-4 py-3 font-semibold" scope="col">
              {tr("Status")}
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              className="border-b border-(--border) align-top last:border-b-0"
              key={`${record.type}-${record.name}-${record.value}`}
            >
              <td className="px-4 py-3 font-semibold text-(--fg)">
                {record.type}
                {record.priority !== null ? (
                  <span className="block text-xs font-normal text-(--tertiary)">
                    {tr("Priority")} {record.priority}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 font-mono text-[0.8rem] break-all text-(--fg)">
                {record.name}
              </td>
              <td className="px-4 py-3 font-mono text-[0.8rem] break-all text-(--fg)">
                {record.value}
              </td>
              <td className="px-4 py-3 text-(--secondary)">
                {record.status === "verified" ? "Found" : tr("Not found yet")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
