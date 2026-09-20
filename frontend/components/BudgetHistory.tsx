"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, downloadBudgetPdf, listBudgets, listClients } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Budget, BudgetStatus } from "@/lib/types";

const HISTORY_LIMIT = 50;

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
 * Every budget that was saved, newest first.
 *
 * The workspace only ever shows the one being worked on, so this is the way
 * back to the ones already finished: reopen them or export the PDF again.
 */
export default function BudgetHistory() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Budgets carry a client id, not a name, so the names are looked up once.
  const [clientNames, setClientNames] = useState<Record<string, string>>({});

  useEffect(() => {
    // `isActive` drops the answer of a request a newer one has replaced.
    let isActive = true;

    listBudgets(HISTORY_LIMIT)
      .then((rows) => {
        if (!isActive) return;
        setBudgets(rows);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!isActive) return;
        setError(
          caught instanceof ApiError ? caught.message : "No se pudieron cargar los presupuestos.",
        );
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    listClients()
      .then((rows) => {
        if (!isActive) return;
        setClientNames(
          Object.fromEntries(rows.map((row) => [row.id, row.full_name])),
        );
      })
      .catch(() => {
        // A name is a nicety: the list still works without it.
      });

    return () => {
      isActive = false;
    };
  }, []);

  /** Download one budget in the currency it was saved with. */
  async function handleDownload(budget: Budget) {
    setDownloadingId(budget.id);

    try {
      await downloadBudgetPdf(budget.id, `presupuesto-${budget.budget_number}.pdf`);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo bajar el PDF.");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Presupuestos</h1>
          <p className="mt-1 text-sm text-muted">
            Los que ya guardaste. Abrí uno para seguir editándolo o bajá el PDF de nuevo.
          </p>
        </div>

        <Link
          href="/"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Ir al escritorio
        </Link>
      </div>

      {error ? (
        <p className="rounded-xl border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          Cargando presupuestos…
        </p>
      ) : budgets.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm font-medium">Todavía no guardaste ningún presupuesto</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Armá uno en el escritorio: apenas le agregues la primera línea queda guardado y
            aparece acá.
          </p>
        </div>
      ) : (
        <>
          {/* Phones: one card per budget, nothing to scroll sideways. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {budgets.map((budget) => (
              <li
                key={budget.id}
                className="rounded-xl border border-border bg-surface p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{budget.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      N° {budget.budget_number} · {formatDate(budget.created_at)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {clientNames[budget.client_id] ?? "Sin cliente"}
                    </p>
                  </div>
                  <StatusBadge status={budget.status} />
                </div>

                <p className="mt-3 text-lg font-semibold">
                  {formatCurrency(budget.total, budget.currency)}
                </p>

                <div className="mt-3 flex items-center gap-2">
                  <OpenLink budgetId={budget.id} className="flex-1 text-center" />
                  <PdfButton
                    onClick={() => void handleDownload(budget)}
                    isBusy={downloadingId === budget.id}
                    className="flex-1"
                  />
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: the same rows as a table. */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-surface shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">N°</th>
                  <th className="px-4 py-3 font-medium">Título</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((budget) => (
                  <tr key={budget.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-muted">{budget.budget_number}</td>
                    <td className="max-w-xs truncate px-4 py-3 font-medium">{budget.title}</td>
                    <td className="max-w-[12rem] truncate px-4 py-3 text-muted">
                      {clientNames[budget.client_id] ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {formatDate(budget.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={budget.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                      {formatCurrency(budget.total, budget.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <OpenLink budgetId={budget.id} />
                        <PdfButton
                          onClick={() => void handleDownload(budget)}
                          isBusy={downloadingId === budget.id}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: BudgetStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Opens the budget in the workspace, where it can be edited. */
function OpenLink({ budgetId, className = "" }: { budgetId: string; className?: string }) {
  return (
    <Link
      href={{ pathname: "/", query: { budget: budgetId } }}
      className={`rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary hover:text-primary ${className}`}
    >
      Abrir
    </Link>
  );
}

function PdfButton({
  onClick,
  isBusy,
  className = "",
}: {
  onClick: () => void;
  isBusy: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy}
      className={`rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-50 ${className}`}
    >
      {isBusy ? "Bajando…" : "PDF"}
    </button>
  );
}
