"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBlueRate } from "@/components/BlueRateProvider";
import { formatCurrency } from "@/lib/format";

const NAV_LINKS = [
  { href: "/", label: "Escritorio" },
  { href: "/materials", label: "Materiales" },
] as const;

/** Application header with branding and the main navigation links. */
export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="no-print sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground"
          >
            P
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-base font-semibold tracking-tight">PreSupuesto</span>
            <span className="hidden text-xs text-muted sm:block">
              Presupuestos de obra, armados por un agente
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-4">
          <BlueDollarWidget />

          <nav className="flex items-center gap-1" aria-label="Principal">
          {NAV_LINKS.map((link) => {
            const isActive =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary-soft text-primary"
                    : "text-muted hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          </nav>
        </div>
      </div>
    </header>
  );
}

/** Blue dollar buy and sell prices, with a manual refresh. */
function BlueDollarWidget() {
  const { rate, isLoading, error, refresh } = useBlueRate();

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-2.5 py-1.5"
      title={
        error
          ? error
          : rate
            ? `Dólar blue según ${rate.source}`
            : "Cotización del dólar blue"
      }
    >
      <span className="hidden text-[0.65rem] font-semibold uppercase tracking-wide text-muted sm:block">
        Blue
      </span>

      {error ? (
        <span className="text-xs font-medium text-danger">Sin cotización</span>
      ) : rate ? (
        <span className="flex items-baseline gap-2 text-xs">
          <span className="text-muted">
            Compra{" "}
            <span className="font-semibold text-foreground">
              {formatCurrency(rate.buy, "ARS")}
            </span>
          </span>
          <span className="text-muted">
            Venta{" "}
            <span className="font-semibold text-foreground">
              {formatCurrency(rate.sell, "ARS")}
            </span>
          </span>
        </span>
      ) : (
        <span className="text-xs text-muted">Cargando…</span>
      )}

      <button
        type="button"
        onClick={refresh}
        disabled={isLoading}
        aria-label="Actualizar la cotización del dólar blue"
        title="Actualizar cotización"
        className="rounded-md p-1 text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>
  );
}
