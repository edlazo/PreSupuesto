/** Formatting helpers shared by the workspace and the materials table. */

const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_CURRENCY ?? "ARS";

/**
 * Currency symbols as they are written in Argentina: pesos take the plain
 * sign, and dollars are marked "u$s" to tell the two apart.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  ARS: "$",
  USD: "u$s",
};

const AMOUNT_FORMAT = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const QUANTITY_FORMAT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

const DATE_FORMAT = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Format an amount with its currency symbol: 2599.44 -> "$ 2.599,44".
 *
 * The symbol is placed by hand instead of using Intl's currency style, which
 * would print "US$" for dollars rather than the local "u$s".
 */
export function formatCurrency(amount: number, currency: string = DEFAULT_CURRENCY): string {
  const code = currency.toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code] ?? code;

  return `${symbol} ${AMOUNT_FORMAT.format(amount)}`;
}

/**
 * Convert an amount in pesos to dollars at the given rate, rounded to cents.
 *
 * The backend rounds the same way in `services/pdf_service.convert_budget`, so
 * a converted budget reads identically on screen and in the PDF.
 */
export function convertAmount(amount: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) {
    return amount;
  }

  return Math.round(((amount / rate) + Number.EPSILON) * 100) / 100;
}

/** Format a quantity, dropping trailing zeros: 11.000 -> "11", 2.500 -> "2,5". */
export function formatQuantity(quantity: number): string {
  return QUANTITY_FORMAT.format(quantity);
}

/** A plain date, with no time: "2026-10-07". */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format an ISO timestamp as a short date, e.g. "17 sept 2026".
 *
 * A date with no time — what `valid_until` is — would be read as midnight UTC
 * and then shown in local time, landing on the day before in Argentina, so it
 * is built as a local date instead.
 */
export function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = DATE_ONLY.test(value)
    ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return DATE_FORMAT.format(date);
}
