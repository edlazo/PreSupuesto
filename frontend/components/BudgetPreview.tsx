"use client";

import { useMemo, useState } from "react";
import { useBlueRate } from "@/components/BlueRateProvider";
import { useBudgetWorkspace } from "@/components/BudgetWorkspaceProvider";
import { ApiError, downloadBudgetPdf } from "@/lib/api";
import { convertAmount, formatCurrency, formatDate, formatQuantity } from "@/lib/format";
import type { Budget, BudgetItem, BudgetStatus } from "@/lib/types";

/** The currencies the preview can show a budget in. */
type DisplayCurrency = "ARS" | "USD";

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

/**
 * Price a budget in dollars at the given rate.
 *
 * Each line is converted and rounded on its own and the totals are rebuilt
 * from those lines, which is what `services/pdf_service.convert_budget` does,
 * so the screen and the PDF always agree.
 */
function convertBudget(budget: Budget, rate: number): Budget {
  const items = budget.items.map((item) => ({
    ...item,
    unit_price: convertAmount(item.unit_price, rate),
    line_total: convertAmount(item.line_total, rate),
  }));

  const subtotal = roundToCents(items.reduce((total, item) => total + item.line_total, 0));
  const taxAmount = roundToCents((subtotal * budget.tax_rate) / 100);

  return {
    ...budget,
    items,
    subtotal,
    tax_amount: taxAmount,
    total: roundToCents(subtotal + taxAmount),
  };
}

/** Round to two decimals without the floating point noise. */
function roundToCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Sum the line totals of a group of items. */
function sumLines(items: BudgetItem[]): number {
  return items.reduce((total, item) => total + item.line_total, 0);
}

/**
 * The budget being worked on, however its lines got there: added by hand
 * from the form, or written by the assistant.
 */
