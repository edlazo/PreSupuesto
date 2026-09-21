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

/** How the line being added is priced. */
type EntryMode = "package" | "catalog";

const MODES: { id: EntryMode; label: string; hint: string }[] = [
  { id: "package", label: "Partida", hint: "Describís el trabajo y ponés un precio" },
  { id: "catalog", label: "Del catálogo", hint: "Material o mano de obra por cantidad" },
];

const MAX_RESULTS = 8;

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary";

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
 * How lines get into a budget.
 *
 * The everyday way is a work package: a described job with one round price,
 * which is how these quotes are written by hand. Pricing from the catalog by
 * quantity is the other way, for when the job is measured.
 */
export default function ManualEntryForm() {
  const { addItem, isSaving } = useBudgetWorkspace();

  const [mode, setMode] = useState<EntryMode>("package");
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Catalog side.
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [quantity, setQuantity] = useState("");
  const [waste, setWaste] = useState("");
  const [isListOpen, setIsListOpen] = useState(false);

  // Work package side.
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");

  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

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
  const parsedPrice = Number(price.replace(/\./g, "").replace(",", "."));
  const hasValidQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0;
  const hasValidPrice = Number.isFinite(parsedPrice) && parsedPrice > 0;

  const canSubmit =
    !isSaving &&
    (mode === "package"
      ? title.trim() !== "" && hasValidPrice
      : selected !== null && hasValidQuantity);

  const lineTotal =
    mode === "package"
      ? hasValidPrice
        ? parsedPrice
        : 0
      : selected && hasValidQuantity
        ? selected.price *
          parsedQuantity *
          (selected.kind === "material" && Number.isFinite(parsedWaste)
            ? 1 + parsedWaste / 100
            : 1)
        : 0;

  function pick(entry: CatalogEntry) {
    setSelected(entry);
    setSearch("");
    setIsListOpen(false);
    setNotice(null);
    quantityRef.current?.focus();
  }

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    if (mode === "package") {
      await addItem({
        description: title.trim(),
        detail: detail.trim() || null,
        note: note.trim() || null,
        // A package is quoted whole, so there is nothing to multiply.
        unit_price: parsedPrice,
        quantity: 1,
      });

      setNotice(`Agregado: ${title.trim()}`);
      setTitle("");
      setDetail("");
      setNote("");
      setPrice("");
      titleRef.current?.focus();
      return;
    }

    if (!selected) return;

    await addItem({
      material_id: selected.kind === "material" ? selected.id : null,
      standard_task_id: selected.kind === "task" ? selected.id : null,
      quantity: parsedQuantity,
      waste_percent:
        selected.kind === "material" && Number.isFinite(parsedWaste) ? parsedWaste : 0,
    });

    setNotice(`Agregado: ${selected.name}`);
    setSelected(null);
    setQuantity("");
    setWaste("");
    searchRef.current?.focus();
  }

  const activeMode = MODES.find((option) => option.id === mode);

  return (
    <section
      aria-labelledby="manual-entry-title"
      className="rounded-xl border border-border bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="manual-entry-title" className="text-sm font-semibold">
          Agregar al presupuesto
        </h2>

        <div
          role="group"
          aria-label="Cómo se cobra la línea"
          className="flex items-center rounded-lg border border-border p-0.5"
        >
          {MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setMode(option.id);
                setNotice(null);
              }}
              aria-pressed={mode === option.id}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === option.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1 text-xs text-muted">{activeMode?.hint}</p>

      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        {mode === "package" ? (
          <>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <label htmlFor={`${listId}-title`} className="text-xs font-medium text-muted">
                  Trabajo
                </label>
                <input
                  id={`${listId}-title`}
                  ref={titleRef}
                  type="text"
                  value={title}
                  placeholder="Demoler la pared que está más alta que el techo"
                  onChange={(event) => setTitle(event.target.value)}
                  className={`mt-1 ${FIELD_CLASS}`}
                />
              </div>

              <div className="w-full lg:w-44">
                <label htmlFor={`${listId}-price`} className="text-xs font-medium text-muted">
                  Precio del trabajo
                </label>
                <input
                  id={`${listId}-price`}
                  type="text"
                  inputMode="numeric"
                  value={price}
                  placeholder="1.600.000"
                  onChange={(event) => setPrice(event.target.value)}
                  className={`mt-1 ${FIELD_CLASS}`}
                />
              </div>
            </div>

            <div>
              <label htmlFor={`${listId}-detail`} className="text-xs font-medium text-muted">
                Qué incluye <span className="font-normal">(una línea por ítem, opcional)</span>
              </label>
              <textarea
                id={`${listId}-detail`}
                rows={3}
                value={detail}
                placeholder={
                  "Sacar la canaleta vieja\nProlongar la chapa 20 cm fuera de la pared\nCargar el escombro en contenedor"
                }
                onChange={(event) => setDetail(event.target.value)}
                className={`mt-1 resize-y ${FIELD_CLASS}`}
              />
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor={`${listId}-note`} className="text-xs font-medium text-muted">
                  Aclaración al lado del precio <span className="font-normal">(opcional)</span>
                </label>
                <input
                  id={`${listId}-note`}
                  type="text"
                  value={note}
                  placeholder="con las restricciones de la administración"
                  onChange={(event) => setNote(event.target.value)}
                  className={`mt-1 ${FIELD_CLASS}`}
                />
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? "Agregando…" : "Agregar al presupuesto"}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            {/* Search and pick ----------------------------------------------- */}
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
                    className={`mt-1 ${FIELD_CLASS}`}
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

            {/* Quantity ------------------------------------------------------ */}
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
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </div>

            {/* Waste, materials only ----------------------------------------- */}
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
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Agregando…" : "Agregar al presupuesto"}
            </button>
          </div>
        )}
      </form>

      <div className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
        {catalogError && mode === "catalog" ? (
          <span className="text-danger">{catalogError}</span>
        ) : lineTotal > 0 ? (
          <span className="text-muted">
            {mode === "package" ? "Esta partida suma: " : "Subtotal de la línea: "}
            <span className="font-medium text-foreground">{formatCurrency(lineTotal)}</span>
          </span>
        ) : notice ? (
          <span className="text-success">{notice}</span>
        ) : null}
      </div>
    </section>
  );
}
