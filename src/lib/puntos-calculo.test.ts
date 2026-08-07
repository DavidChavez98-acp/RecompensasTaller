/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularPuntos, explicarCalculo, reglaDesdeFila, type ReglaCalculo } from "./puntos-calculo";

/** La regla sembrada: 1 punto por cada $10, tope 5.000 por transacción. */
const REGLA: ReglaCalculo = {
  montoBase: 10,
  puntosPorBase: 1,
  redondeo: "abajo",
  montoMinimo: 0,
  puntosMaximosTransaccion: 5000,
};

test("caso base: 1 punto por cada $10", () => {
  assert.equal(calcularPuntos(100, REGLA).puntos, 10);
  assert.equal(calcularPuntos(250, REGLA).puntos, 25);
  assert.equal(calcularPuntos(10, REGLA).puntos, 1);
});

test("redondeo hacia abajo no regala puntos", () => {
  // $99 con regla de $10 son 9,9 puntos. Hacia abajo, 9.
  assert.equal(calcularPuntos(99, REGLA).puntos, 9);
  assert.equal(calcularPuntos(9.99, REGLA).puntos, 0);
  assert.equal(calcularPuntos(19.99, REGLA).puntos, 1);
});

test("redondeo cercano sí puede subir", () => {
  const regla: ReglaCalculo = { ...REGLA, redondeo: "cercano" };
  assert.equal(calcularPuntos(99, regla).puntos, 10, "9,9 redondea a 10");
  assert.equal(calcularPuntos(94, regla).puntos, 9, "9,4 redondea a 9");
});

test("el multiplicador del servicio se aplica antes de redondear", () => {
  // Redondear el cociente ANTES de multiplicar daría 9 × 1,5 = 13.
  // Redondear al final da floor(9,9 × 1,5) = floor(14,85) = 14.
  assert.equal(calcularPuntos(99, REGLA, 1.5).puntos, 14);
  assert.equal(calcularPuntos(100, REGLA, 0.5).puntos, 5, "repuestos a la mitad");
  assert.equal(calcularPuntos(100, REGLA, 1.5).puntos, 15, "colisión a 1,5");
});

test("monto mínimo bloquea acreditaciones de propina", () => {
  const regla: ReglaCalculo = { ...REGLA, montoMinimo: 20 };
  const bajo = calcularPuntos(19.99, regla);
  assert.equal(bajo.puntos, 0);
  assert.equal(bajo.motivoCero, "monto_minimo");
  assert.equal(calcularPuntos(20, regla).puntos, 2);
});

test("el tope antifraude recorta y lo señala", () => {
  // El asesor teclea $500.000 en vez de $500: serían 50.000 puntos.
  const resultado = calcularPuntos(500_000, REGLA);
  assert.equal(resultado.puntos, 5000, "recortado al tope");
  assert.equal(resultado.puntosSinTope, 50_000);
  assert.equal(resultado.topeAplicado, true, "el recorte debe ser visible, no silencioso");
});

test("sin tope configurado no se recorta", () => {
  const regla: ReglaCalculo = { ...REGLA, puntosMaximosTransaccion: null };
  const resultado = calcularPuntos(500_000, regla);
  assert.equal(resultado.puntos, 50_000);
  assert.equal(resultado.topeAplicado, false);
});

test("montos inválidos dan cero, no NaN ni negativos", () => {
  for (const monto of [0, -1, -1000, NaN, Infinity]) {
    const resultado = calcularPuntos(monto, REGLA);
    assert.equal(resultado.puntos, 0, `monto ${monto}`);
    assert.ok(Number.isInteger(resultado.puntos), `monto ${monto} produjo no-entero`);
  }
});

test("una regla mal configurada no revienta ni regala puntos", () => {
  assert.equal(calcularPuntos(100, { ...REGLA, montoBase: 0 }).puntos, 0, "división por cero");
  assert.equal(calcularPuntos(100, { ...REGLA, puntosPorBase: 0 }).puntos, 0);
  assert.equal(calcularPuntos(100, { ...REGLA, montoBase: -10 }).puntos, 0);
});

test("el resultado siempre es un entero no negativo", () => {
  for (let monto = 0.01; monto < 3000; monto += 7.13) {
    for (const multiplicador of [0.5, 1, 1.5, 2.25]) {
      const { puntos } = calcularPuntos(monto, REGLA, multiplicador);
      assert.ok(Number.isInteger(puntos), `no entero con monto ${monto} × ${multiplicador}`);
      assert.ok(puntos >= 0, `negativo con monto ${monto} × ${multiplicador}`);
    }
  }
});

test("reglaDesdeFila convierte los numeric de Postgres (que llegan como texto)", () => {
  const regla = reglaDesdeFila({
    monto_base: "10.00",
    puntos_por_base: 1,
    redondeo: "abajo",
    monto_minimo: "0",
    puntos_maximos_transaccion: 5000,
  });

  assert.equal(regla.montoBase, 10);
  assert.equal(regla.montoMinimo, 0);
  assert.equal(regla.redondeo, "abajo");
  // Un `"10.00" / 10` en JavaScript funcionaría por coerción, pero
  // `"10.00" * 2` daría 20 y `"10.00" + 2` daría "10.002". La conversión
  // explícita evita ese tipo de sorpresa.
  assert.equal(typeof regla.montoBase, "number");
});

test("reglaDesdeFila cae a 'abajo' ante un valor desconocido", () => {
  const regla = reglaDesdeFila({
    monto_base: "10.00",
    puntos_por_base: 1,
    redondeo: "arriba-inventado",
    monto_minimo: "0",
    puntos_maximos_transaccion: null,
  });
  assert.equal(regla.redondeo, "abajo", "lo desconocido no debe regalar puntos");
});

test("explicarCalculo le dice al asesor lo que va a pasar", () => {
  const normal = calcularPuntos(100, REGLA);
  assert.match(explicarCalculo(100, REGLA, 1, normal), /1 punto por cada \$10\.00/);

  const conMultiplicador = calcularPuntos(100, REGLA, 1.5);
  assert.match(explicarCalculo(100, REGLA, 1.5, conMultiplicador), /por 1\.5 del servicio/);

  const topado = calcularPuntos(500_000, REGLA);
  assert.match(explicarCalculo(500_000, REGLA, 1, topado), /recortados al tope de 5000/);

  const bajoMinimo = calcularPuntos(5, { ...REGLA, montoMinimo: 20 });
  assert.match(explicarCalculo(5, { ...REGLA, montoMinimo: 20 }, 1, bajoMinimo), /monto mínimo/);
});
