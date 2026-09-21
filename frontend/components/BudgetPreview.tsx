"use client";

import { useMemo, useState } from "react";
import { useBlueRate } from "@/components/BlueRateProvider";
import { useBudgetWorkspace } from "@/components/BudgetWorkspaceProvider";
import ClientField from "@/components/ClientField";
import SiteConditions from "@/components/SiteConditions";
import { ApiError, downloadBudgetPdf } from "@/lib/api";
import { convertAmount, formatCurrency, formatDate, formatQuantity } from "@/lib/format";
import { MAX_QUANTITY_TEXT } from "@/lib/materialList";
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

/**
 * What labour and materials are multiplied by, from the conditions applied.
 *
 * Mirrors `services/pricing_service.multipliers`: the percentages add up
 * rather than compound, and a condition that is only stated changes nothing.
 */
function multipliers(budget: Budget): { labor: number; materials: number } {
  let labor = 0;
  let materials = 0;

  for (const factor of budget.site_factors ?? []) {
    if (factor.applies_to === "materials") materials += factor.percent;
    if (factor.applies_to === "labor") labor += factor.percent;
  }

  return { labor: 1 + labor / 100, materials: 1 + materials / 100 };
}

/** True when the line is a job quoted whole, with no quantity to speak of. */
function isWholeJob(item: BudgetItem): boolean {
  return item.unit === "global" && item.quantity === 1;
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
  const {
    budget,
    isLoading,
    isSaving,
    error,
    removeItem,
    updateItemQuantity,
    updateListedQuantity,
    updateItemPrice,
    setItemQuoted,
    assignClient,
    setSiteFactors,
    reload,
    startNewBudget,
  } = useBudgetWorkspace();
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

  /** Correct how much of a line the job needs. */
  function handleQuantityChange(itemId: string, quantity: number) {
    void updateItemQuantity(itemId, quantity);
  }

  /**
   * Correct what a line charges.
   *
   * The screen shows the price with the site conditions already in it, which
   * is the number being typed over, so it is taken back to its base before
   * being stored — what is typed is what the budget will read.
   */
  function handlePriceChange(itemId: string, chargedPrice: number) {
    const item = budget?.items.find((line) => line.id === itemId);
    if (!item) return;

    const { labor, materials } = multipliers(budget as Budget);
    const multiplier = item.item_type === "material" ? materials : labor;

    void updateItemPrice(itemId, roundToCents(chargedPrice / multiplier));
  }

  /** Move a line between what is charged and what the customer buys. */
  function handleToggleQuoted(itemId: string, isQuoted: boolean) {
    void setItemQuoted(itemId, isQuoted);
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

  // Lines the customer buys are listed apart and add nothing.
  const quoted = view?.items.filter((item) => item.is_quoted !== false) ?? [];
  const supplied = view?.items.filter((item) => item.is_quoted === false) ?? [];
  const materials = quoted.filter((item) => item.item_type === "material");
  const labor = quoted.filter((item) => item.item_type === "task");
  const packages = quoted.filter((item) => item.item_type === "custom");
  const currency = displayCurrency;

  return (
    <section
      aria-label="Vista previa del presupuesto"
      className="print-area flex flex-col rounded-xl border border-border bg-surface shadow-sm"
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

      <div className="px-4 py-4 sm:px-5 sm:py-5">
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
          <div className="flex flex-col items-center justify-center py-10 text-center">
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

            <ClientField
              clientId={budget.client_id}
              isSaving={isSaving}
              onSelect={(clientId) => void assignClient(clientId)}
            />

            {budget.description ? (
              <p className="text-sm text-muted">{budget.description}</p>
            ) : null}

            <ItemGroup
              title="Trabajos"
              items={packages}
              currency={currency}
              onRemove={handleRemove}
              onQuantityChange={handleQuantityChange}
              onPriceChange={handlePriceChange}
              onToggleQuoted={handleToggleQuoted}
              isSaving={isSaving}
            />
            <ItemGroup
              title="Materiales"
              items={materials}
              currency={currency}
              onRemove={handleRemove}
              onQuantityChange={handleQuantityChange}
              onPriceChange={handlePriceChange}
              onToggleQuoted={handleToggleQuoted}
              isSaving={isSaving}
            />
            <ItemGroup
              title="Mano de obra"
              items={labor}
              currency={currency}
              onRemove={handleRemove}
              onQuantityChange={handleQuantityChange}
              onPriceChange={handlePriceChange}
              onToggleQuoted={handleToggleQuoted}
              isSaving={isSaving}
            />

            <ItemGroup
              title="A cargo del cliente"
              items={supplied}
              currency={currency}
              onRemove={handleRemove}
              onQuantityChange={handleQuantityChange}
              onPriceChange={handlePriceChange}
              onToggleQuoted={handleToggleQuoted}
              isSaving={isSaving}
              onListedQuantityChange={(itemId, typed) => void updateListedQuantity(itemId, typed)}
              isSupplied
            />

            <SiteConditions
              budget={budget}
              isSaving={isSaving}
              onChange={(codes) => void setSiteFactors(codes)}
            />

            <dl className="space-y-2 border-t border-border pt-4 text-sm">
              {packages.length > 0 ? (
                <Row label="Trabajos" value={formatCurrency(sumLines(packages), currency)} />
              ) : null}
              {materials.length > 0 ? (
                <Row label="Materiales" value={formatCurrency(sumLines(materials), currency)} />
              ) : null}
              {labor.length > 0 ? (
                <Row label="Mano de obra" value={formatCurrency(sumLines(labor), currency)} />
              ) : null}
              <Row label="Subtotal" value={formatCurrency(view.subtotal, currency)} />
              {view.tax_rate > 0 ? (
                <Row
                  label={`IVA (${formatQuantity(view.tax_rate)}%)`}
                  value={formatCurrency(view.tax_amount, currency)}
                />
              ) : null}
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
  onQuantityChange,
  onPriceChange,
  onToggleQuoted,
  isSaving,
  onListedQuantityChange,
  isSupplied = false,
}: {
  title: string;
  items: BudgetItem[];
  currency: string | undefined;
  onRemove: (itemId: string) => void;
  onQuantityChange: (itemId: string, quantity: number) => void;
  onPriceChange: (itemId: string, unitPrice: number) => void;
  onToggleQuoted: (itemId: string, isQuoted: boolean) => void;
  isSaving: boolean;
  /** Save a listed quantity as typed: a number, or "1/2", "2 o 3". */
  onListedQuantityChange?: (itemId: string, typed: string) => void;
  /** Listed for the customer to buy: quantities, no money. */
  isSupplied?: boolean;
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

              {/* What the price covers, as it was written line by line. */}
              {item.detail ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
                  {item.detail
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line, index) => (
                      <li key={index} className="break-words">
                        {line}
                      </li>
                    ))}
                </ul>
              ) : null}

              {/* A job quoted whole, or a bare name on the list, shows none. */}
              {isWholeJob(item) ||
              (isSupplied && !item.unit && item.quantity === 1 && !item.quantity_text) ? null : (
                <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
                  {isSupplied ? (
                    <ListedQuantityCell
                      item={item}
                      isSaving={isSaving}
                      onSave={(typed) => onListedQuantityChange?.(item.id, typed)}
                    />
                  ) : (
                    <QuantityCell
                      item={item}
                      isSaving={isSaving}
                      onSave={(quantity) => onQuantityChange(item.id, quantity)}
                    />
                  )}
                  {isSupplied ? (
                    <span>{item.unit}</span>
                  ) : (
                    <>
                      <span>{item.unit} ×</span>
                      <AmountCell
                        amount={item.unit_price}
                        currency={currency}
                        isSaving={isSaving}
                        label={`Precio unitario de ${item.description}`}
                        onSave={(price) => onPriceChange(item.id, price)}
                      />
                    </>
                  )}
                </p>
              )}

              {item.note ? (
                <p className="mt-1 text-xs italic text-muted break-words">{item.note}</p>
              ) : null}
            </div>
            <span className="flex shrink-0 items-center gap-2">
              {isSupplied ? (
                <span className="whitespace-nowrap text-xs text-muted">lo pone el cliente</span>
              ) : isWholeJob(item) ? (
                <AmountCell
                  amount={item.line_total}
                  currency={currency}
                  isSaving={isSaving}
                  label={`Precio de ${item.description}`}
                  className="text-sm font-medium"
                  onSave={(price) => onPriceChange(item.id, price)}
                />
              ) : (
                <span className="whitespace-nowrap text-sm font-medium">
                  {formatCurrency(item.line_total, currency)}
                </span>
              )}
              {isSupplied ? null : (
                <button
                  type="button"
                  onClick={() => onToggleQuoted(item.id, false)}
                  disabled={isSaving}
                  title="Pasarlo a la lista que compra el cliente"
                  aria-label={`Dejar al cliente ${item.description}`}
                  className="no-print rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-40"
                >
                  ☰
                </button>
              )}
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

