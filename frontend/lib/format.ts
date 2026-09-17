/** Formatting helpers shared by the workspace and the materials table. */

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_CURRENCY ?? "EUR";

/** Format an amount as currency, e.g. 811.5 -> "€811.50". */
export function formatCurrency(amount: number, currency: string = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Format a quantity, dropping trailing zeros: 11.000 -> "11", 2.500 -> "2.5". */
export function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("en-IE", { maximumFractionDigits: 3 }).format(quantity);
}

/** Format an ISO timestamp as a short date, e.g. "17 Sep 2026". */
export function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
