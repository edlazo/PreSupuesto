/** Types mirroring the Pydantic models exposed by the FastAPI backend. */

export type BudgetStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export type BudgetItemType = "material" | "task" | "custom";

export interface Material {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  unit: string;
  unit_price: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Payload accepted by POST /api/materials. */
export interface MaterialCreate {
  /** Left empty, the backend generates one from the category (MAT-ALB-004). */
  code: string;
  name: string;
  description?: string | null;
  category: string;
  unit: string;
  unit_price: number;
  is_active: boolean;
}

/** Payload accepted by PATCH /api/materials/{id}. Every field is optional. */
export type MaterialUpdate = Partial<MaterialCreate>;

/** What POST /api/materials/bulk-update-price reports back. */
export interface BulkPriceUpdateResult {
  updated: number;
  percentage: number;
  materials: Material[];
}

/** A labor task from GET /api/standard-tasks. */
export interface StandardTask {
  id: string;
  code: string;
  name: string;
  description: string | null;
  trade: string;
  unit: string;
  labor_unit_price: number;
  estimated_hours_per_unit: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A client a budget can be addressed to. */
export interface Client {
  id: string;
  full_name: string;
  company_name: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload accepted by POST /api/clients. */
export interface ClientCreate {
  full_name: string;
  company_name?: string | null;
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
}

/** Payload accepted by PATCH /api/budgets/{id}. Every field is optional. */
export interface BudgetUpdate {
  title?: string;
  client_id?: string;
  description?: string | null;
  site_address?: string | null;
  status?: BudgetStatus;
  valid_until?: string | null;
}

/** Payload accepted by POST /api/budgets. */
export interface BudgetCreate {
  title?: string;
  client_id?: string | null;
  description?: string | null;
  site_address?: string | null;
  tax_rate?: number | null;
}

/**
 * Payload accepted by POST /api/budgets/{id}/items.
 *
 * Carry a material_id or a standard_task_id to price the line from the
 * catalog, or description + unit + unit_price for a free line.
 */
export interface BudgetItemCreate {
  material_id?: string | null;
  standard_task_id?: string | null;
  description?: string | null;
  unit?: string | null;
  unit_price?: number | null;
  quantity: number;
  waste_percent?: number;
}

export interface BudgetItem {
  id: string;
  budget_id: string;
  item_type: BudgetItemType;
  material_id: string | null;
  standard_task_id: string | null;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sort_order: number;
}

export interface Budget {
  id: string;
  budget_number: number;
  client_id: string;
  title: string;
  description: string | null;
  site_address: string | null;
  status: BudgetStatus;
  currency: string;
  tax_rate: number;
  subtotal: number;
  tax_amount: number;
  total: number;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
  items: BudgetItem[];
}

/** Blue dollar quote from GET /api/currency/blue. */
export interface BlueRate {
  buy: number;
  sell: number;
  updated_at: string | null;
  source: string;
}

export interface ChatResponse {
  reply: string;
  session_id: string | null;
  model: string | null;
  /** Which engine answered: the Hermes gateway, or the Gemini fallback. */
  engine: "hermes" | "gemini" | null;
}

export interface HealthResponse {
  status: "ok";
  supabase_configured: boolean;
  hermes_configured: boolean;
  gemini_configured: boolean;
}

/** A single message in the chat transcript. */
export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  /** Set when the turn failed, so the bubble can be rendered as an error. */
  failed?: boolean;
}
