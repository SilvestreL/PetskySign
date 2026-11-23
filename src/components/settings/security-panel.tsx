"use client";

import { useEffect, useState } from "react";

import type { SystemAuditEvent } from "@/lib/services/system-audit";
import {
  SESSION_IDLE_CHOICES,
  SESSION_MAX_HOURS_CHOICES,
} from "@/lib/session-choices";
import { tr } from "@/lib/petsky/locale";

// Sign-in security and the install's own audit trail. Administrators only.

const GENERIC_ERROR_MESSAGE = tr("Something went wrong. Please try again.");

type AuditResponse = {
  chain?:
    | { events: number; ok: true }
    | { brokenAtSequence: number; events: number; ok: false };
  error?: string;
  events?: SystemAuditEvent[];
} | null;

const EVENT_LABELS: Record<SystemAuditEvent["event"], string> = {
  account_closure_requested: tr("Account closure requested"),
  account_deleted: tr("Account deleted"),
  email_domain_changed: tr("Email domain changed"),
  documents_erased: tr("Documents erased (API)"),
  identity_verification_revoked: tr("Identity confirmation taken back"),
  identity_verified: tr("Identity confirmed"),
  logo_changed: tr("Logo changed"),
  part11_mode_changed: tr("Part 11 mode changed"),
  password_changed: tr("Password changed"),
  password_reset: tr("Password reset by email link"),
  reauthentication_failed: tr("Wrong password while signing"),
  role_changed: tr("Role changed"),
  settings_changed: tr("Settings changed"),
  sign_in_failed: tr("Sign-in failed"),
  sign_in_locked: tr("Sign-in stopped after wrong passwords"),
  sign_in_succeeded: tr("Signed in"),
  sessions_revoked: tr("Signed out everywhere"),
  signed_out: tr("Signed out"),
  signing_locked: tr("Signing locked"),
  signing_unlocked: tr("Signing unlocked"),
  two_factor_backup_codes_regenerated: tr("New backup codes made"),
  two_factor_disabled: tr("Two-step sign-in turned off"),
  two_factor_enabled: tr("Two-step sign-in turned on"),
  two_factor_requirement_changed: tr("Two-step sign-in requirement changed"),
  two_factor_reset: tr("Two-step sign-in reset by an administrator"),
};

const SIGN_IN_FAILURE_REASONS: Record<string, string> = {
  ACCOUNT_TEMPORARILY_LOCKED: tr("second step locked after wrong codes"),
  EMAIL_NOT_VERIFIED: tr("email address not confirmed yet"),
  INVALID_BACKUP_CODE: tr("wrong backup code"),
  INVALID_CODE: tr("wrong authenticator code"),
  INVALID_EMAIL_OR_PASSWORD: tr("wrong email or password"),
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: tr("too many wrong codes, signed out"),
};

function describeEvent(event: SystemAuditEvent): string {
  const metadata = event.metadata ?? {};
  const target =
    typeof metadata.targetName === "string"
      ? `${metadata.targetName}${typeof metadata.targetEmail === "string" ? ` <${metadata.targetEmail}>` : ""}`
      : null;

  switch (event.event) {
    case "part11_mode_changed":
    case "two_factor_requirement_changed":
      return metadata.to === true ? tr("Turned on") : tr("Turned off");
    case "role_changed":
      return tr("{value}: {from} to {to}", {
        value: target ?? "Account",
        from: String(metadata.from),
        to: String(metadata.to),
      });
    case "settings_changed":
      return typeof metadata.changes === "object" && metadata.changes
        ? Object.keys(metadata.changes).join(", ")
        : "";
    case "identity_verified":
      return `${target ?? ""}${typeof metadata.note === "string" ? `: ${metadata.note}` : ""}`;
    case "reauthentication_failed":
    case "signing_locked":
      return typeof metadata.failedAttempts === "number"
        ? tr("{failedAttempts} wrong in a row", {
            failedAttempts: String(metadata.failedAttempts),
          })
        : "";
    case "sign_in_failed":
      return typeof metadata.reason === "string"
        ? (SIGN_IN_FAILURE_REASONS[metadata.reason] ?? metadata.reason)
        : "";
    case "sign_in_succeeded":
      return metadata.secondStep === "backup_code"
        ? tr("with a backup code")
        : metadata.secondStep === "authenticator"
          ? tr("with an authenticator code")
          : "";
    case "logo_changed":
      return metadata.action === "removed" ? "Removed" : "Replaced";
    case "email_domain_changed":
      return typeof metadata.domain === "string" ? metadata.domain : "";
    case "documents_erased":
      return tr("{value} deleted{value2}", {
        value: String(metadata.deleted ?? 0),
        value2:
          typeof metadata.companyRef === "string"
            ? tr(" (company {companyRef})", { companyRef: metadata.companyRef })
            : "",
      });
    default:
      return target ?? "";
  }
}

