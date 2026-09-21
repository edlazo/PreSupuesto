"use client";

import { BUDGET_STATUSES, STATUS_SHORT_LABELS, STATUS_STYLES } from "@/lib/status";
import type { BudgetStatus } from "@/lib/types";

/**
 * Borrador · En proceso · Terminado, as three buttons: one tap moves the
 * budget along, and the one it is in stays lit.
 */
export default function StatusPicker({
  status,
  onChange,
  disabled = false,
  label,
}: {
  status: BudgetStatus;
  onChange: (status: BudgetStatus) => void;
  disabled?: boolean;
  /** Says which budget it belongs to, for screen readers in a list. */
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="no-print inline-flex shrink-0 rounded-full border border-border bg-surface p-0.5"
    >
      {BUDGET_STATUSES.map((option) => {
        const isCurrent = option === status;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isCurrent}
            disabled={disabled}
            onClick={() => {
              if (!isCurrent) onChange(option);
            }}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
              isCurrent ? STATUS_STYLES[option] : "text-muted hover:text-foreground"
            }`}
          >
            {STATUS_SHORT_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
