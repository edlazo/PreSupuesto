"use client";

import { useEffect, useState } from "react";
import { ApiError, listPricingFactors, updatePricingFactor } from "@/lib/api";
import { formatCurrency, formatQuantity } from "@/lib/format";
import type { AppliedFactor, Budget, PricingFactor } from "@/lib/types";

interface SiteConditionsProps {
  budget: Budget;
  isSaving: boolean;
  onChange: (codes: string[]) => void;
}

/**
 * What the job costs given where it happens.
 *
 * The trade prices the same work differently in a flat, with nowhere to park,
 * or on hours the client imposes. Ticking a condition raises the prices the
 * budget charges: the backend keeps the base and spreads the surcharge across
 * the lines, so the customer reads a price and never a percentage.
 */
export default function SiteConditions({ budget, isSaving, onChange }: SiteConditionsProps) {
  const [factors, setFactors] = useState<PricingFactor[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    listPricingFactors(true)
      .then((rows) => {
        if (isActive) setFactors(rows);
      })
      .catch((caught: unknown) => {
        if (!isActive) return;
        setError(
          caught instanceof ApiError ? caught.message : "No se pudieron cargar las condiciones.",
        );
      });

    return () => {
      isActive = false;
    };
  }, []);

  const applied: AppliedFactor[] = budget.site_factors ?? [];
  const appliedCodes = new Set(applied.map((factor) => factor.code));

  // The budget already arrives charged, so these are the raised amounts.
  const labourCharged = budget.items
    .filter((item) => item.item_type !== "material")
    .reduce((total, item) => total + item.line_total, 0);
  const materialsCharged = budget.items
    .filter((item) => item.item_type === "material")
    .reduce((total, item) => total + item.line_total, 0);

  // The percentages add up rather than compound: "40% más" three times is
  // +130%, not +194%.
  const labourPercent = applied
    .filter((factor) => factor.applies_to === "labor")
    .reduce((total, factor) => total + factor.percent, 0);
  const materialsPercent = applied
    .filter((factor) => factor.applies_to === "materials")
    .reduce((total, factor) => total + factor.percent, 0);

  // What the conditions added, read back out of the charged amounts.
  const labourAdded = labourCharged - labourCharged / (1 + labourPercent / 100);
  const materialsAdded = materialsCharged - materialsCharged / (1 + materialsPercent / 100);
  const hasSurcharge = labourPercent !== 0 || materialsPercent !== 0;

  // The closed panel says what is applied, and to what.
  const badge = [
    labourPercent ? `+${formatQuantity(labourPercent)}% mano de obra` : null,
    materialsPercent ? `+${formatQuantity(materialsPercent)}% materiales` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function toggle(factor: PricingFactor) {
    const next = new Set(appliedCodes);

    if (next.has(factor.code)) {
      next.delete(factor.code);
      onChange([...next]);
      return;
    }

    // Alternatives replace each other: the job is in the province or in the
    // capital, never both.
    if (factor.exclusive_group) {
      for (const other of factors) {
        if (other.code !== factor.code && other.exclusive_group === factor.exclusive_group) {
          next.delete(other.code);
        }
      }
    }

    next.add(factor.code);
    onChange([...next]);
  }

  /** Tune what a condition adds, from here rather than a settings screen. */
  async function savePercent(factor: PricingFactor, percent: number) {
    try {
      const updated = await updatePricingFactor(factor.id, { percent });
      setFactors((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      setError(null);

      // The budget carries a frozen copy, so it has to be taken again.
      if (appliedCodes.has(factor.code)) {
        onChange([...appliedCodes]);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo guardar el porcentaje.");
    }
  }

  return (
    <section className="no-print rounded-lg border border-border bg-surface-muted">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-semibold">
          Condiciones de obra
          {badge ? (
            <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[0.65rem] font-medium text-primary">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted">{isOpen ? "Ocultar" : "Ver"}</span>
      </button>

      {isOpen ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <p className="text-xs text-muted">
            Esto es para vos: el cliente nunca ve el recargo, solo el precio final.
          </p>

          {error ? <p className="text-xs text-danger">{error}</p> : null}

          <ul className="space-y-1.5">
            {factors.map((factor) => (
              <li key={factor.id} className="flex items-center justify-between gap-2">
                <label className="flex min-w-0 items-center gap-2 text-xs">
                  <input
                    // Alternatives read as a choice, so they are drawn round.
                    type={factor.exclusive_group ? "radio" : "checkbox"}
                    name={factor.exclusive_group ?? undefined}
                    checked={appliedCodes.has(factor.code)}
                    disabled={isSaving}
                    onChange={() => toggle(factor)}
                    onClick={() => {
                      // A radio cannot be unticked by itself; a second click
                      // on the chosen one drops it.
                      if (factor.exclusive_group && appliedCodes.has(factor.code)) {
                        toggle(factor);
                      }
                    }}
                    className="h-3.5 w-3.5 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{factor.label}</span>
                    <span className="block text-[0.65rem] text-muted">
                      sobre {factor.applies_to === "labor" ? "la mano de obra" : "los materiales"}
                    </span>
                  </span>
                </label>

                <PercentCell factor={factor} onSave={(percent) => void savePercent(factor, percent)} />
              </li>
            ))}
          </ul>

          {hasSurcharge ? (
            <dl className="space-y-1 border-t border-border pt-2 text-xs">
              <p className="pb-1 text-[0.65rem] text-muted">
                Los precios del presupuesto ya salen con esto adentro.
              </p>
              {labourPercent !== 0 ? (
                <Row
                  label={`Mano de obra +${formatQuantity(labourPercent)}%`}
                  value={`+ ${formatCurrency(labourAdded)}`}
                />
              ) : null}
              {materialsPercent !== 0 && materialsCharged > 0 ? (
                <Row
                  label={`Materiales +${formatQuantity(materialsPercent)}%`}
                  value={`+ ${formatCurrency(materialsAdded)}`}
                />
              ) : null}
              <div className="flex items-center justify-between pt-1 font-semibold text-foreground">
                <dt>Suman al presupuesto</dt>
                <dd className="tabular-nums">{formatCurrency(labourAdded + materialsAdded)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-muted">
              Marcá lo que corresponda y te digo cuánto debería salir.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** The percentage, editable in place: these numbers change with the trade. */
function PercentCell({
  factor,
  onSave,
}: {
  factor: PricingFactor;
  onSave: (percent: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");

  function commit() {
    setIsEditing(false);
    const percent = Number(value.replace(",", "."));

    if (!Number.isFinite(percent) || percent === factor.percent) {
      return;
    }

    onSave(percent);
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(factor.percent));
          setIsEditing(true);
        }}
        title="Tocá para cambiar el porcentaje"
        aria-label={`Porcentaje de ${factor.label}`}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums transition-colors hover:bg-primary-soft hover:text-primary"
      >
        +{formatQuantity(factor.percent)}%
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      step="1"
      value={value}
      aria-label={`Porcentaje de ${factor.label}`}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setIsEditing(false);
      }}
      className="w-16 shrink-0 rounded-md border border-primary bg-background px-1.5 py-0.5 text-right text-xs outline-none"
    />
  );
}
