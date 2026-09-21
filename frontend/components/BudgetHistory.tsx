"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StatusPicker from "@/components/StatusPicker";
import {
  ApiError,
  deleteBudget,
  downloadBudgetPdf,
  listBudgets,
  listClients,
  updateBudget,
} from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { BUDGET_STATUSES, STATUS_LABELS } from "@/lib/status";
import type { Budget, BudgetStatus } from "@/lib/types";

const HISTORY_LIMIT = 100;

/** Which budgets the list shows. */
type Filter = BudgetStatus | "all";

const FILTERS: readonly Filter[] = ["all", ...BUDGET_STATUSES];

/**
 * Every budget that was saved, newest first.
 *
 * The workspace only ever shows the one being worked on, so this is the way
 * back to the others: move them along as the job goes, reopen them, export
 * the PDF again, or delete one made by mistake.
 */
export default function BudgetHistory() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // The budget whose status or deletion is being saved.
  const [savingId, setSavingId] = useState<string | null>(null);
  // Deleting takes two taps: this is the one waiting for the second.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
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
        setClientNames(Object.fromEntries(rows.map((row) => [row.id, row.full_name])));
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

  /** Move a budget to another status, right from the list. */
  async function handleStatusChange(budget: Budget, status: BudgetStatus) {
    setSavingId(budget.id);

    try {
      const saved = await updateBudget(budget.id, { status });
      // The list holds headers only; the answer brings the lines too.
      setBudgets((current) =>
        current.map((row) => (row.id === budget.id ? { ...saved, items: [] } : row)),
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo cambiar el estado.");
    } finally {
      setSavingId(null);
    }
  }

  /** Delete a budget for good, once the second tap confirms it. */
  async function handleDelete(budget: Budget) {
    setSavingId(budget.id);

    try {
      await deleteBudget(budget.id);
      setBudgets((current) => current.filter((row) => row.id !== budget.id));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo eliminar el presupuesto.",
      );
    } finally {
      setSavingId(null);
      setConfirmingId(null);
    }
  }

  const counts = Object.fromEntries(
    BUDGET_STATUSES.map((status) => [
      status,
      budgets.filter((budget) => budget.status === status).length,
    ]),
  ) as Record<BudgetStatus, number>;
  const shown = filter === "all" ? budgets : budgets.filter((budget) => budget.status === filter);

  /** A row's buttons — or, while deleting, the question that confirms it. */
  function renderActions(budget: Budget, className = "") {
    if (confirmingId === budget.id) {
      return (
        <div className={`flex flex-wrap items-center gap-2 ${className}`}>
          <span className="text-xs font-medium text-danger">
            ¿Eliminar el N° {budget.budget_number}? No se puede deshacer.
          </span>
          <button
            type="button"
            disabled={savingId === budget.id}
            onClick={() => void handleDelete(budget)}
            className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {savingId === budget.id ? "Eliminando…" : "Sí, eliminar"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingId(null)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            No
          </button>
        </div>
      );
    }

    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <OpenLink budgetId={budget.id} className="flex-1 text-center md:flex-none" />
        <PdfButton
          onClick={() => void handleDownload(budget)}
          isBusy={downloadingId === budget.id}
          className="flex-1 md:flex-none"
        />
        <button
          type="button"
          onClick={() => setConfirmingId(budget.id)}
          disabled={savingId === budget.id}
          aria-label={`Eliminar el presupuesto ${budget.budget_number}`}
          className="flex-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50 md:flex-none"
        >
          Eliminar
        </button>
      </div>
    );
  }

  function renderStatus(budget: Budget) {
    return (
      <StatusPicker
        status={budget.status}
        disabled={savingId === budget.id}
        label={`Estado del presupuesto ${budget.budget_number}`}
        onChange={(status) => void handleStatusChange(budget, status)}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Presupuestos</h1>
          <p className="mt-1 text-sm text-muted">
            Los que ya guardaste. Cambiales el estado a medida que avanza la obra, abrí uno
            para seguir editándolo o bajá el PDF de nuevo.
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
          <div role="tablist" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
            {FILTERS.map((option) => {
              const isActive = filter === option;
              const count = option === "all" ? budgets.length : counts[option];

              return (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setFilter(option)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  {option === "all" ? "Todos" : STATUS_LABELS[option]} ({count})
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
              No hay presupuestos en «{filter === "all" ? "Todos" : STATUS_LABELS[filter]}».
            </p>
          ) : (
            <>
              {/* Phones: one card per budget, nothing to scroll sideways. */}
              <ul className="flex flex-col gap-3 md:hidden">
                {shown.map((budget) => (
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
                      <p className="shrink-0 text-lg font-semibold">
                        {formatCurrency(budget.total, budget.currency)}
                      </p>
                    </div>

                    <div className="mt-3">{renderStatus(budget)}</div>

                    {renderActions(budget, "mt-3")}
                  </li>
                ))}
              </ul>

              {/* Desktop: the same rows as a table. */}
              <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface shadow-sm md:block">
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
                    {shown.map((budget) => (
                      <tr key={budget.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 text-muted">{budget.budget_number}</td>
                        <td className="max-w-xs truncate px-4 py-3 font-medium">
                          {budget.title}
                        </td>
                        <td className="max-w-[12rem] truncate px-4 py-3 text-muted">
                          {clientNames[budget.client_id] ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          {formatDate(budget.created_at)}
                        </td>
                        <td className="px-4 py-3">{renderStatus(budget)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                          {formatCurrency(budget.total, budget.currency)}
                        </td>
                        <td className="px-4 py-3">{renderActions(budget, "justify-end")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
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
