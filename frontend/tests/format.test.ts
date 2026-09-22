/** Run with `npm test`. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convertAmount, formatCurrency, formatDate, formatQuantity } from "../lib/format.ts";

describe("formatDate", () => {
  it("keeps the day of a date with no time", () => {
    // Read as midnight UTC this would show the 6th in Argentina (UTC-3).
    const shown = formatDate("2026-10-07");
    assert.ok(shown.startsWith("7 "), shown);
    assert.ok(shown.includes("oct"), shown);
    assert.ok(shown.includes("2026"), shown);
  });

  it("formats a timestamp", () => {
    const shown = formatDate("2026-09-17T10:00:00+00:00");
    assert.ok(shown.startsWith("17 "), shown);
    assert.ok(shown.includes("sept"), shown);
  });

  it("shows a dash when there is no date", () => {
    assert.equal(formatDate(null), "—");
    assert.equal(formatDate("el jueves"), "—");
  });
});

describe("money and quantities", () => {
  it("writes amounts the Argentine way", () => {
    assert.equal(formatCurrency(2599.44), "$ 2.599,44");
    assert.equal(formatCurrency(1600000, "USD"), "u$s 1.600.000,00");
  });

  it("converts to dollars, rounded to cents", () => {
    assert.equal(convertAmount(1555, 1555), 1);
    assert.equal(convertAmount(1000, 3), 333.33);
    // A rate that makes no sense leaves the amount alone.
    assert.equal(convertAmount(1000, 0), 1000);
  });

  it("drops trailing zeros from quantities", () => {
    assert.equal(formatQuantity(11), "11");
    assert.equal(formatQuantity(2.5), "2,5");
    assert.equal(formatQuantity(1000), "1.000");
  });
});
