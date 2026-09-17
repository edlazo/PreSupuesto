"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, getBlueRate } from "@/lib/api";
import type { BlueRate } from "@/lib/types";

interface BlueRateContextValue {
  rate: BlueRate | null;
  isLoading: boolean;
  error: string | null;
  /** Re-read the rate, skipping the backend's short-lived cache. */
  refresh: () => void;
}

const BlueRateContext = createContext<BlueRateContextValue>({
  rate: null,
  isLoading: false,
  error: null,
  refresh: () => {},
});

/**
 * Holds the blue dollar rate for the whole application.
 *
 * The header widget and the budget preview both need it, and they must agree:
 * a budget converted at one rate while the header shows another would be a bug
 * the user could see.
 */
export default function BlueRateProvider({ children }: { children: ReactNode }) {
  const [rate, setRate] = useState<BlueRate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // `isActive` drops the answer of a request a newer one has replaced.
    let isActive = true;

    // The first read may use the cache; a manual refresh never does.
    getBlueRate(reloadToken > 0)
      .then((value) => {
        if (!isActive) return;
        setRate(value);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!isActive) return;
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo obtener la cotización.",
        );
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setReloadToken((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({ rate, isLoading, error, refresh }),
    [rate, isLoading, error, refresh],
  );

  return <BlueRateContext.Provider value={value}>{children}</BlueRateContext.Provider>;
}

/** Read the shared blue dollar rate. */
export function useBlueRate(): BlueRateContextValue {
  return useContext(BlueRateContext);
}
