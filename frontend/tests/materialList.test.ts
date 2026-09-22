/**
 * Reading a materials list the way it is written by hand.
 *
 * Run with `npm test` (Node's own test runner; no extra dependencies).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMaterialList, readListedQuantity } from "../lib/materialList.ts";

describe("readListedQuantity", () => {
  it("reads nothing from a blank field", () => {
    assert.equal(readListedQuantity("  "), null);
  });

  it("keeps plain numbers as numbers, written the Argentine way", () => {
    assert.deepEqual(readListedQuantity("12"), { quantity: 12, quantity_text: null });
    assert.deepEqual(readListedQuantity("2,5"), { quantity: 2.5, quantity_text: null });
    assert.deepEqual(readListedQuantity("1.000"), { quantity: 1000, quantity_text: null });
    assert.deepEqual(readListedQuantity("1.500,5"), { quantity: 1500.5, quantity_text: null });
  });

  it("keeps anything else exactly as written", () => {
    for (const written of ["1/2", "½", "2 o 3", "2-3", "a definir"]) {
      assert.deepEqual(readListedQuantity(written), { quantity: 1, quantity_text: written });
    }
  });

  it("does not guess at a dotted decimal", () => {
    // "2.5" could be read as 25 here; it is kept as typed instead.
    assert.deepEqual(readListedQuantity("2.5"), { quantity: 1, quantity_text: "2.5" });
  });

  it("keeps zero as text rather than a quantity the database refuses", () => {
    assert.deepEqual(readListedQuantity("0"), { quantity: 1, quantity_text: "0" });
  });

  it("caps what is kept at the column's 40 characters", () => {
    assert.equal(readListedQuantity("x".repeat(50))?.quantity_text?.length, 40);
  });
});

describe("parseMaterialList", () => {
  // The closing list of a real handwritten sheet, plus written quantities.
  const sheet = [
    "1 M³ PIEDRA PARTIDA",
    "3 M² DE ARENA",
    "10 BOLSAS PLASTICOR",
    "1.000 LADRILLOS COMUNES",
    "MADERA",
    "CERÁMICA, ADHESIVO Y PASTINA",
    "- 2,5 m3 hormigón elaborado",
    "1/2 bolsa de cal",
    "½ m3 arena",
    "2 o 3 bolsas de cemento",
    "2-3 baldes de pintura",
    "",
    "3",
  ].join("\n");

  const list = parseMaterialList(sheet);

  it("reads one material per line, skipping blanks and bare numbers", () => {
    assert.equal(list.length, 11);
  });

  it("recognises units, including the ones with superscripts", () => {
    assert.deepEqual(list[0], { name: "PIEDRA PARTIDA", quantity: 1, quantityText: null, unit: "m3" });
    assert.deepEqual(list[1], { name: "ARENA", quantity: 3, quantityText: null, unit: "m2" });
    assert.deepEqual(list[2], { name: "PLASTICOR", quantity: 10, quantityText: null, unit: "bolsa" });
  });

  it("reads thousands and leaves a word that is not a unit in the name", () => {
    assert.deepEqual(list[3], { name: "LADRILLOS COMUNES", quantity: 1000, quantityText: null, unit: "" });
  });

  it("takes a line with no number as a bare name", () => {
    assert.deepEqual(list[4], { name: "MADERA", quantity: null, quantityText: null, unit: "" });
    assert.equal(list[5].name, "CERÁMICA, ADHESIVO Y PASTINA");
  });

  it("drops bullets and a leading 'de'", () => {
    assert.deepEqual(list[6], { name: "Hormigón elaborado", quantity: 2.5, quantityText: null, unit: "m3" });
  });

  it("keeps written quantities as written, with their unit", () => {
    assert.deepEqual(list[7], { name: "Cal", quantity: null, quantityText: "1/2", unit: "bolsa" });
    assert.deepEqual(list[8], { name: "Arena", quantity: null, quantityText: "½", unit: "m3" });
    assert.deepEqual(list[9], { name: "Cemento", quantity: null, quantityText: "2 o 3", unit: "bolsa" });
    assert.deepEqual(list[10], { name: "Pintura", quantity: null, quantityText: "2-3", unit: "balde" });
  });
});
