/** Client for the PreSupuesto FastAPI backend. */

import type {
  BlueRate,
  Budget,
  BudgetCreate,
  BudgetItemCreate,
  BudgetItemUpdate,
  BudgetUpdate,
  ChatResponse,
  Client,
  ClientCreate,
  HealthResponse,
  Material,
  PricingFactor,
  PricingFactorUpdate,
  StandardTask,
} from "./types";
import { expireSession, getSessionToken } from "./session";

/**
 * Where the API lives. Deployed, the API is served from the same domain as
 * the app (Vercel Services routes /api/* to it), so the base is empty and
 * requests stay relative. Locally it runs apart, on port 8000, unless
 * NEXT_PUBLIC_API_URL says otherwise.
 */
const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:8000")
).replace(/\/$/, "");

/** How to name the API in an error, when it cannot be reached. */
const UNREACHABLE =
  API_BASE_URL === ""
    ? "No se puede conectar con el servidor. Revisá tu conexión y probá de nuevo."
    : `No se puede conectar con la API en ${API_BASE_URL}. ¿Está levantado el backend?`;

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

/** The session header, when this browser has one. */
function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * A 401 on a signed-in request means the session is gone — expired, or the
 * link was replaced — so it is dropped; AuthGate then shows the entry page.
 */
function handleSignedOut(response: Response): void {
  if (response.status === 401 && typeof window !== "undefined" && getSessionToken()) {
    expireSession();
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      UNREACHABLE,
      0,
    );
  }

  if (!response.ok) {
    handleSignedOut(response);
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// --- Access -----------------------------------------------------------------
export interface Session {
  token: string;
  /** Unix timestamp, in seconds. */
  expires_at: number;
}

/** Trade the key from the private link for a session. */
export function login(key: string): Promise<Session> {
  return request<Session>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
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

// --- Standard tasks ---------------------------------------------------------
export function listStandardTasks(search?: string): Promise<StandardTask[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<StandardTask[]>(`/api/standard-tasks${query}`);
}

// --- Pricing factors --------------------------------------------------------
/** The conditions that move a price: a flat, nowhere to park, imposed hours. */
export function listPricingFactors(onlyActive = false): Promise<PricingFactor[]> {
  return request<PricingFactor[]>(
    `/api/pricing-factors${onlyActive ? "?only_active=true" : ""}`,
  );
}

export function updatePricingFactor(
  id: string,
  payload: PricingFactorUpdate,
): Promise<PricingFactor> {
  return request<PricingFactor>(`/api/pricing-factors/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// --- Clients ----------------------------------------------------------------
export function listClients(search?: string): Promise<Client[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<Client[]>(`/api/clients${query}`);
}

export function createClient(payload: ClientCreate): Promise<Client> {
  return request<Client>("/api/clients", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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

/** Change a line. The answer is the whole budget, with its new totals. */
export function updateBudgetItem(
  budgetId: string,
  itemId: string,
  payload: BudgetItemUpdate,
): Promise<Budget> {
  return request<Budget>(`/api/budgets/${budgetId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** Remove a line. The answer is the whole budget, with its new totals. */
export function deleteBudgetItem(budgetId: string, itemId: string): Promise<Budget> {
  return request<Budget>(`/api/budgets/${budgetId}/items/${itemId}`, {
    method: "DELETE",
  });
}

/** Change a budget header — its client, its title, its status. */
export function updateBudget(budgetId: string, payload: BudgetUpdate): Promise<Budget> {
  return request<Budget>(`/api/budgets/${budgetId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * Shift every charged line of a budget by a percentage, for a quote whose
 * prices have fallen behind. Listed materials are left alone.
 */
export function adjustBudgetPrices(budgetId: string, percentage: number): Promise<Budget> {
  return request<Budget>(`/api/budgets/${budgetId}/adjust-prices`, {
    method: "POST",
    body: JSON.stringify({ percentage }),
  });
}

/** Delete a budget and all of its lines. There is no undo. */
export function deleteBudget(budgetId: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/budgets/${budgetId}`, {
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

export interface PdfOptions {
  /** Currency to print, e.g. "USD". Defaults to the budget's own. */
  currency?: string;
  /** Exchange rate to apply, so the file matches what the screen showed. */
  rate?: number;
}

/**
 * Fetch a budget's PDF as a file, named the way the backend suggests.
 *
 * It is fetched rather than opened in a tab so a failure surfaces as an
 * ApiError the caller can show, instead of an error page in a new window.
 */
export async function fetchBudgetPdf(
  budgetId: string,
  fallbackName = "presupuesto.pdf",
  options: PdfOptions = {},
): Promise<File> {
  const params = new URLSearchParams();

  if (options.currency) params.set("currency", options.currency);
  if (options.rate !== undefined) params.set("rate", String(options.rate));

  const query = params.toString();
  let response: Response;

  try {
    response = await fetch(
      `${API_BASE_URL}/api/budgets/${budgetId}/pdf${query ? `?${query}` : ""}`,
      { cache: "no-store", headers: authHeaders() },
    );
  } catch {
    throw new ApiError(UNREACHABLE, 0);
  }

  if (!response.ok) {
    handleSignedOut(response);
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  const blob = await response.blob();
  return new File([blob], filenameFromResponse(response, fallbackName), {
    type: "application/pdf",
  });
}

/** Download a budget as a PDF. */
export async function downloadBudgetPdf(
  budgetId: string,
  fallbackName = "presupuesto.pdf",
  options: PdfOptions = {},
): Promise<void> {
  const file = await fetchBudgetPdf(budgetId, fallbackName, options);
  const objectUrl = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = file.name;
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
