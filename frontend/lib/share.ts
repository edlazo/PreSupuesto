/**
 * Handing a file to the phone's share sheet (WhatsApp, mail, Drive…).
 *
 * The Web Share API with files works on Android and iOS browsers and on a
 * few desktop ones; everywhere else the caller falls back to a download.
 */

/** A tiny PDF-typed file, only to ask the browser whether PDFs can be shared. */
function probeFile(): File {
  return new File([new Uint8Array(0)], "presupuesto.pdf", { type: "application/pdf" });
}

/** True when this browser can hand a PDF to the share sheet. */
export function canSharePdf(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") {
    return false;
  }

  try {
    return navigator.canShare({ files: [probeFile()] });
  } catch {
    return false;
  }
}

/**
 * What came of an attempt to share:
 * - "shared": the sheet opened and something was picked;
 * - "cancelled": the sheet opened and was closed without sending;
 * - "needs-tap": the browser wanted a fresh tap to open the sheet. Safari
 *   allows it only right after the tap, and preparing the PDF can take
 *   longer — calling again from the next tap works.
 */
export type ShareOutcome = "shared" | "cancelled" | "needs-tap";

export async function sharePdf(file: File, title: string): Promise<ShareOutcome> {
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (caught) {
    const name = caught instanceof DOMException ? caught.name : "";

    if (name === "AbortError") return "cancelled";
    if (name === "NotAllowedError") return "needs-tap";
    throw caught;
  }
}
