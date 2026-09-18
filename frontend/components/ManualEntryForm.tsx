"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useBudgetWorkspace } from "@/components/BudgetWorkspaceProvider";
import { ApiError, listMaterials, listStandardTasks } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import type { Material, StandardTask } from "@/lib/types";

/** One pickable catalog entry, from either catalog. */
interface CatalogEntry {
  key: string;
  kind: "material" | "task";
  id: string;
  code: string;
  name: string;
  group: string;
  unit: string;
  price: number;
}

const MAX_RESULTS = 8;

/** Fold accents and case, so "albanileria" finds "Albañilería". */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function toEntries(materials: Material[], tasks: StandardTask[]): CatalogEntry[] {
  return [
    ...materials.map((material) => ({
      key: `material-${material.id}`,
      kind: "material" as const,
      id: material.id,
      code: material.code,
      name: material.name,
      group: material.category,
      unit: material.unit,
      price: material.unit_price,
    })),
    ...tasks.map((task) => ({
      key: `task-${task.id}`,
      kind: "task" as const,
      id: task.id,
      code: task.code,
      name: task.name,
      group: task.trade,
      unit: task.unit,
      price: task.labor_unit_price,
    })),
  ];
}

/**
 * Primary way to build a budget: pick a material or a labor task, say how
 * much, and add the line. No assistant involved.
 */
export default function ManualEntryForm() {
  const { addItem, isSaving } = useBudgetWorkspace();

  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [quantity, setQuantity] = useState("");
  const [waste, setWaste] = useState("");
  const [isListOpen, setIsListOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  // Both catalogs are small enough to hold in memory and filter as you type.
  useEffect(() => {
    let isActive = true;

    Promise.all([listMaterials({ isActive: true, limit: 500 }), listStandardTasks()])
      .then(([materials, tasks]) => {
        if (!isActive) return;
        setEntries(toEntries(materials, tasks));
        setCatalogError(null);
      })
      .catch((caught: unknown) => {
        if (!isActive) return;
        setCatalogError(
          caught instanceof ApiError ? caught.message : "No se pudo cargar el catálogo.",
        );
      });

    return () => {
      isActive = false;
    };
  }, []);

  const results = useMemo(() => {
    const needle = normalize(search.trim());

    if (!needle) {
      return entries.slice(0, MAX_RESULTS);
    }

    return entries
      .filter(
        (entry) =>
          normalize(entry.name).includes(needle) ||
          normalize(entry.group).includes(needle) ||
          normalize(entry.code).includes(needle),
      )
      .slice(0, MAX_RESULTS);
  }, [entries, search]);

  const parsedQuantity = Number(quantity.replace(",", "."));
  const parsedWaste = waste.trim() === "" ? 0 : Number(waste.replace(",", "."));
  const hasValidQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0;
  const canSubmit = selected !== null && hasValidQuantity && !isSaving;

  const lineTotal =
    selected && hasValidQuantity
      ? selected.price *
        parsedQuantity *
        (selected.kind === "material" && Number.isFinite(parsedWaste) ? 1 + parsedWaste / 100 : 1)
      : 0;

  function pick(entry: CatalogEntry) {
    setSelected(entry);
    setSearch("");
    setIsListOpen(false);
    setNotice(null);
    quantityRef.current?.focus();
  }

  async function handleSubmit() {
    if (!selected || !hasValidQuantity) {
      return;
    }

    await addItem({
      material_id: selected.kind === "material" ? selected.id : null,
      standard_task_id: selected.kind === "task" ? selected.id : null,
      quantity: parsedQuantity,
      waste_percent: selected.kind === "material" && Number.isFinite(parsedWaste) ? parsedWaste : 0,
    });

    setNotice(`Agregado: ${selected.name}`);
    setSelected(null);
    setQuantity("");
    setWaste("");
    searchRef.current?.focus();
  }

  return (
    <section
      aria-labelledby="manual-entry-title"
      className="rounded-xl border border-border bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="manual-entry-title" className="text-sm font-semibold">
          Agregar al presupuesto
        </h2>
        <p className="text-xs text-muted">Elegí del catálogo, poné la cantidad y listo.</p>
      </div>

      <form
        className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        {/* Search and pick ------------------------------------------------- */}
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${listId}-search`} className="text-xs font-medium text-muted">
            Material o mano de obra
          </label>

          {selected ? (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-primary bg-primary-soft px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-primary">
                  {selected.name}
                </span>
                <span className="block text-xs text-primary">
                  {formatCurrency(selected.price)} por {selected.unit}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  searchRef.current?.focus();
                }}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-surface"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <input
                id={`${listId}-search`}
                ref={searchRef}
                type="text"
                role="combobox"
                aria-expanded={isListOpen}
                aria-controls={`${listId}-results`}
                aria-autocomplete="list"
                value={search}
                placeholder="Buscá ladrillo, pintura, colocación…"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setIsListOpen(true);
                }}
                onFocus={() => setIsListOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && results.length > 0) {
                    // Enter takes the first match, which is the common case.
                    event.preventDefault();
                    pick(results[0]);
                  }
                  if (event.key === "Escape") {
                    setIsListOpen(false);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary"
              />

              {isListOpen ? (
                <ul
                  id={`${listId}-results`}
                  role="listbox"
                  aria-label="Resultados del catálogo"
                  className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
                >
                  {results.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted">
                      No encontramos nada con ese nombre.
                    </li>
                  ) : (
                    results.map((entry) => (
                      <li key={entry.key} role="option" aria-selected={false}>
                        <button
                          type="button"
                          // The blur would close the list before the click lands.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => pick(entry)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm">{entry.name}</span>
                            <span className="block text-xs text-muted">
                              {entry.kind === "material" ? "Material" : "Mano de obra"} ·{" "}
                              {entry.group}
                            </span>
                          </span>
                          <span className="shrink-0 whitespace-nowrap text-xs font-medium">
                            {formatCurrency(entry.price)}/{entry.unit}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </>
          )}
        </div>

        {/* Quantity --------------------------------------------------------- */}
        <div className="w-full lg:w-28">
          <label htmlFor={`${listId}-quantity`} className="text-xs font-medium text-muted">
            Cantidad {selected ? `(${selected.unit})` : ""}
          </label>
          <input
            id={`${listId}-quantity`}
            ref={quantityRef}
            type="number"
            min={0}
            step="0.001"
            value={quantity}
            placeholder="0"
            onChange={(event) => setQuantity(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>

        {/* Waste, materials only -------------------------------------------- */}
        <div className={`w-full lg:w-28 ${selected?.kind === "task" ? "hidden" : ""}`}>
          <label htmlFor={`${listId}-waste`} className="text-xs font-medium text-muted">
            Desperdicio %
          </label>
          <input
            id={`${listId}-waste`}
            type="number"
            min={0}
            max={100}
            step="1"
            value={waste}
            placeholder="0"
            onChange={(event) => setWaste(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 lg:mb-0"
        >
          {isSaving ? "Agregando…" : "Agregar al presupuesto"}
        </button>
      </form>

      <div className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
        {catalogError ? (
          <span className="text-danger">{catalogError}</span>
        ) : lineTotal > 0 ? (
          <span className="text-muted">
            Subtotal de la línea: <span className="font-medium text-foreground">
              {formatCurrency(lineTotal)}
            </span>
          </span>
        ) : notice ? (
          <span className="text-success">{notice}</span>
        ) : null}
      </div>
    </section>
  );
}
