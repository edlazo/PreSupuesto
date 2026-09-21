/**
 * Reading a materials list the way it is written by hand.
 *
 * A sheet closes with lines like "1 m3 piedra partida", "10 bolsas plasticor",
 * "1.000 ladrillos comunes" or just "madera". This turns that text into lines
 * a budget can hold: a quantity when there is one, a unit when the word is a
 * unit, and the rest as the name.
 */

/** One line of a pasted list, as it was understood. */
export interface ParsedMaterial {
  name: string;
  /** Left out when the line carries no number. */
  quantity: number | null;
  /** A quantity that is not a plain number — "1/2", "2 o 3" — kept as written. */
  quantityText: string | null;
  /** Left out when no unit word was recognised. */
  unit: string;
}

/** How a listed quantity is stored: a number when it is one, else as written. */
export interface ListedQuantity {
  quantity: number;
  quantity_text: string | null;
}

/** Longest written quantity the database keeps. */
export const MAX_QUANTITY_TEXT = 40;

/** Digits, thousands grouped with dots, an optional decimal comma. */
const PLAIN_NUMBER = /^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;

/** Words that name a unit rather than a material. */
const UNITS = new Map<string, string>([
  ["m3", "m3"],
  ["m³", "m3"],
  ["mts3", "m3"],
  ["m2", "m2"],
  ["m²", "m2"],
  ["mts2", "m2"],
  ["m", "m"],
  ["ml", "ml"],
  ["mts", "m"],
  ["metro", "m"],
  ["metros", "m"],
  ["kg", "kg"],
  ["kilo", "kg"],
  ["kilos", "kg"],
  ["l", "l"],
  ["lt", "l"],
  ["lts", "l"],
  ["litro", "l"],
  ["litros", "l"],
  ["u", "u"],
  ["un", "u"],
  ["unidad", "u"],
  ["unidades", "u"],
  ["bolsa", "bolsa"],
  ["bolsas", "bolsa"],
  ["balde", "balde"],
  ["baldes", "balde"],
  ["caja", "caja"],
  ["cajas", "caja"],
  ["rollo", "rollo"],
  ["rollos", "rollo"],
  ["pack", "pack"],
  ["packs", "pack"],
]);

/** A number as it is written here: 1.000 is a thousand, 2,5 is two and a half. */
function toQuantity(text: string): number | null {
  const parsed = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Read what was typed as a listed quantity.
 *
 * "3", "2,5" and "1.000" stay numbers, as before. Anything else — "1/2", "½",
 * "2 o 3", "a definir" — is kept exactly as written, and the numeric quantity
 * is left at one. Blank means no quantity at all.
 */
export function readListedQuantity(text: string): ListedQuantity | null {
  const written = text.trim().slice(0, MAX_QUANTITY_TEXT);

  if (!written) {
    return null;
  }

  // A number the way it is written here: 1.000, 2,5, 12. Anything else — "2.5"
  // included — is kept as typed rather than risk reading it wrong.
  const number = PLAIN_NUMBER.test(written) ? toQuantity(written) : null;

  return number !== null
    ? { quantity: number, quantity_text: null }
    : { quantity: 1, quantity_text: written };
}

/** Starts a line with a quantity that is written rather than a plain number. */
const WRITTEN_QUANTITY =
  /^(\d+(?:[.,]\d+)?\s+(?:o|a|y)\s+\d+(?:[.,]\d+)?|[\d½¼¾⅓⅔][\d½¼¾⅓⅔.,/\-+~]*)(?=\s|$)/i;

/** Fold accents and case, to look a word up among the units. */
function fold(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Capitalise the first letter and leave the rest as it was typed. */
function tidy(name: string): string {
  const trimmed = name.replace(/^de\s+/i, "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

/** Read a pasted list, one material per line. */
export function parseMaterialList(text: string): ParsedMaterial[] {
  const parsed: ParsedMaterial[] = [];

  for (const raw of text.split(/\r?\n/)) {
    // Bullets and dashes are how a list gets written; they are not the name.
    const line = raw.trim().replace(/^[-•*·]\s*/, "");

    if (!line) {
      continue;
    }

    const lead = WRITTEN_QUANTITY.exec(line);

    if (!lead) {
      parsed.push({ name: tidy(line), quantity: null, quantityText: null, unit: "" });
      continue;
    }

    const read = readListedQuantity(lead[1]);
    const rest = line.slice(lead[0].length).trim().split(/\s+/).filter(Boolean);
    const unit = rest.length > 1 ? UNITS.get(fold(rest[0])) : undefined;
    const name = tidy((unit ? rest.slice(1) : rest).join(" "));

    // A number with nothing after it names nothing, so it is dropped.
    if (name && read) {
      parsed.push({
        name,
        quantity: read.quantity_text === null ? read.quantity : null,
        quantityText: read.quantity_text,
        unit: unit ?? "",
      });
    }
  }

  return parsed;
}
