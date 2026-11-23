"use client";

import { StatusPanel } from "@/components/shared/status-panel";
import { tr } from "@/lib/petsky/locale";

export default function CanvasError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <StatusPanel
        description={tr(
          "Something went wrong while opening this document. Please try again.",
        )}
        footer={
          <button
            className="btn-quiet min-h-11 px-5"
            onClick={reset}
            type="button"
          >
            {tr("Reload canvas")}
          </button>
        }
        title={tr("We couldn't open this document.")}
        tone="error"
      />
    </div>
  );
}
