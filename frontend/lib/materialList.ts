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
  /** Left out when no unit word was recognised. */
  unit: string;
}

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

    const words = line.split(/\s+/);
    const quantity = toQuantity(words[0]);

    if (quantity === null) {
      parsed.push({ name: tidy(line), quantity: null, unit: "" });
      continue;
    }

    const rest = words.slice(1);
    const unit = rest.length > 1 ? UNITS.get(fold(rest[0])) : undefined;
    const name = tidy((unit ? rest.slice(1) : rest).join(" "));

    // A number with nothing after it names nothing, so it is dropped.
    if (name) {
      parsed.push({ name, quantity, unit: unit ?? "" });
    }
  }

  return parsed;
}
