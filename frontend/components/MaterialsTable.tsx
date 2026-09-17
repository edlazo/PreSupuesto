"use client";

import { useEffect, useMemo, useState } from "react";
import MaterialFormDialog from "@/components/MaterialFormDialog";
import {
  ApiError,
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
          caught instanceof ApiError ? caught.message : "Could not load the materials.",
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
        caught instanceof ApiError ? caught.message : "Could not save the material.",
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
        caught instanceof ApiError ? caught.message : "Could not delete the material.",
      );
    } finally {
      setPendingDeleteId(null);
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
        caught instanceof ApiError ? caught.message : "Could not update the price.",
      );
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Materials</h1>
          <p className="text-sm text-muted">
            The catalog the agent prices budgets with. {materials.length} shown.
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
          Add material
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Search materials</span>
          <input
            value={search}
            placeholder="Search by name…"
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary"
          />
        </label>
        <label className="sm:w-56">
          <span className="sr-only">Filter by category</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          >
            <option value="">All categories</option>
            {categories.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3 font-medium">Code</th>
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Category</th>
              <th scope="col" className="px-4 py-3 font-medium">Unit</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Unit price</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && materials.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  Loading materials…
                </td>
              </tr>
            ) : materials.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No materials match this search.
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
                      {material.is_active ? "Active" : "Inactive"}
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
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={pendingDeleteId === material.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete "${material.name}"? Materials already used by a budget cannot be deleted — deactivate them instead.`,
                            )
                          ) {
                            void handleDelete(material);
                          }
                        }}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:border-danger disabled:opacity-50"
                      >
                        {pendingDeleteId === material.id ? "Deleting…" : "Delete"}
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
        title="Click to edit the price"
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
      aria-label={`Unit price for ${material.name}`}
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
