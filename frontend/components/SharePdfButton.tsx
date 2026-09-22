"use client";

import { useState, useSyncExternalStore } from "react";
import { ApiError, fetchBudgetPdf, type PdfOptions } from "@/lib/api";
import { canSharePdf, sharePdf } from "@/lib/share";

/** Whether sharing works never changes during a visit, so there is nothing to follow. */
function subscribeToNothing(): () => void {
  return () => {};
}

/** On the server there is no navigator: the button is left out until hydration. */
function cannotShareOnServer(): boolean {
  return false;
}

/**
 * Sends the budget's PDF through the phone's share sheet — WhatsApp, mail,
 * Drive — with the file already attached. Renders nothing where the browser
 * cannot share files (most desktops), where the download button does the job.
 */
export default function SharePdfButton({
  budgetId,
  budgetNumber,
  title,
  options,
  onError,
  className = "",
}: {
  budgetId: string;
  budgetNumber: number;
  title: string;
  /** Same currency and rate as the download, so both files match. */
  options?: PdfOptions;
  onError: (message: string | null) => void;
  className?: string;
}) {
  const isSupported = useSyncExternalStore(subscribeToNothing, canSharePdf, cannotShareOnServer);
  const [isPreparing, setIsPreparing] = useState(false);
  // Kept when the browser wanted a fresh tap: the next one sends it at once.
  const [readyFile, setReadyFile] = useState<File | null>(null);

  if (!isSupported) {
    return null;
  }

  const shareTitle = `Presupuesto #${budgetNumber}${title ? ` — ${title}` : ""}`;

  async function send(file: File) {
    const outcome = await sharePdf(file, shareTitle);
    // Only a refused sheet keeps the file, for the very next tap. Otherwise
    // the next share fetches again, so an edit in between is never lost.
    setReadyFile(outcome === "needs-tap" ? file : null);
  }

  async function handleClick() {
    onError(null);

    try {
      if (readyFile) {
        await send(readyFile);
        return;
      }

      setIsPreparing(true);
      const file = await fetchBudgetPdf(budgetId, `presupuesto-${budgetNumber}.pdf`, options);
      setIsPreparing(false);
      await send(file);
    } catch (caught) {
      setIsPreparing(false);
      setReadyFile(null);
      onError(caught instanceof ApiError ? caught.message : "No se pudo compartir el PDF.");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isPreparing}
      title="Mandar el PDF por WhatsApp, mail u otra app"
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
        readyFile
          ? "bg-success text-white hover:opacity-90"
          : "border border-primary text-primary hover:bg-primary-soft"
      } ${className}`}
    >
      {isPreparing ? "Preparando…" : readyFile ? "Enviar PDF" : "Compartir"}
    </button>
  );
}
