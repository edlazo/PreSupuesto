/** Client for the PreSupuesto FastAPI backend. */

import type {
  Budget,
  ChatResponse,
  HealthResponse,
  Material,
  MaterialCreate,
  MaterialUpdate,
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

  return `Request failed with status ${response.status}`;
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
      `Cannot reach the API at ${API_BASE_URL}. Is the backend running?`,
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

// --- Budgets ----------------------------------------------------------------
export function listBudgets(limit = 20): Promise<Budget[]> {
  return request<Budget[]>(`/api/budgets?limit=${limit}`);
}

export function getBudget(id: string): Promise<Budget> {
  return request<Budget>(`/api/budgets/${id}`);
}

/** Fetch the most recent budget with its lines, or null when there is none. */
export async function getLatestBudget(): Promise<Budget | null> {
  const budgets = await listBudgets(1);

  if (budgets.length === 0) {
    return null;
  }

  return getBudget(budgets[0].id);
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
