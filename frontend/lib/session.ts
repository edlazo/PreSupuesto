/**
 * The session this browser got from the private access link.
 *
 * Kept in localStorage so it survives closing the tab, and read through a
 * tiny store so React re-renders when it appears or goes away. Storage can be
 * unavailable (private windows, blocked site data), which reads as signed out.
 */

const STORAGE_KEY = "presupuesto.session";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Nothing to keep it in; this visit still works until the page reloads.
  }
  notify();
}

export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Already unreadable, so already signed out.
  }
  notify();
}

const EXPIRED_KEY = "presupuesto.session-expired";

/**
 * Drop a session the API no longer accepts — expired, or the link was
 * replaced — and leave a note so the entry page can say why.
 */
export function expireSession(): void {
  try {
    window.sessionStorage.setItem(EXPIRED_KEY, "1");
  } catch {
    // The entry page just won't explain itself.
  }
  clearSessionToken();
}

/** True once after `expireSession`, so the notice shows a single time. */
export function takeExpiredNotice(): boolean {
  try {
    const expired = window.sessionStorage.getItem(EXPIRED_KEY) !== null;
    window.sessionStorage.removeItem(EXPIRED_KEY);
    return expired;
  } catch {
    return false;
  }
}

/** For useSyncExternalStore: also follows other tabs signing in or out. */
export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
