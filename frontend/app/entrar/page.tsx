"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, login } from "@/lib/api";
import { getSessionToken, setSessionToken, takeExpiredNotice } from "@/lib/session";

/** "arriving" covers the first moment, before the link has been read. */
type Status = "arriving" | "idle" | "checking" | "error";

/** The key out of a pasted link (`…/entrar#k=KEY`), or the text itself. */
function keyFrom(text: string): string {
  const match = /[#&?]k=([^&\s]+)/.exec(text);
  return (match ? decodeURIComponent(match[1]) : text).trim();
}

/**
 * Trade the key for a session and keep it. Resolves to what went wrong, or
 * null once the browser is signed in.
 */
async function exchange(key: string): Promise<string | null> {
  try {
    const session = await login(key);
    setSessionToken(session.token);
    return null;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) {
      return "Ese link no es válido o ya no está vigente. Pedí uno nuevo.";
    }
    return caught instanceof Error ? caught.message : "No se pudo entrar.";
  }
}

/**
 * Entry through the private link.
 *
 * The key travels after the `#`, which browsers never send to a server, and
 * is wiped from the address bar as soon as it is read. What stays on the
 * device is a session that expires on its own.
 */
export default function EntryPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("arriving");
  const [message, setMessage] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  /** Into the app on success; otherwise say why, and offer the paste box. */
  function settle(failure: string | null) {
    if (failure === null) {
      router.replace("/");
      return;
    }
    setStatus("error");
    setMessage(failure);
  }

  useEffect(() => {
    const key = keyFrom(window.location.hash);

    // Out of the address bar and the history before anything else happens.
    window.history.replaceState(null, "", "/entrar");

    if (key) {
      void exchange(key).then(settle);
      return;
    }

    if (getSessionToken()) {
      router.replace("/");
      return;
    }

    const expired = takeExpiredNotice();
    // Deferred a tick: the page first renders as it arrived, then settles.
    queueMicrotask(() => {
      setStatus("idle");
      if (expired) {
        setMessage("Tu acceso venció o cambió. Abrí de nuevo el link que te pasaron.");
      }
    });

    // The link opened over this same page changes only the `#`, which does
    // not reload it — so that is watched too.
    function onHashChange() {
      const next = keyFrom(window.location.hash);
      if (!next) return;

      window.history.replaceState(null, "", "/entrar");
      setStatus("checking");
      setMessage(null);
      void exchange(next).then(settle);
    }

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // Runs once, on arrival; `settle` and `router` do not change during it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = keyFrom(pasted);
    if (!key) return;

    setStatus("checking");
    setMessage(null);
    void exchange(key).then(settle);
  }

  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground"
        >
          P
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">PreSupuesto</h1>
          <p className="text-sm text-muted">Presupuestos de obra</p>
        </div>
      </div>

      {status === "arriving" || status === "checking" ? (
        <p className="mt-6 text-sm text-muted">Entrando…</p>
      ) : (
        <>
          <p className="mt-6 text-sm">
            Para entrar, abrí el <strong>link de acceso</strong> que te pasaron. Queda
            guardado en este celular o compu por unos meses.
          </p>

          {message ? (
            <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
              {message}
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-2">
            <label htmlFor="access-link" className="text-xs font-medium text-muted">
              ¿El link no se abre? Pegalo acá
            </label>
            <input
              id="access-link"
              type="password"
              autoComplete="off"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder="https://…/entrar#k=…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
            <button
              type="submit"
              disabled={!pasted.trim()}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Entrar
            </button>
          </form>
        </>
      )}
    </div>
  );
}
