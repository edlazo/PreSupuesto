"use client";

import { useEffect, useMemo, useState } from "react";
import MaterialFormDialog from "@/components/MaterialFormDialog";
import {
  ApiError,
  bulkUpdateMaterialPrices,
  createMaterial,
  deleteMaterial,
  listMaterials,
  updateMaterial,
} from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import type { Material, MaterialCreate } from "@/lib/types";

/** Dialog state: closed, creating, or editing a specific material. */
type DialogState = { mode: "closed" } | { mode: "create" } | { mode: "edit"; material: Material };

export default function MaterialsTable() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");

  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });
  const [isSaving, setIsSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [bulkPercentage, setBulkPercentage] = useState("");
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);
  // Result of the last bulk update, shown until the next one runs.
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  // Wait for a pause in typing before querying the backend.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Bumped after a create, to pull the new row back from the server.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // `isActive` drops the response of a request that a newer one has replaced,
    // which matters while the search box is being typed in.
    let isActive = true;

    listMaterials({
      search: debouncedSearch || undefined,
      category: category || undefined,
      limit: 500,
    })
      .then((rows) => {
        if (!isActive) return;
        setMaterials(rows);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!isActive) return;
        setError(
          caught instanceof ApiError ? caught.message : "No se pudieron cargar los materiales.",
        );
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [debouncedSearch, category, reloadToken]);

  // Category options come from whatever the catalog currently holds.
  const categories = useMemo(
    () => Array.from(new Set(materials.map((material) => material.category))).sort(),
    [materials],
  );

  async function handleSubmit(values: MaterialCreate) {
    setIsSaving(true);
    setDialogError(null);

    try {
      if (dialog.mode === "edit") {
        const updated = await updateMaterial(dialog.material.id, values);
        setMaterials((current) =>
          current.map((material) => (material.id === updated.id ? updated : material)),
        );
      } else {
        await createMaterial(values);
        setReloadToken((current) => current + 1);
      }

      setDialog({ mode: "closed" });
    } catch (caught) {
      setDialogError(
        caught instanceof ApiError ? caught.message : "No se pudo guardar el material.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(material: Material) {
    setPendingDeleteId(material.id);
    setError(null);

    try {
      await deleteMaterial(material.id);
      setMaterials((current) => current.filter((row) => row.id !== material.id));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo eliminar el material.",
      );
    } finally {
      setPendingDeleteId(null);
    }
  }

  /** Ask before deleting, then delete. Shared by the table and the cards. */
  function confirmDelete(material: Material) {
    const confirmed = window.confirm(
      `¿Eliminar "${material.name}"? Los materiales que ya usa un presupuesto no se pueden eliminar: desactivalos en su lugar.`,
    );

    if (confirmed) {
      void handleDelete(material);
    }
  }

  /** Save a price edited inline in the table. */
  async function handlePriceChange(material: Material, price: number) {
    try {
      const updated = await updateMaterial(material.id, { unit_price: price });
      setMaterials((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo actualizar el precio.",
      );
    }
  }

  /** Apply a percentage change to the prices currently in scope. */
  async function handleBulkUpdate() {
    const percentage = Number(bulkPercentage.replace(",", "."));

    if (!Number.isFinite(percentage) || percentage === 0) {
      setError("Escribí un porcentaje distinto de cero.");
      return;
    }

    const scope = category ? `la categoría "${category}"` : "todo el catálogo";
    const direction = percentage > 0 ? "aumentar" : "reducir";
    const confirmed = window.confirm(
      `¿Seguro que querés ${direction} los precios de ${scope} un ` +
        `${Math.abs(percentage)}%? Solo afecta a los materiales activos.`,
    );

    if (!confirmed) {
      return;
    }

    setIsApplyingBulk(true);
    setBulkNotice(null);

    try {
      const result = await bulkUpdateMaterialPrices({
        percentage,
        category: category || undefined,
        onlyActive: true,
      });

      setBulkNotice(
        result.updated === 0
          ? "No se actualizó ningún precio."
          : `Se actualizaron ${result.updated} precios (${percentage > 0 ? "+" : ""}` +
            `${percentage}%).`,
      );
      setBulkPercentage("");
      setError(null);
      setReloadToken((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudieron actualizar los precios.",
      );
    } finally {
      setIsApplyingBulk(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Materiales</h1>
          <p className="text-sm text-muted">
            El catálogo con el que el agente calcula los presupuestos.{" "}
            {materials.length} a la vista.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDialogError(null);
            setDialog({ mode: "create" });
          }}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Agregar material
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Buscar materiales</span>
          <input
            value={search}
            placeholder="Buscar por nombre…"
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary"
          />
        </label>
        <label className="sm:w-56">
          <span className="sr-only">Filtrar por categoría</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          >
            <option value="">Todas las categorías</option>
            {categories.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Actualización rápida de precios</p>
          <p className="text-xs text-muted">
            Aplica el porcentaje a{" "}
            {category ? (
              <>
                la categoría <span className="font-medium">{category}</span>
              </>
            ) : (
              "todo el catálogo"
            )}
            . Usá un valor negativo para bajar los precios.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="relative">
            <span className="sr-only">Porcentaje a aplicar</span>
            <input
              type="number"
              step="0.1"
              min={-90}
              max={1000}
              value={bulkPercentage}
              placeholder="0"
              disabled={isApplyingBulk}
              onChange={(event) => setBulkPercentage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleBulkUpdate();
                }
              }}
              className="w-28 rounded-lg border border-border bg-background py-2 pl-3 pr-7 text-sm outline-none transition-colors focus:border-primary disabled:opacity-60"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
              %
            </span>
          </label>
          <button
            type="button"
            onClick={() => void handleBulkUpdate()}
            disabled={isApplyingBulk || bulkPercentage.trim() === ""}
            className="rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApplyingBulk ? "Aplicando…" : "Aplicar"}
          </button>
        </div>
      </div>

      {bulkNotice ? (
        <p className="rounded-lg bg-success-soft px-4 py-3 text-sm text-success">{bulkNotice}</p>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}

      {/* A seven-column table cannot be read on a phone, so the same rows
          are rendered as cards below `md`. */}
      <ul className="space-y-3 md:hidden">
        {isLoading && materials.length === 0 ? (
          <li className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted">
            Cargando materiales…
          </li>
        ) : materials.length === 0 ? (
          <li className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted">
            No hay materiales que coincidan con la búsqueda.
          </li>
        ) : (
          materials.map((material) => (
            <li
              key={material.id}
              className="rounded-xl border border-border bg-surface p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted">{material.code}</p>
                  <p className="mt-0.5 font-medium break-words">{material.name}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    material.is_active
                      ? "bg-success-soft text-success"
                      : "bg-surface-muted text-muted"
                  }`}
                >
                  {material.is_active ? "Activo" : "Inactivo"}
                </span>
              </div>

              <p className="mt-2 text-xs text-muted">
                {material.category} · por {material.unit}
              </p>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                <PriceCell
                  material={material}
                  onSave={(price) => handlePriceChange(material, price)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDialogError(null);
                      setDialog({ mode: "edit", material });
                    }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={pendingDeleteId === material.id}
                    onClick={() => confirmDelete(material)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:border-danger disabled:opacity-50"
                  >
                    {pendingDeleteId === material.id ? "Eliminando…" : "Eliminar"}
                  </button>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface shadow-sm md:block">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3 font-medium">Código</th>
              <th scope="col" className="px-4 py-3 font-medium">Nombre</th>
              <th scope="col" className="px-4 py-3 font-medium">Categoría</th>
              <th scope="col" className="px-4 py-3 font-medium">Unidad</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Precio unit.</th>
              <th scope="col" className="px-4 py-3 font-medium">Estado</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && materials.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  Cargando materiales…
                </td>
              </tr>
            ) : materials.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No hay materiales que coincidan con la búsqueda.
                </td>
              </tr>
            ) : (
              materials.map((material) => (
                <tr key={material.id} className="transition-colors hover:bg-surface-muted">
                  <td className="px-4 py-3 font-mono text-xs text-muted">{material.code}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{material.name}</p>
                    {material.description ? (
                      <p className="text-xs text-muted">{material.description}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">{material.category}</td>
                  <td className="px-4 py-3 text-muted">{material.unit}</td>
                  <td className="px-4 py-3 text-right">
                    <PriceCell
                      material={material}
                      onSave={(price) => handlePriceChange(material, price)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        material.is_active
                          ? "bg-success-soft text-success"
                          : "bg-surface-muted text-muted"
                      }`}
                    >
                      {material.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDialogError(null);
                          setDialog({ mode: "edit", material });
                        }}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={pendingDeleteId === material.id}
                        onClick={() => confirmDelete(material)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:border-danger disabled:opacity-50"
                      >
                        {pendingDeleteId === material.id ? "Eliminando…" : "Eliminar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {dialog.mode !== "closed" ? (
        <MaterialFormDialog
          key={dialog.mode === "edit" ? dialog.material.id : "create"}
          material={dialog.mode === "edit" ? dialog.material : null}
          isSaving={isSaving}
          error={dialogError}
          onSubmit={handleSubmit}
          onClose={() => setDialog({ mode: "closed" })}
        />
      ) : null}
    </section>
  );
}

/** Unit price cell that turns into an input when clicked. */
function PriceCell({
  material,
  onSave,
}: {
  material: Material;
  onSave: (price: number) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  // Seeded when editing starts, so a price changed elsewhere (the edit dialog)
  // is picked up without syncing props into state.
  const [value, setValue] = useState("");

  async function commit() {
    setIsEditing(false);
    const price = Number(value);

    if (!Number.isFinite(price) || price < 0 || price === material.unit_price) {
      setValue(String(material.unit_price));
      return;
    }

    await onSave(price);
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(material.unit_price));
          setIsEditing(true);
        }}
        title="Tocá para editar el precio"
        className="rounded-md px-2 py-1 font-medium tabular-nums transition-colors hover:bg-primary-soft hover:text-primary"
      >
        {formatCurrency(material.unit_price)}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      min={0}
      step="0.01"
      value={value}
      aria-label={`Precio unitario de ${material.name}`}
      // Select the current price so typing replaces it instead of appending.
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          void commit();
        }
        if (event.key === "Escape") {
          setValue(String(material.unit_price));
          setIsEditing(false);
        }
      }}
      className="w-24 rounded-md border border-primary bg-background px-2 py-1 text-right text-sm outline-none"
    />
  );
}
