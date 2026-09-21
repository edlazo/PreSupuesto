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
import { useRouter } from "next/navigation";
import {
  ApiError,
  addBudgetItem,
  createBudget,
  deleteBudgetItem,
  getBudget,
  getLatestBudget,
  updateBudget,
  updateBudgetItem,
} from "@/lib/api";
import type { Budget, BudgetItemCreate } from "@/lib/types";

interface BudgetWorkspaceValue {
  /** The budget everything on the workspace reads and writes. */
  budget: Budget | null;
  isLoading: boolean;
  /** True while a line is being added or removed. */
  isSaving: boolean;
  error: string | null;
  /** Append a line, starting a budget first when there is none yet. */
  addItem: (item: BudgetItemCreate) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  /** Correct how much of a line the job needs. */
  updateItemQuantity: (itemId: string, quantity: number) => Promise<void>;
  /** Correct what a line charges, at its base price. */
  updateItemPrice: (itemId: string, unitPrice: number) => Promise<void>;
  /** Move a line between charged and only listed. */
  setItemQuoted: (itemId: string, isQuoted: boolean) => Promise<void>;
  /** Address the budget to a client, replacing the stand-in one. */
  assignClient: (clientId: string) => Promise<void>;
  /** Record which site conditions apply, frozen with their percentages. */
  setSiteFactors: (codes: string[]) => Promise<void>;
  /** Put the newest stored budget on screen — what the agent just wrote. */
  reload: () => void;
  /** Leave the current budget and start an empty one. */
  startNewBudget: () => Promise<void>;
  clearError: () => void;
}

const BudgetWorkspaceContext = createContext<BudgetWorkspaceValue | null>(null);

/**
 * Single source of truth for the budget being worked on.
 *
 * The manual form and the assistant both end up writing the same rows, so the
 * workspace keeps one budget in state: the endpoints answer with the whole
 * budget after every change, and a finished chat turn reloads the newest one.
 */
export default function BudgetWorkspaceProvider({
  children,
  initialBudgetId = null,
}: {
  children: ReactNode;
  /** Budget to open instead of the newest one — the history view links here. */
  initialBudgetId?: string | null;
}) {
  const router = useRouter();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // `isActive` drops the answer of a request a newer one has replaced.
    let isActive = true;

    const loading = initialBudgetId ? getBudget(initialBudgetId) : getLatestBudget();

    loading
      .then((latest) => {
        if (!isActive) return;
        setBudget(latest);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!isActive) return;
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo cargar el presupuesto.",
        );
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [reloadToken, initialBudgetId]);

  const reload = useCallback(() => {
    setIsLoading(true);
    setReloadToken((current) => current + 1);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const addItem = useCallback(
    async (item: BudgetItemCreate) => {
      setIsSaving(true);

      try {
        // The first line of the day has no budget to land on yet.
        const target = budget ?? (await createBudget());
        setBudget(await addBudgetItem(target.id, item));
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo agregar el ítem.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [budget],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      if (!budget) return;

      setIsSaving(true);

      try {
        setBudget(await deleteBudgetItem(budget.id, itemId));
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo borrar el ítem.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [budget],
  );

  const updateItemQuantity = useCallback(
    async (itemId: string, quantity: number) => {
      if (!budget) return;

      setIsSaving(true);

      try {
        setBudget(await updateBudgetItem(budget.id, itemId, { quantity }));
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo cambiar la cantidad.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [budget],
  );

  const updateItemPrice = useCallback(
    async (itemId: string, unitPrice: number) => {
      if (!budget) return;

      setIsSaving(true);

      try {
        setBudget(await updateBudgetItem(budget.id, itemId, { unit_price: unitPrice }));
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo cambiar el precio.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [budget],
  );

  const setItemQuoted = useCallback(
    async (itemId: string, isQuoted: boolean) => {
      if (!budget) return;

      setIsSaving(true);

      try {
        setBudget(await updateBudgetItem(budget.id, itemId, { is_quoted: isQuoted }));
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo cambiar la línea.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [budget],
  );

  const assignClient = useCallback(
    async (clientId: string) => {
      if (!budget) return;

      setIsSaving(true);

      try {
        setBudget(await updateBudget(budget.id, { client_id: clientId }));
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : "No se pudo asignar el cliente.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [budget],
  );

  const setSiteFactors = useCallback(
    async (codes: string[]) => {
      if (!budget) return;

      setIsSaving(true);

      try {
        setBudget(await updateBudget(budget.id, { site_factors: codes }));
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : "No se pudieron guardar las condiciones.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [budget],
  );

  const startNewBudget = useCallback(async () => {
    setIsSaving(true);

    try {
      setBudget(await createBudget());
      setError(null);
      // Drop `?budget=`, so a reload does not reopen the one just left behind.
      router.replace("/");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo crear el presupuesto.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [router]);

  const value = useMemo(
    () => ({
      budget,
      isLoading,
      isSaving,
      error,
      addItem,
      removeItem,
      updateItemQuantity,
      updateItemPrice,
      setItemQuoted,
      assignClient,
      setSiteFactors,
      reload,
      startNewBudget,
      clearError,
    }),
    [
      budget,
      isLoading,
      isSaving,
      error,
      addItem,
      removeItem,
      updateItemQuantity,
      updateItemPrice,
      setItemQuoted,
      assignClient,
      setSiteFactors,
      reload,
      startNewBudget,
      clearError,
    ],
  );

  return (
    <BudgetWorkspaceContext.Provider value={value}>{children}</BudgetWorkspaceContext.Provider>
  );
}

/** Read the workspace budget. Only valid inside the provider. */
export function useBudgetWorkspace(): BudgetWorkspaceValue {
  const value = useContext(BudgetWorkspaceContext);

  if (value === null) {
    throw new Error("useBudgetWorkspace must be used inside BudgetWorkspaceProvider");
  }

  return value;
}
