/** Client for the PreSupuesto FastAPI backend. */

import type {
  BlueRate,
  Budget,
  BudgetCreate,
  BudgetItemCreate,
  BulkPriceUpdateResult,
  ChatResponse,
  HealthResponse,
  Material,
  MaterialCreate,
  MaterialUpdate,
  StandardTask,
} from "./types";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

/** An error carrying the HTTP status, so callers can react to 404 or 409. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Read the `detail` field FastAPI puts in its error bodies. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;

    if (typeof detail === "string") {
      return detail;
    }
    // Validation errors arrive as a list of objects.
    if (Array.isArray(detail) && detail.length > 0) {
      return detail.map((item) => item?.msg ?? String(item)).join(", ");
    }
  } catch {
    // Body was empty or not JSON; fall through to the generic message.
  }

  return `La solicitud falló con estado ${response.status}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      `No se puede conectar con la API en ${API_BASE_URL}. ¿Está levantado el backend?`,
      0,
    );
  }

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// --- Materials --------------------------------------------------------------
export interface MaterialQuery {
  search?: string;
  category?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export function listMaterials(query: MaterialQuery = {}): Promise<Material[]> {
  const params = new URLSearchParams();

  if (query.search) params.set("search", query.search);
  if (query.category) params.set("category", query.category);
  if (query.isActive !== undefined) params.set("is_active", String(query.isActive));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));

  const queryString = params.toString();
  return request<Material[]>(`/api/materials${queryString ? `?${queryString}` : ""}`);
}

export function createMaterial(payload: MaterialCreate): Promise<Material> {
  return request<Material>("/api/materials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMaterial(id: string, payload: MaterialUpdate): Promise<Material> {
  return request<Material>(`/api/materials/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteMaterial(id: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/materials/${id}`, {
    method: "DELETE",
  });
}

export interface BulkPriceUpdate {
  /** Percentage to apply: 12.5 raises prices by 12.5%, -5 lowers them. */
  percentage: number;
  /** Restrict the change to one category. */
  category?: string;
  /** Skip materials flagged as inactive. */
  onlyActive?: boolean;
}

/** Raise or lower the unit price of several materials at once. */
export function bulkUpdateMaterialPrices(
  update: BulkPriceUpdate,
): Promise<BulkPriceUpdateResult> {
  return request<BulkPriceUpdateResult>("/api/materials/bulk-update-price", {
    method: "POST",
    body: JSON.stringify({
      percentage: update.percentage,
      category: update.category ?? null,
      only_active: update.onlyActive ?? true,
    }),
  });
}

// --- Standard tasks ---------------------------------------------------------
export function listStandardTasks(search?: string): Promise<StandardTask[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<StandardTask[]>(`/api/standard-tasks${query}`);
}

// --- Budgets ----------------------------------------------------------------
/** Start an empty budget. Without a client, the backend uses its stand-in one. */
export function createBudget(payload: BudgetCreate = {}): Promise<Budget> {
  return request<Budget>("/api/budgets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Append a line. The answer is the whole budget, with its new totals. */
export function addBudgetItem(budgetId: string, payload: BudgetItemCreate): Promise<Budget> {
  return request<Budget>(`/api/budgets/${budgetId}/items`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Remove a line. The answer is the whole budget, with its new totals. */
export function deleteBudgetItem(budgetId: string, itemId: string): Promise<Budget> {
  return request<Budget>(`/api/budgets/${budgetId}/items/${itemId}`, {
    method: "DELETE",
  });
}
export function listBudgets(limit = 20): Promise<Budget[]> {
  return request<Budget[]>(`/api/budgets?limit=${limit}`);
}

export function getBudget(id: string): Promise<Budget> {
  return request<Budget>(`/api/budgets/${id}`);
}

/** Read the download name the backend suggests in Content-Disposition. */
function filenameFromResponse(response: Response, fallback: string): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);

  return match ? decodeURIComponent(match[1]) : fallback;
}

/**
 * Download a budget as a PDF.
 *
 * The file is fetched rather than opened in a tab so a failure surfaces as an
 * ApiError the caller can show, instead of an error page in a new window.
 */
export interface PdfOptions {
  /** Currency to print, e.g. "USD". Defaults to the budget's own. */
  currency?: string;
  /** Exchange rate to apply, so the file matches what the screen showed. */
  rate?: number;
}

export async function downloadBudgetPdf(
  budgetId: string,
  fallbackName = "presupuesto.pdf",
  options: PdfOptions = {},
): Promise<void> {
  const params = new URLSearchParams();

  if (options.currency) params.set("currency", options.currency);
  if (options.rate !== undefined) params.set("rate", String(options.rate));

  const query = params.toString();
  let response: Response;

  try {
    response = await fetch(
      `${API_BASE_URL}/api/budgets/${budgetId}/pdf${query ? `?${query}` : ""}`,
      { cache: "no-store" },
    );
  } catch {
    throw new ApiError(
      `No se puede conectar con la API en ${API_BASE_URL}. ¿Está levantado el backend?`,
      0,
    );
  }

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = filenameFromResponse(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/** Fetch the most recent budget with its lines, or null when there is none. */
export async function getLatestBudget(): Promise<Budget | null> {
  const budgets = await listBudgets(1);

  if (budgets.length === 0) {
    return null;
  }

  return getBudget(budgets[0].id);
}

// --- Currency ---------------------------------------------------------------
/** Read the current blue dollar rate. Pass true to skip the backend cache. */
export function getBlueRate(refresh = false): Promise<BlueRate> {
  return request<BlueRate>(`/api/currency/blue${refresh ? "?refresh=true" : ""}`);
}

// --- Agent ------------------------------------------------------------------
export function sendChatMessage(
  message: string,
  sessionId: string | null,
): Promise<ChatResponse> {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, session_id: sessionId }),
  });
}

// --- System -----------------------------------------------------------------
export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}
