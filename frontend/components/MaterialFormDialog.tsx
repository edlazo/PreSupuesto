"use client";

import { useEffect, useState } from "react";
import type { Material, MaterialCreate } from "@/lib/types";

interface MaterialFormDialogProps {
  /** The material being edited, or null when creating a new one. */
  material: Material | null;
  isSaving: boolean;
  /** Message from the server, e.g. a duplicate code. */
  error: string | null;
  onSubmit: (values: MaterialCreate) => void;
  onClose: () => void;
}

const EMPTY_FORM: MaterialCreate = {
  code: "",
  name: "",
  description: "",
  category: "",
  unit: "",
  unit_price: 0,
  is_active: true,
};

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary";

/** Modal form used to create a material and to edit an existing one. */
export default function MaterialFormDialog({
  material,
  isSaving,
  error,
  onSubmit,
  onClose,
}: MaterialFormDialogProps) {
  // The caller remounts this dialog with a `key` per material, so reading the
  // record once at mount is enough — no effect has to sync props into state.
  const [values, setValues] = useState<MaterialCreate>(() =>
    material
      ? {
          code: material.code,
          name: material.name,
          description: material.description ?? "",
          category: material.category,
          unit: material.unit,
          unit_price: material.unit_price,
          is_active: material.is_active,
        }
      : EMPTY_FORM,
  );

  // Escape closes the dialog.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function update<K extends keyof MaterialCreate>(field: K, value: MaterialCreate[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="material-dialog-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        // Only a click on the backdrop itself closes the dialog.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <h2 id="material-dialog-title" className="text-base font-semibold">
          {material ? "Editar material" : "Material nuevo"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {material
            ? "Actualizá la ficha del catálogo. El agente usa estos valores en los presupuestos nuevos."
            : "Agregá una ficha al catálogo con el que el agente calcula los presupuestos."}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Código</span>
            <input
              required
              value={values.code}
              placeholder="MAT-CEM-001"
              onChange={(event) => update("code", event.target.value)}
              className={FIELD_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Categoría</span>
            <input
              required
              value={values.category}
              placeholder="aglomerantes"
              onChange={(event) => update("category", event.target.value)}
              className={FIELD_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Nombre</span>
            <input
              required
              value={values.name}
              placeholder="Cemento Portland CP40"
              onChange={(event) => update("name", event.target.value)}
              className={FIELD_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium">
              Descripción <span className="font-normal text-muted">(opcional)</span>
            </span>
            <textarea
              rows={2}
              value={values.description ?? ""}
              placeholder="Bolsa de 25 kg de cemento Portland de uso general"
              onChange={(event) => update("description", event.target.value)}
              className={`${FIELD_CLASS} resize-none`}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Unidad</span>
            <input
              required
              value={values.unit}
              placeholder="bolsa"
              onChange={(event) => update("unit", event.target.value)}
              className={FIELD_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Precio unitario</span>
            <input
              required
              type="number"
              min={0}
              step="0.01"
              value={values.unit_price}
              onChange={(event) => update("unit_price", Number(event.target.value))}
              className={FIELD_CLASS}
            />
          </label>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={values.is_active}
              onChange={(event) => update("is_active", event.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            <span>
              Activo
              <span className="ml-1 text-muted">
                — los materiales inactivos siguen en los presupuestos viejos, pero no se
                ofrecen para los nuevos
              </span>
            </span>
          </label>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Guardando…" : material ? "Guardar cambios" : "Crear material"}
          </button>
        </div>
      </form>
    </div>
  );
}
