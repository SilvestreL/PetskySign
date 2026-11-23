"use client";

import { useState } from "react";

import { ShellButton } from "@/components/shared/form-shell";
import type { UpdateStatus } from "@/lib/software-update";
import { tr } from "@/lib/petsky/locale";

// The SignuDoc section of Settings, for the administrator: the version this
// install runs, a button that asks GitHub whether a newer one is out, and
// how to take it. Updating happens in the install's own GitHub repository,
// not here: a workflow there opens a pull request, and Vercel deploys it.

const linkClassName =
  "font-semibold text-(--accent-ink) underline decoration-[rgb(var(--accent-rgb)/0.35)] underline-offset-4";

export function UpdatesPanel({
  initialStatus,
}: {
  initialStatus: UpdateStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = status.check;

  async function checkNow() {
    setIsChecking(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/updates", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        (UpdateStatus & { error?: undefined }) | { error: string } | null;

      if (!response.ok || !payload || "error" in payload) {
        setError(
          (payload && "error" in payload && payload.error) ||
            tr("Updates could not be checked. Please try again."),
        );
        return;
      }

      setStatus(payload);
    } catch {
      setError(tr("Updates could not be checked. Please try again."));
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <section
      className="panel scroll-mt-6 p-6 sm:p-8"
      data-animate="enter"
      data-animate-delay="2"
      id="signudoc"
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="section-eyebrow">{tr("Administrator")}</p>
          <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-(--fg)">
            {tr("SignuDoc")}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
            {tr("This site runs SignuDoc version")}{" "}
            <span
              className="font-bold text-(--fg)"
              data-testid="running-version"
            >
              {status.current}
            </span>
            {status.commit ? (
              <>
                {" "}
                {tr("(commit")}{" "}
                <code className="text-(--fg)">{status.commit}</code>)
              </>
            ) : null}
            {tr(". New versions are published on")}{" "}
            <a
              className={linkClassName}
              href={status.releasesUrl}
              rel="noreferrer"
              target="_blank"
            >
              {tr("GitHub")}
            </a>
            .
          </p>
        </div>

        <ShellButton
          className="w-fit"
          loading={isChecking}
          onClick={checkNow}
          variant="secondary"
        >
          {isChecking ? tr("Checking...") : tr("Check for updates")}
        </ShellButton>

        {error ? (
          <p className="notice notice-danger" role="alert">
            {error}
          </p>
        ) : null}

        {check && !error ? (
          check.ok ? (
            check.updateAvailable ? (
              <div className="space-y-4" role="status">
                <p className="notice notice-accent">
                  <strong>{check.latest.name}</strong>{" "}
                  {tr("is out. This site runs")} {check.current}.
                </p>
                {check.latest.notes ? (
                  <div className="space-y-2">
                    <h3 className="text-base font-extrabold text-(--fg)">
                      {tr("What's new")}
                    </h3>
                    <div className="max-h-80 space-y-1 overflow-y-auto rounded-2xl bg-(--surface) px-5 py-4 text-sm leading-6 text-(--secondary)">
                      <ReleaseNotes notes={check.latest.notes} />
                    </div>
                  </div>
                ) : null}
                <a
                  className={linkClassName}
                  href={check.latest.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {tr("Read the release on GitHub")}
                </a>
              </div>
            ) : (
              <p className="notice notice-success" role="status">
                {tr("You are up to date.")} {check.latest.version}{" "}
                {tr("is the latest release.")}
              </p>
            )
          ) : (
            <p className="notice notice-warning" role="status">
              {check.error}{" "}
              <a
                className={linkClassName}
                href={status.releasesUrl}
                rel="noreferrer"
                target="_blank"
              >
                {tr("See the releases")}
              </a>
            </p>
          )
        ) : null}

        <HowToUpdate status={status} />
      </div>
    </section>
  );
}

/**
 * Release notes are Markdown. They are shown as plain text, with headings
 * and list items picked out and the rest of the markup dropped: nothing in
 * them becomes HTML or a link.
 */
function ReleaseNotes({ notes }: { notes: string }) {
  const clean = (text: string) =>
    text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, "$1");

  return notes.split(/\r?\n/).map((line, index) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);

    if (heading) {
      return (
        <p className="pt-2 font-bold text-(--fg) first:pt-0" key={index}>
          {clean(heading[1])}
        </p>
      );
    }

    if (item) {
      return (
        <p className="flex gap-2 pl-1" key={index}>
          <span aria-hidden="true">•</span>
          <span>{clean(item[1])}</span>
        </p>
      );
    }

    return line.trim() ? <p key={index}>{clean(line)}</p> : null;
  });
}

function HowToUpdate({ status }: { status: UpdateStatus }) {
  const repository = status.repository;

  return (
    <div className="space-y-3 border-t border-(--border) pt-6">
      <h3 className="text-lg font-extrabold tracking-[-0.02em] text-(--fg)">
        {tr("How to update")}
      </h3>
      {repository && !repository.isUpstream ? (
        <>
          <ol className="max-w-2xl list-decimal space-y-2 pl-5 text-sm leading-6 text-(--secondary)">
            <li>
              {tr("In your repository")}{" "}
              <a
                className={linkClassName}
                href={repository.url}
                rel="noreferrer"
                target="_blank"
              >
                {repository.owner}/{repository.slug}
              </a>
              {tr(", open the Update SignuDoc workflow and press")}{" "}
              <strong className="text-(--fg)">{tr("Run workflow")}</strong>
              {tr(". It also runs by itself once a week.")}
            </li>
            <li>
              {tr(
                "It opens a pull request with the new version, and Vercel builds a preview of it. Your own changes to the code are kept; if they clash with the update, the workflow says which files.",
              )}
            </li>
            <li>
              {tr(
                "Merge the pull request. Vercel deploys it, and the build applies any database changes the new version needs.",
              )}
            </li>
          </ol>
          <a
            className="btn-quiet min-h-12 w-fit px-5 text-sm"
            href={repository.actionsUrl}
            rel="noreferrer"
            target="_blank"
          >
            {tr("Open the update workflow")}
          </a>
          <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
            {tr(
              "No such workflow? Copies made before version 0.2.0 do not have it.",
            )}{" "}
            <a
              className={linkClassName}
              href={repository.addWorkflowUrl}
              rel="noreferrer"
              target="_blank"
            >
              {tr("Create the file")}
            </a>{" "}
            {tr("in your repository once and paste in")}{" "}
            <a
              className={linkClassName}
              href={status.workflowSourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {tr("its contents")}
            </a>
            {tr(". The")}{" "}
            <a
              className={linkClassName}
              href={status.docsUrl}
              rel="noreferrer"
              target="_blank"
            >
              {tr("update guide")}
            </a>{" "}
            {tr("has the details.")}
          </p>
        </>
      ) : (
        <p className="max-w-2xl text-sm leading-6 text-(--secondary)">
          {tr(
            "Bring the new release into the repository this site is built from, then deploy it. The",
          )}{" "}
          <a
            className={linkClassName}
            href={status.docsUrl}
            rel="noreferrer"
            target="_blank"
          >
            {tr("update guide")}
          </a>{" "}
          {tr("shows how, including a GitHub workflow that does it for you.")}
        </p>
      )}
    </div>
  );
}
