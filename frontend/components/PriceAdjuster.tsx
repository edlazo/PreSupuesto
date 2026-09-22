"use client";

import { useState } from "react";
import { formatCurrency, formatQuantity } from "@/lib/format";

/**
 * The percentage that undoes another one, unrounded.
 *
 * Raising by 12% is undone by lowering 10.714285…%, not by 12%. Rounding that
 * to the 10.71% a person reads leaves hundreds of pesos behind on a large
 * quote, so the number shown is rounded and the one applied is not.
 */
function undoPercentage(percentage: number): number {
  return (1 / (1 + percentage / 100) - 1) * 100;
}

/**
 * Moves every charged line of the budget by a percentage.
 *
 * An old quote falls behind; this is the alternative to rewriting it line by
 * line. What the total would become is shown before anything is applied, and
 * what was applied can be undone right after.
 */
export default function PriceAdjuster({
  currentTotal,
  currency,
  isSaving,
  estimate,
  onApply,
}: {
  currentTotal: number;
  currency: string | undefined;
  isSaving: boolean;
  /** The total this percentage would leave, worked out like the backend does. */
  estimate: (percentage: number) => number;
  onApply: (percentage: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [typed, setTyped] = useState("");
  // What was just applied, so it can be undone without doing the arithmetic.
  const [applied, setApplied] = useState<number | null>(null);

  const percentage = Number(typed.replace(",", "."));
  const isValid = Number.isFinite(percentage) && percentage !== 0 && percentage > -100;

  function apply(value: number) {
    onApply(value);
    setApplied(value);
    setTyped("");
  }

  function close() {
    setIsOpen(false);
    setApplied(null);
    setTyped("");
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        disabled={isSaving}
        onClick={() => setIsOpen(true)}
        className="no-print rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
      >
        Actualizar precios
      </button>
    );
  }

  if (applied !== null) {
    return (
      <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted p-3 text-xs">
        <span>
          Listo: los trabajos cambiaron{" "}
          <strong className="tabular-nums">
            {applied > 0 ? "+" : ""}
            {formatQuantity(Math.round(applied * 100) / 100)}%
          </strong>
          . Total: <span className="tabular-nums">{formatCurrency(currentTotal, currency)}</span>
        </span>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => apply(undoPercentage(applied))}
          className="rounded-lg border border-border px-3 py-1.5 font-medium text-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
        >
          Deshacer
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded-lg px-3 py-1.5 font-medium text-muted transition-colors hover:text-foreground"
        >
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <div className="no-print flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
      <p className="text-xs text-muted">
        Sube o baja todos los trabajos del presupuesto. Los materiales de la lista no se
        tocan.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="price-adjust" className="sr-only">
          Porcentaje a aplicar
        </label>
        <div className="flex items-center gap-1">
          <input
            id="price-adjust"
            autoFocus
            type="text"
            inputMode="decimal"
            value={typed}
            placeholder="12"
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && isValid) apply(percentage);
              if (event.key === "Escape") close();
            }}
            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
          />
          <span className="text-sm text-muted">%</span>
        </div>

        <button
          type="button"
          onClick={() => apply(percentage)}
          disabled={!isValid || isSaving}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Aplicar
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          Cancelar
        </button>
      </div>

      {isValid ? (
        <p className="text-xs">
          El total pasa de{" "}
          <span className="tabular-nums">{formatCurrency(currentTotal, currency)}</span> a{" "}
          <span className="font-semibold tabular-nums">
            {formatCurrency(estimate(percentage), currency)}
          </span>
          . Después vas a poder deshacerlo.
        </p>
      ) : (
        <p className="text-xs text-muted">
          Por ejemplo <strong>12</strong> sube un 12%, <strong>-5</strong> baja un 5%.
        </p>
      )}
    </div>
  );
}
