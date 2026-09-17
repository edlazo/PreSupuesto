"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    </header>
  );
}