export default function BudgetPreview() {
  const { budget, isLoading, isSaving, error, removeItem, reload, startNewBudget } =
    useBudgetWorkspace();
  const [isExporting, setIsExporting] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("ARS");
  const { rate: blueRate } = useBlueRate();
  // Kept apart from `error`, so a failed export does not replace the budget.
  const [exportError, setExportError] = useState<string | null>(null);

  // The budget is stored in pesos; dollars are a converted view of it.
  const storedCurrency = (budget?.currency ?? "ARS").toUpperCase();
  const sellRate = blueRate?.sell ?? null;
  const isConverted = displayCurrency !== storedCurrency && sellRate !== null;
  const view = useMemo(
    () => (budget && isConverted ? convertBudget(budget, sellRate as number) : budget),
    [budget, isConverted, sellRate],
  );

  /** Remove a line, asking first: the budget is stored, not a draft. */
  function handleRemove(itemId: string) {
    const item = budget?.items.find((line) => line.id === itemId);

    if (item && window.confirm(`¿Quitar "${item.description}" del presupuesto?`)) {
      void removeItem(itemId);
    }
  }

  /** Download the budget as a PDF rendered by the backend. */
  async function exportPdf() {
    if (!budget) {
      return;
    }

    setIsExporting(true);

    try {
      // The file must show the same figures as the screen, so the rate
      // travels with the request.
      await downloadBudgetPdf(budget.id, `presupuesto-${budget.budget_number}.pdf`, {
        currency: displayCurrency,
        rate: isConverted ? (sellRate as number) : undefined,
      });
      setExportError(null);
    } catch (caught) {
      setExportError(
        caught instanceof ApiError ? caught.message : "No se pudo exportar el PDF.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  const materials = view?.items.filter((item) => item.item_type === "material") ?? [];
  const labor = view?.items.filter((item) => item.item_type === "task") ?? [];
  const other = view?.items.filter((item) => item.item_type === "custom") ?? [];
  const currency = displayCurrency;

  return (
    <section
      aria-label="Vista previa del presupuesto"
      className="print-area flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
    >
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Vista previa del presupuesto</h2>
          <p className="truncate text-xs text-muted">
            {budget
              ? `#${budget.budget_number} · ${budget.title}`
              : "Acá aparece el último presupuesto que guarde el agente"}
          </p>
        </div>

        <div className="no-print flex shrink-0 flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Moneda del presupuesto"
            className="flex items-center rounded-lg border border-border p-0.5"
          >
            {(["ARS", "USD"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDisplayCurrency(option)}
                disabled={option !== storedCurrency && sellRate === null}
                title={
                  option !== storedCurrency && sellRate === null
                    ? "Sin cotización del blue para convertir"
                    : undefined
                }
                aria-pressed={displayCurrency === option}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  displayCurrency === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {option === "ARS" ? "$" : "u$s"}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={reload}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => void startNewBudget()}
            disabled={isSaving}
            title="Empezar un presupuesto vacío"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            Nuevo
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

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        {exportError ? (
          <p className="no-print mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
            {exportError}
          </p>
        ) : null}

        {isLoading && !budget ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : error ? (
          <div className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
        ) : !budget || !view ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm font-medium">Todavía no hay nada cargado</p>
            <p className="mt-1 max-w-xs text-sm text-muted">
              Agregá materiales y mano de obra desde el formulario de arriba, o pedile
              al asistente que lo arme por vos.
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
              {isConverted ? (
                <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">
                  Blue venta {formatCurrency(sellRate as number, "ARS")}
                </span>
              ) : null}
            </div>

            {budget.description ? (
              <p className="text-sm text-muted">{budget.description}</p>
            ) : null}

            <ItemGroup
              title="Materiales"
              items={materials}
              currency={currency}
              onRemove={handleRemove}
              isSaving={isSaving}
            />
            <ItemGroup
              title="Mano de obra"
              items={labor}
              currency={currency}
              onRemove={handleRemove}
              isSaving={isSaving}
            />
            <ItemGroup
              title="Otros costos"
              items={other}
              currency={currency}
              onRemove={handleRemove}
              isSaving={isSaving}
            />

            <dl className="space-y-2 border-t border-border pt-4 text-sm">
              <Row label="Materiales" value={formatCurrency(sumLines(materials), currency)} />
              <Row label="Mano de obra" value={formatCurrency(sumLines(labor), currency)} />
              {other.length > 0 ? (
                <Row label="Otros costos" value={formatCurrency(sumLines(other), currency)} />
              ) : null}
              <Row label="Subtotal" value={formatCurrency(view.subtotal, currency)} />
              <Row
                label={`IVA (${formatQuantity(view.tax_rate)}%)`}
                value={formatCurrency(view.tax_amount, currency)}
              />
              <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
                <dt>Total</dt>
                <dd>{formatCurrency(view.total, currency)}</dd>
              </div>
            </dl>

            {isConverted ? (
              <p className="text-xs text-muted">
                Equivale a {formatCurrency(budget.total, storedCurrency)} al dólar blue
                vendedor de {formatCurrency(sellRate as number, "ARS")}. La cotización puede
                variar hasta la aceptación del presupuesto.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/** One labelled amount in the totals list. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-muted">
      <dt className="min-w-0">{label}</dt>
      <dd className="whitespace-nowrap font-medium text-foreground">{value}</dd>
    </div>
  );
}

/** A table of budget lines, hidden when the group is empty. */
function ItemGroup({
  title,
  items,
  currency,
  onRemove,
  isSaving,
}: {
  title: string;
  items: BudgetItem[];
  currency: string | undefined;
  onRemove: (itemId: string) => void;
  isSaving: boolean;
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
              <p className="text-sm break-words">{item.description}</p>
              <p className="text-xs text-muted">
                {formatQuantity(item.quantity)} {item.unit} ×{" "}
                {formatCurrency(item.unit_price, currency)}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-sm font-medium">
                {formatCurrency(item.line_total, currency)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                disabled={isSaving}
                aria-label={`Quitar ${item.description}`}
                title="Quitar del presupuesto"
                className="no-print rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