function describeMinutes(minutes: number): string {
  return minutes < 60
    ? tr("{minutes} minutes", { minutes: String(minutes) })
    : minutes === 60
      ? tr("1 hour")
      : tr("{value} hours", { value: String(minutes / 60) });
}

function describeHours(hours: number): string {
  return hours % 24 === 0
    ? hours === 24
      ? tr("1 day")
      : tr("{value} days", { value: String(hours / 24) })
    : tr("{hours} hours", { hours: String(hours) });
}

export function SecurityPanel({
  initialRequireTwoFactor,
  initialSessionIdleMinutes,
  initialSessionMaxHours,
}: {
  initialRequireTwoFactor: boolean;
  initialSessionIdleMinutes: number | null;
  initialSessionMaxHours: number | null;
}) {
  const [requireTwoFactor, setRequireTwoFactor] = useState(
    initialRequireTwoFactor,
  );
  const [savedLimits, setSavedLimits] = useState({
    sessionIdleMinutes: initialSessionIdleMinutes,
    sessionMaxHours: initialSessionMaxHours,
  });
  const [limits, setLimits] = useState(savedLimits);
  const [limitsMessage, setLimitsMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [audit, setAudit] = useState<AuditResponse>(null);
  const [auditRevision, setAuditRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/admin/audit", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response
          .json()
          .catch(() => null)) as AuditResponse;

        setAudit(
          response.ok
            ? payload
            : { error: payload?.error ?? GENERIC_ERROR_MESSAGE },
        );
      })
      .catch((loadError: unknown) => {
        if (!(
          loadError instanceof DOMException && loadError.name === "AbortError"
        )) {
          setAudit({ error: GENERIC_ERROR_MESSAGE });
        }
      });

    return () => controller.abort();
  }, [auditRevision]);

  async function changeRequirement(next: boolean) {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/security", {
        body: JSON.stringify({ requireTwoFactor: next }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        requireTwoFactor?: boolean;
      } | null;

      if (!response.ok || typeof payload?.requireTwoFactor !== "boolean") {
        setError(payload?.error ?? GENERIC_ERROR_MESSAGE);
        return;
      }

      setRequireTwoFactor(payload.requireTwoFactor);
      setAuditRevision((value) => value + 1);
    } catch {
      setError(GENERIC_ERROR_MESSAGE);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveLimits() {
    setIsSaving(true);
    setError(null);
    setLimitsMessage(null);

    try {
      const response = await fetch("/api/admin/security", {
        body: JSON.stringify(limits),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        sessionIdleMinutes?: number | null;
        sessionMaxHours?: number | null;
      } | null;

      if (!response.ok || payload?.sessionIdleMinutes === undefined) {
        setError(payload?.error ?? GENERIC_ERROR_MESSAGE);
        return;
      }

      const saved = {
        sessionIdleMinutes: payload.sessionIdleMinutes,
        sessionMaxHours: payload.sessionMaxHours ?? null,
      };

      setSavedLimits(saved);
      setLimits(saved);
      setLimitsMessage(tr("Session limits saved."));
      setAuditRevision((value) => value + 1);
    } catch {
      setError(GENERIC_ERROR_MESSAGE);
    } finally {
      setIsSaving(false);
    }
  }

  const limitsChanged =
    limits.sessionIdleMinutes !== savedLimits.sessionIdleMinutes ||
    limits.sessionMaxHours !== savedLimits.sessionMaxHours;

  return (
    <div className="space-y-5 border-t border-(--border) pt-8" id="security">
      <div className="space-y-2">
        <h3 className="text-lg font-extrabold tracking-[-0.02em] text-(--fg)">
          {tr("Sign-in security")}
        </h3>
        <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
          {tr(
            "Two-step sign-in asks for a code from an authenticator app (such as 1Password, Google Authenticator or Microsoft Authenticator) after the password. When you require it, anyone who has not set it up is asked to do so the next time they open the app, and can do nothing else until they have. Ten wrong passwords for one email address stop sign-in for it for 15 minutes either way.",
          )}
        </p>
      </div>

      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`pill ${requireTwoFactor ? "pill-success" : "pill-neutral"}`}
        >
          {requireTwoFactor ? tr("Required for everyone") : "Optional"}
        </span>
        <button
          className={
            requireTwoFactor ? "btn-quiet btn-quiet-danger" : "btn-quiet"
          }
          disabled={isSaving}
          onClick={() => void changeRequirement(!requireTwoFactor)}
          type="button"
        >
          {isSaving
            ? tr("Saving...")
            : requireTwoFactor
              ? tr("Stop requiring two-step sign-in")
              : tr("Require two-step sign-in")}
        </button>
      </div>

      <div className="space-y-3">
        <h4 className="text-[0.9375rem] font-bold text-(--fg)">
          {tr("Sessions")}
        </h4>
        <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
          {tr(
            "How long someone stays signed in. A change applies to everyone who is signed in now, from their next click. Anyone can also sign out everywhere from their own Settings.",
          )}
        </p>
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-[0.8125rem] font-semibold text-(--secondary)">
              {tr("Sign out after no use for")}
            </span>
            <select
              className="field-input"
              disabled={isSaving}
              onChange={(event) => {
                setLimitsMessage(null);
                setLimits((current) => ({
                  ...current,
                  sessionIdleMinutes:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                }));
              }}
              value={limits.sessionIdleMinutes ?? ""}
            >
              <option value="">{tr("Never")}</option>
              {SESSION_IDLE_CHOICES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {describeMinutes(minutes)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-[0.8125rem] font-semibold text-(--secondary)">
              {tr("Sign out at the latest after")}
            </span>
            <select
              className="field-input"
              disabled={isSaving}
              onChange={(event) => {
                setLimitsMessage(null);
                setLimits((current) => ({
                  ...current,
                  sessionMaxHours:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                }));
              }}
              value={limits.sessionMaxHours ?? ""}
            >
              <option value="">{tr("7 days (the default)")}</option>
              {SESSION_MAX_HOURS_CHOICES.filter((hours) => hours !== 168).map(
                (hours) => (
                  <option key={hours} value={hours}>
                    {describeHours(hours)}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-quiet"
            disabled={isSaving || !limitsChanged}
            onClick={() => void saveLimits()}
            type="button"
          >
            {isSaving ? tr("Saving...") : tr("Save session limits")}
          </button>
          {limitsMessage ? (
            <span className="text-sm text-(--secondary)" role="status">
              {limitsMessage}
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-[0.9375rem] font-bold text-(--fg)">
            {tr("Site audit trail")}
          </h4>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-quiet"
              onClick={() => setAuditRevision((value) => value + 1)}
              type="button"
            >
              {tr("Refresh")}
            </button>
            <a className="btn-quiet" href="/api/admin/audit?format=csv">
              {tr("Download as CSV")}
            </a>
          </div>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
          {tr(
            "Sign-ins and failed sign-ins, changes to how people sign in, and changes to settings, roles, the logo, identity confirmations and signing locks. Each envelope has its own trail too, which its sender can export from the envelope's page.",
          )}
        </p>

        {audit?.error ? (
          <div className="notice notice-danger" role="alert">
            {audit.error}
          </div>
        ) : null}

        {audit?.chain ? (
          <p
            className={`notice ${audit.chain.ok ? "notice-success" : "notice-danger"}`}
            role="status"
          >
            {audit.chain.ok
              ? tr("Hash chain intact across {events} events.", {
                  events: String(audit.chain.events),
                })
              : tr(
                  "The hash chain is broken at event {brokenAtSequence}: a row was changed or removed.",
                  { brokenAtSequence: String(audit.chain.brokenAtSequence) },
                )}
          </p>
        ) : null}

        {audit?.events ? (
          audit.events.length === 0 ? (
            <p className="text-sm text-(--secondary)">
              {tr("Nothing recorded yet.")}
            </p>
          ) : (
            <ul aria-label={tr("Site audit trail")} className="space-y-2">
              {audit.events.map((event) => (
                <li className="well p-3 text-sm" key={event.id}>
                  <p className="font-semibold text-(--fg)">
                    {EVENT_LABELS[event.event] ?? event.event}
                    <span className="font-normal text-(--secondary)">
                      {" "}
                      {describeEvent(event)}
                    </span>
                  </p>
                  <p className="text-xs text-(--tertiary)">
                    {new Date(event.createdAt * 1000)
                      .toISOString()
                      .replace("T", " ")
                      .replace(/\.\d{3}Z$/, " UTC")}
                    {event.actorEmail ? ` · ${event.actorEmail}` : ""}
                    {event.ipAddress ? ` · ${event.ipAddress}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
