"use client";

import { StatusPanel } from "@/components/shared/status-panel";
import { tr } from "@/lib/petsky/locale";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusPanel
      description={tr(
        "Something went wrong while loading this page. Please try again.",
      )}
      footer={
        <button
          className="btn-quiet min-h-11 px-5"
          onClick={reset}
          type="button"
        >
          {tr("Try again")}
        </button>
      }
      title={tr("We couldn't load this page.")}
      tone="error"
    />
  );
}
