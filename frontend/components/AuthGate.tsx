"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import BlueRateProvider from "@/components/BlueRateProvider";
import Navbar from "@/components/Navbar";
import { getSessionToken, subscribeToSession } from "@/lib/session";

const ENTRY_PATH = "/entrar";
const MAIN_CLASS = "mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6";

/** Unknown while rendering on the server, where there is no storage to read. */
function getServerToken(): undefined {
  return undefined;
}

/**
 * Shows the app only to a browser that came in through the private link.
 *
 * Anything else lands on the entry page. The app itself — navbar, dollar
 * rate, pages — is not even mounted until then, so nothing calls the API
 * without a session.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useSyncExternalStore(subscribeToSession, getSessionToken, getServerToken);
  const isEntry = pathname === ENTRY_PATH;

  useEffect(() => {
    if (token === null && !isEntry) {
      router.replace(ENTRY_PATH);
    }
  }, [token, isEntry, router]);

  if (isEntry) {
    return <main className={MAIN_CLASS}>{children}</main>;
  }

  if (!token) {
    return (
      <main className={MAIN_CLASS}>
        <p className="py-10 text-center text-sm text-muted">Cargando…</p>
      </main>
    );
  }

  return (
    <BlueRateProvider>
      <Navbar />
      <main className={MAIN_CLASS}>{children}</main>
    </BlueRateProvider>
  );
}
