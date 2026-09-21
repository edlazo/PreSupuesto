import type { BudgetStatus } from "./types";

/** The statuses in the order a job goes through them. */
export const BUDGET_STATUSES: readonly BudgetStatus[] = ["draft", "in_progress", "completed"];

export const STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: "Borrador",
  in_progress: "En proceso",
  completed: "Terminado / cobrado",
};

/** Short enough for a badge or a phone-width button. */
export const STATUS_SHORT_LABELS: Record<BudgetStatus, string> = {
  draft: "Borrador",
  in_progress: "En proceso",
  completed: "Terminado",
};

export const STATUS_STYLES: Record<BudgetStatus, string> = {
  draft: "bg-surface-muted text-muted",
  in_progress: "bg-primary-soft text-primary",
  completed: "bg-success-soft text-success",
};
