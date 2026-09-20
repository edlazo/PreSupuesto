"use client";

import { useEffect, useState } from "react";
import { ApiError, createClient, listClients } from "@/lib/api";
import type { Client, ClientCreate } from "@/lib/types";

/** The stand-in the backend attaches to a budget with no client of its own. */
const DEFAULT_CLIENT_NAME = "Consumidor final";

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary";

/** Fold accents and case, so "perez" finds "Pérez". */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

interface ClientFieldProps {
  /** Client the budget is addressed to right now. */
  clientId: string | undefined;
  isSaving: boolean;
  onSelect: (clientId: string) => void;
}

/**
 * Who the budget is for.
 *
 * A budget starts before anyone has asked the customer their name, so it hangs
 * off a stand-in client until one is chosen here — and the PDF prints whoever
 * is chosen.
 */
export default function ClientField({ clientId, isSaving, onSelect }: ClientFieldProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    let isActive = true;

    listClients()
      .then((rows) => {
        if (isActive) setClients(rows);
      })
      .catch(() => {
        // The name is a nicety: a failure here must not break the budget.
        if (isActive) setClients([]);
      });

    return () => {
      isActive = false;
    };
  }, []);

  const current = clients.find((client) => client.id === clientId) ?? null;
  const isPlaceholder = current === null || current.full_name === DEFAULT_CLIENT_NAME;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted">Cliente:</span>
        <span className={isPlaceholder ? "text-muted italic" : "font-medium"}>
          {current ? current.full_name : "Sin asignar"}
        </span>
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          disabled={isSaving}
          className="no-print rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary-soft disabled:opacity-50"
        >
          {isPlaceholder ? "Elegir" : "Cambiar"}
        </button>
      </div>

      {isDialogOpen ? (
        <ClientDialog
          clients={clients}
          onCreated={(created) => setClients((rows) => [...rows, created])}
          onSelect={(id) => {
            setIsDialogOpen(false);
            onSelect(id);
          }}
          onClose={() => setIsDialogOpen(false)}
        />
      ) : null}
    </>
  );
}

function ClientDialog({
  clients,
  onCreated,
  onSelect,
  onClose,
}: {
  clients: Client[];
  onCreated: (client: Client) => void;
  onSelect: (clientId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ClientCreate>({
    full_name: "",
    phone: "",
    email: "",
    address: "",
    tax_id: "",
  });

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

  const needle = normalize(search.trim());
  const results = needle
    ? clients.filter(
        (client) =>
          normalize(client.full_name).includes(needle) ||
          normalize(client.company_name ?? "").includes(needle),
      )
    : clients;

  async function handleCreate() {
    if (form.full_name.trim() === "") {
      setError("Poné al menos el nombre.");
      return;
    }

    setIsSaving(true);

    try {
      // Empty boxes are left out, so the client is stored without blank fields.
      const payload: ClientCreate = { full_name: form.full_name.trim() };

      for (const field of ["phone", "email", "address", "tax_id"] as const) {
        const value = form[field]?.trim();
        if (value) payload[field] = value;
      }

      const created = await createClient(payload);
      onCreated(created);
      onSelect(created.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo crear el cliente.");
    } finally {
      setIsSaving(false);
    }
  }

  function update<K extends keyof ClientCreate>(field: K, value: ClientCreate[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-dialog-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        // Only a click on the backdrop itself closes the dialog.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="client-dialog-title" className="text-sm font-semibold">
            {isCreating ? "Cliente nuevo" : "¿Para quién es el presupuesto?"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {isCreating ? (
          <form
            className="flex flex-col gap-3 overflow-y-auto p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <label className="text-xs font-medium text-muted">
              Nombre y apellido
              <input
                autoFocus
                value={form.full_name}
                onChange={(event) => update("full_name", event.target.value)}
                placeholder="Ana Torres"
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted">
                Teléfono
                <input
                  value={form.phone ?? ""}
                  onChange={(event) => update("phone", event.target.value)}
                  placeholder="11 5555-1234"
                  className={`mt-1 ${FIELD_CLASS}`}
                />
              </label>

              <label className="text-xs font-medium text-muted">
                CUIT / DNI
                <input
                  value={form.tax_id ?? ""}
                  onChange={(event) => update("tax_id", event.target.value)}
                  placeholder="27-30111222-4"
                  className={`mt-1 ${FIELD_CLASS}`}
                />
              </label>
            </div>

            <label className="text-xs font-medium text-muted">
              Mail
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(event) => update("email", event.target.value)}
                placeholder="ana@ejemplo.com"
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </label>

            <label className="text-xs font-medium text-muted">
              Dirección de la obra
              <input
                value={form.address ?? ""}
                onChange={(event) => update("address", event.target.value)}
                placeholder="Av. Rivadavia 4500"
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </label>

            {error ? <p className="text-xs text-danger">{error}</p> : null}

            <div className="mt-1 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setError(null);
                }}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
              >
                Volver
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {isSaving ? "Guardando…" : "Crear y asignar"}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex min-h-0 flex-col">
            <div className="p-4 pb-2">
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscá por nombre"
                aria-label="Buscar cliente"
                className={FIELD_CLASS}
              />
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto px-2">
              {results.length === 0 ? (
                <li className="px-2 py-6 text-center text-sm text-muted">
                  No hay clientes con ese nombre.
                </li>
              ) : (
                results.map((client) => (
                  <li key={client.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(client.id)}
                      className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-muted"
                    >
                      <span className="text-sm font-medium">{client.full_name}</span>
                      {client.phone || client.email ? (
                        <span className="text-xs text-muted">
                          {[client.phone, client.email].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>

            <div className="border-t border-border p-4">
              <button
                type="button"
                onClick={() => {
                  setIsCreating(true);
                  // What was typed is almost always the name being looked for.
                  if (search.trim()) update("full_name", search.trim());
                }}
                className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-primary"
              >
                + Cargar un cliente nuevo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