/**
 * Quantity that turns into an input when clicked.
 *
 * The number shown is the final one, waste included, so what is typed here
 * replaces it rather than being marked up again.
 */
function QuantityCell({
  item,
  isSaving,
  onSave,
}: {
  item: BudgetItem;
  isSaving: boolean;
  onSave: (quantity: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  // Seeded when editing starts, so a quantity changed elsewhere is picked up
  // without syncing props into state.
  const [value, setValue] = useState("");

  function commit() {
    setIsEditing(false);
    const quantity = Number(value.replace(",", "."));

    if (!Number.isFinite(quantity) || quantity <= 0 || quantity === item.quantity) {
      return;
    }

    onSave(quantity);
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        disabled={isSaving}
        onClick={() => {
          setValue(String(item.quantity));
          setIsEditing(true);
        }}
        title="Tocá para cambiar la cantidad"
        aria-label={`Cantidad de ${item.description}`}
        // Negative margins keep the line height while the tap target grows.
        className="-mx-1.5 -my-1 rounded-md px-1.5 py-1 tabular-nums underline decoration-dotted decoration-muted/60 underline-offset-2 transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-50"
      >
        {formatQuantity(item.quantity)}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      min={0}
      step="0.001"
      value={value}
      aria-label={`Cantidad de ${item.description}`}
      // Select the current quantity so typing replaces it.
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        }
        if (event.key === "Escape") {
          setIsEditing(false);
        }
      }}
      className="no-print w-20 rounded-md border border-primary bg-background px-1.5 py-0.5 text-xs outline-none"
    />
  );
}

