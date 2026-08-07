/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCedula, validateRuc, validateCellphone, premioSchema } from "./validations";

test("validateCedula acepta cédulas ecuatorianas válidas", () => {
  assert.equal(validateCedula("1710034065"), true);
  assert.equal(validateCedula("0926687856"), true);
});

test("validateCedula rechaza dígito verificador incorrecto", () => {
  assert.equal(validateCedula("1710034066"), false);
});

test("validateCedula rechaza longitud y provincia inválidas", () => {
  assert.equal(validateCedula("171003406"), false, "9 dígitos");
  assert.equal(validateCedula("17100340650"), false, "11 dígitos");
  assert.equal(validateCedula("9910034065"), false, "provincia 99");
  assert.equal(validateCedula("abcdefghij"), false, "no numérica");
});

test("validateRuc acepta persona natural y sociedad", () => {
  assert.equal(validateRuc("1710034065001"), true, "natural: cédula + 001");
  assert.equal(validateRuc("1791234567001"), true, "sociedad privada: tercer dígito 9");
});

test("validateRuc rechaza establecimiento 000", () => {
  assert.equal(validateRuc("1710034065000"), false);
});

test("validateCellphone acepta formato local y con código de país", () => {
  assert.equal(validateCellphone("0987654321"), true);
  assert.equal(validateCellphone("593987654321"), true);
});

test("validateCellphone rechaza fijos y longitudes malas", () => {
  assert.equal(validateCellphone("032845678"), false, "convencional");
  assert.equal(validateCellphone("098765432"), false, "9 dígitos");
  assert.equal(validateCellphone("09876543210"), false, "11 dígitos");
});

// El CHECK de Postgres (premios_stock_segun_tipo) es la defensa dura; este
// esquema lo replica en el borde para dar un mensaje entendible en la UI en
// vez de un error de base de datos.
test("premioSchema exige stock al merchandising", () => {
  const base = {
    codigo: "GORRA",
    nombre: "Gorra institucional",
    descripcion: "",
    costo_puntos: 500,
    stock_minimo_alerta: 5,
    activo: true,
  };

  assert.equal(
    premioSchema.safeParse({ ...base, tipo: "merchandising", stock: 12 }).success,
    true
  );
  assert.equal(
    premioSchema.safeParse({ ...base, tipo: "merchandising", stock: null }).success,
    false,
    "merchandising sin stock sería un premio infinito por descuido"
  );
});

test("premioSchema rechaza stock en un servicio", () => {
  const base = {
    codigo: "ACEITE",
    nombre: "Cambio de aceite",
    descripcion: "",
    costo_puntos: 20000,
    stock_minimo_alerta: null,
    activo: true,
  };

  assert.equal(premioSchema.safeParse({ ...base, tipo: "servicio", stock: null }).success, true);
  assert.equal(
    premioSchema.safeParse({ ...base, tipo: "servicio", stock: 10 }).success,
    false,
    "un servicio con stock sería inventario fantasma"
  );
});
