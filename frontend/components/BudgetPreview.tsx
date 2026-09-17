"use client";

import { useEffect, useState } from "react";
import { ApiError, downloadBudgetPdf, getLatestBudget } from "@/lib/api";
import { formatCurrency, formatDate, formatQuantity } from "@/lib/format";
import type { Budget, BudgetItem, BudgetStatus } from "@/lib/types";

// Status labels, as they are shown to the user.
const STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: "Borrador",
  sent: "Enviado",
  accepted: "Aceptado",
  rejected: "Rechazado",
  expired: "Vencido",
};

const STATUS_STYLES: Record<BudgetStatus, string> = {
  draft: "bg-surface-muted text-muted",
  sent: "bg-primary-soft text-primary",
  accepted: "bg-success-soft text-success",
  rejected: "bg-danger-soft text-danger",
  expired: "bg-surface-muted text-muted",
};

interface BudgetPreviewProps {
  /** Changing this value triggers a refetch of the latest budget. */
  refreshToken: number;
}

/** Sum the line totals of a group of items. */
function sumLines(items: BudgetItem[]): number {
  return items.reduce((total, item) => total + item.line_total, 0);
}

/** Live view of the most recent budget the agent stored. */
export default function BudgetPreview({ refreshToken }: BudgetPreviewProps) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bumped by the Refresh button; `refreshToken` is bumped by the chat panel.
  const [manualToken, setManualToken] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  // Kept apart from `error`, so a failed export does not replace the budget.
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    // `isActive` drops the response of a request that a newer one has replaced.
    let isActive = true;

    getLatestBudget()
      .then((latest) => {
        if (!isActive) return;
        setBudget(latest);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!isActive) return;
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo cargar el presupuesto.",
        );
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [refreshToken, manualToken]);

  /** Download the budget as a PDF rendered by the backend. */
  async function exportPdf() {
    if (!budget) {
      return;
    }

    setIsExporting(true);

    try {
      await downloadBudgetPdf(budget.id, `budget-${budget.budget_number}.pdf`);
      setExportError(null);
    } catch (caught) {
      setExportError(
        caught instanceof ApiError ? caught.message : "No se pudo exportar el PDF.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  const materials = budget?.items.filter((item) => item.item_type === "material") ?? [];
  const labor = budget?.items.filter((item) => item.item_type === "task") ?? [];
  const other = budget?.items.filter((item) => item.item_type === "custom") ?? [];
  const currency = budget?.currency ?? undefined;

  return (
    <section
      aria-label="Vista previa del presupuesto"
      className="print-area flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Vista previa del presupuesto</h2>
          <p className="truncate text-xs text-muted">
            {budget
              ? `#${budget.budget_number} · ${budget.title}`
              : "Acá aparece el último presupuesto que guarde el agente"}
          </p>
        </div>

        <div className="no-print flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsLoading(true);
              setManualToken((current) => current + 1);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={!budget || isExporting}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExporting ? "Generando…" : "Exportar PDF"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {exportError ? (
          <p className="no-print mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            {exportError}
          </p>
        ) : null}

        {isLoading && !budget ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : error ? (
          <div className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
        ) : !budget ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm font-medium">Todavía no hay presupuestos</p>
            <p className="mt-1 max-w-xs text-sm text-muted">
              Pedile uno al agente y va a aparecer acá con sus materiales, la mano de
              obra y los totales.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[budget.status]}`}
              >
                {STATUS_LABELS[budget.status] ?? budget.status}
              </span>
              <span className="text-xs text-muted">Creado el {formatDate(budget.created_at)}</span>
              {budget.valid_until ? (
                <span className="text-xs text-muted">
                  · Válido hasta el {formatDate(budget.valid_until)}
                </span>
              ) : null}
            </div>

            {budget.description ? (
              <p className="text-sm text-muted">{budget.description}</p>
            ) : null}

            <ItemGroup title="Materiales" items={materials} currency={currency} />
            <ItemGroup title="Mano de obra" items={labor} currency={currency} />
            <ItemGroup title="Otros costos" items={other} currency={currency} />

            <dl className="space-y-2 border-t border-border pt-4 text-sm">
              <Row label="Materiales" value={formatCurrency(sumLines(materials), currency)} />
              <Row label="Mano de obra" value={formatCurrency(sumLines(labor), currency)} />
              {other.length > 0 ? (
                <Row label="Otros costos" value={formatCurrency(sumLines(other), currency)} />
              ) : null}
              <Row label="Subtotal" value={formatCurrency(budget.subtotal, currency)} />
              <Row
                label={`IVA (${formatQuantity(budget.tax_rate)}%)`}
                value={formatCurrency(budget.tax_amount, currency)}
              />
              <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
                <dt>Total</dt>
                <dd>{formatCurrency(budget.total, currency)}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

/** One labelled amount in the totals list. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

/** A table of budget lines, hidden when the group is empty. */
function ItemGroup({
  title,
  items,
  currency,
}: {
  title: string;
  items: BudgetItem[];
  currency: string | undefined;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm">{item.description}</p>
              <p className="text-xs text-muted">
                {formatQuantity(item.quantity)} {item.unit} ×{" "}
                {formatCurrency(item.unit_price, currency)}
              </p>
            </div>
            <span className="shrink-0 text-sm font-medium">
              {formatCurrency(item.line_total, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