/**
 * A listed line's quantity, edited as text.
 *
 * The list only informs, so the quantity is whatever makes sense to write:
 * "3", "1/2", "2 o 3". It shows what was written, or the number when nothing
 * was.
 */
function ListedQuantityCell({
  item,
  isSaving,
  onSave,
}: {
  item: BudgetItem;
  isSaving: boolean;
  onSave: (typed: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const shown = item.quantity_text || formatQuantity(item.quantity);

  function commit() {
    setIsEditing(false);
    const typed = value.trim();

    // Blank leaves it as it was: a listed line always says how much.
    if (!typed || typed === shown) {
      return;
    }

    onSave(typed);
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        disabled={isSaving}
        onClick={() => {
          setValue(shown);
          setIsEditing(true);
        }}
        title="Tocá para cambiar la cantidad (acepta 1/2, 2 o 3…)"
        aria-label={`Cantidad de ${item.description}`}
        className="-mx-1.5 -my-1 rounded-md px-1.5 py-1 tabular-nums underline decoration-dotted decoration-muted/60 underline-offset-2 transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-50"
      >
        {shown}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      maxLength={MAX_QUANTITY_TEXT}
      value={value}
      aria-label={`Cantidad de ${item.description}`}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        }
        if (event.key === "Escape") {
          setIsEditing(false);
        }
      }}
      className="no-print w-24 rounded-md border border-primary bg-background px-1.5 py-0.5 text-xs outline-none"
    />
  );
}

/**
 * An amount that turns into an input when clicked.
 *
 * What is shown already carries the site conditions, so what is typed is what
 * the budget will read: the caller takes it back to its base price.
 */
function AmountCell({
  amount,
  currency,
  isSaving,
  label,
  className = "",
  onSave,
}: {
  amount: number;
  currency: string | undefined;
  isSaving: boolean;
  label: string;
  className?: string;
  onSave: (amount: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  // Seeded when editing starts, so a price changed elsewhere is picked up
  // without syncing props into state.
  const [value, setValue] = useState("");

  function commit() {
    setIsEditing(false);
    // Thousands are typed with dots, the way prices are written here.
    const price = Number(value.replace(/\./g, "").replace(",", "."));

    if (!Number.isFinite(price) || price < 0 || price === amount) {
      return;
    }

    onSave(price);
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        disabled={isSaving}
        onClick={() => {
          setValue(String(amount));
          setIsEditing(true);
        }}
        title="Tocá para cambiar el precio"
        aria-label={label}
        className={`-mx-1.5 -my-1 rounded-md px-1.5 py-1 tabular-nums underline decoration-dotted decoration-muted/60 underline-offset-2 transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-50 ${className}`}
      >
        {formatCurrency(amount, currency)}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      inputMode="numeric"
      value={value}
      aria-label={label}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setIsEditing(false);
      }}
      className="no-print w-28 rounded-md border border-primary bg-background px-1.5 py-0.5 text-right text-xs outline-none"
    />
  );
}
