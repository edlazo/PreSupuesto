"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";

/** The usual answers to "how long does this price hold?". */
const PRESETS = [
  { days: 7, label: "7 días" },
  { days: 15, label: "15 días" },
  { days: 30, label: "30 días" },
] as const;

/** Today plus `days`, as YYYY-MM-DD in the browser's own timezone. */
function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Until when the quote holds.
 *
 * Prices move fast here, so a quote from two months ago cannot be honoured.
 * The date is printed on the PDF, which is what protects the tradesman.
 */
export default function ValidityField({
  validUntil,
  isSaving,
  onChange,
}: {
  validUntil: string | null;
  isSaving: boolean;
  onChange: (validUntil: string | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  function choose(value: string | null) {
    setIsOpen(false);
    onChange(value);
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        disabled={isSaving}
        onClick={() => setIsOpen(true)}
        title="Hasta cuándo vale este presupuesto"
        className="no-print rounded-md text-xs text-muted underline decoration-dotted decoration-muted/60 underline-offset-2 transition-colors hover:text-primary disabled:opacity-50"
      >
        {validUntil ? `Válido hasta el ${formatDate(validUntil)}` : "Sin vencimiento"}
      </button>
    );
  }

  return (
    <span className="no-print flex flex-wrap items-center gap-1.5 text-xs">
      {PRESETS.map((preset) => (
        <button
          key={preset.days}
          type="button"
          onClick={() => choose(inDays(preset.days))}
          className="rounded-full border border-border px-2 py-0.5 font-medium text-muted transition-colors hover:border-primary hover:text-primary"
        >
          {preset.label}
        </button>
      ))}
      <input
        type="date"
        aria-label="Válido hasta"
        value={validUntil ?? ""}
        onChange={(event) => choose(event.target.value || null)}
        className="rounded-md border border-border bg-background px-2 py-0.5 text-xs outline-none focus:border-primary"
      />
      {validUntil ? (
        <button
          type="button"
          onClick={() => choose(null)}
          className="rounded-full px-2 py-0.5 font-medium text-muted transition-colors hover:text-danger"
        >
          Sin vencimiento
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setIsOpen(false)}
        className="rounded-full px-2 py-0.5 font-medium text-muted transition-colors hover:text-foreground"
      >
        Cerrar
      </button>
    </span>
  );
}
