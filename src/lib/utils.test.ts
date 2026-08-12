/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Formateo y saneamiento. Dos de estas funciones no son cosméticas:
 *
 *  - `normalizeClientIp` es la clave del rate limit. Si devuelve la cadena
 *    entera de proxies, el límite por IP se elude añadiendo una cabecera.
 *  - `formatearFecha` tiene que rendir en America/Guayaquil aunque Vercel corra
 *    en UTC, o los reportes por día cambian de fecha a las 19:00 de Ambato.
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cn,
  formatearFecha,
  formatearMonto,
  formatearPuntos,
  getEcuadorDate,
  normalizeClientIp,
  sanitizeString,
} from "./utils";
import { ZONA_HORARIA } from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// normalizeClientIp — superficie del rate limit
// ─────────────────────────────────────────────────────────────────────────────

test("normalizeClientIp se queda con el PRIMER valor de x-forwarded-for", () => {
  // "cliente, proxy1, proxy2": solo el primero es el cliente real. Sin esto,
  // añadir un salto falso a la cabecera daría una clave nueva y saltarse el
  // límite sería trivial.
  assert.equal(normalizeClientIp("186.4.1.2, 10.0.0.1, 10.0.0.2"), "186.4.1.2");
  assert.equal(normalizeClientIp("  186.4.1.2  ,  10.0.0.1  "), "186.4.1.2", "recorta espacios");
  assert.equal(normalizeClientIp("186.4.1.2"), "186.4.1.2", "sin proxies, tal cual");
});

test("normalizeClientIp da una clave estable cuando no hay IP", () => {
  // Devolver "" agruparía a todos los anónimos bajo la misma clave vacía por
  // accidente; "unknown" lo hace a propósito y es legible en los logs.
  for (const entrada of [null, undefined, "", "   ", ",", " , "]) {
    assert.equal(normalizeClientIp(entrada), "unknown", `falló con ${JSON.stringify(entrada)}`);
  }
});

test("normalizeClientIp acepta IPv6", () => {
  assert.equal(normalizeClientIp("2800:bf0:1::1, 10.0.0.1"), "2800:bf0:1::1");
});

// ─────────────────────────────────────────────────────────────────────────────
// Formato que ve el cliente
// ─────────────────────────────────────────────────────────────────────────────

test("formatearPuntos usa el separador de miles ecuatoriano (punto)", () => {
  assert.equal(formatearPuntos(12345), "12.345");
  assert.equal(formatearPuntos(0), "0");
  assert.equal(formatearPuntos(999), "999");
  assert.equal(formatearPuntos(1000000), "1.000.000");
});

test("formatearPuntos muestra los negativos (un débito del ledger)", () => {
  // El ledger guarda los puntos CON SIGNO, así que la vista de movimientos
  // recibe negativos y no puede tragárselos.
  assert.match(formatearPuntos(-500), /500/);
  assert.ok(formatearPuntos(-500).startsWith("-"));
});

test("formatearMonto rinde dólares en formato ecuatoriano", () => {
  // Punto de miles, coma decimal, dos decimales siempre.
  assert.equal(formatearMonto(1234.5), "$1.234,50");
  assert.equal(formatearMonto(0), "$0,00");
  assert.equal(formatearMonto(99), "$99,00");
});

test("formatearMonto acepta el texto que Drizzle devuelve para las columnas numeric", () => {
  // `monto_gastado` es `numeric` y llega como string. Un `.toFixed()` directo
  // sobre ese valor reventaría; por eso la función convierte.
  assert.equal(formatearMonto("1234.50"), "$1.234,50");
  assert.equal(formatearMonto("150.00"), "$150,00");
  assert.equal(formatearMonto("0.00"), "$0,00");
});

// ─────────────────────────────────────────────────────────────────────────────
// Fechas: Vercel corre en UTC, el taller está en Ambato
// ─────────────────────────────────────────────────────────────────────────────

test("formatearFecha convierte a la hora de Ecuador, no a la del servidor", () => {
  // 15:30 UTC son las 10:30 en Guayaquil (UTC−5, sin horario de verano).
  const texto = formatearFecha(new Date("2026-08-08T15:30:00Z"));
  assert.match(texto, /10:30/, `esperaba la hora local de Ecuador, dio: ${texto}`);
  assert.ok(!texto.includes("15:30"), "no puede mostrar la hora UTC");
  assert.match(texto, /2026/);
});

test("formatearFecha no adelanta el día al final de la tarde en Ambato", () => {
  // 02:00 UTC del 9 son las 21:00 del 8 en Ecuador. Formatear en UTC movería
  // la acreditación al día siguiente en el reporte diario.
  const texto = formatearFecha(new Date("2026-08-09T02:00:00Z"));
  assert.match(texto, /\b8\b/, `debería seguir siendo día 8, dio: ${texto}`);
});

test("formatearFecha acepta también la fecha como texto ISO", () => {
  assert.equal(
    formatearFecha("2026-08-08T15:30:00Z"),
    formatearFecha(new Date("2026-08-08T15:30:00Z"))
  );
});

test("la zona horaria del concesionario no tiene horario de verano", () => {
  // Enero y julio deben dar el mismo desfase; si algún día cambiara, los
  // reportes por día dejarían de cuadrar dos veces al año.
  const enero = formatearFecha(new Date("2026-01-15T15:00:00Z"));
  const julio = formatearFecha(new Date("2026-07-15T15:00:00Z"));
  const hora = (texto: string) => texto.match(/\d{1,2}:\d{2}/)?.[0];
  assert.equal(hora(enero), hora(julio), "Ecuador no cambia la hora");
  assert.equal(ZONA_HORARIA, "America/Guayaquil");
});

test("getEcuadorDate devuelve la hora local del taller", () => {
  const fecha = getEcuadorDate("2026-08-08T15:30:00Z");
  assert.equal(fecha.getHours(), 10, "15:30 UTC son las 10:30 en Ecuador");
  assert.equal(fecha.getDate(), 8);
});

test("getEcuadorDate sin argumento cae en 'ahora'", () => {
  for (const vacio of [null, undefined, ""]) {
    const fecha = getEcuadorDate(vacio);
    assert.ok(fecha instanceof Date);
    assert.ok(Number.isFinite(fecha.getTime()), `dio fecha inválida con ${JSON.stringify(vacio)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeString
// ─────────────────────────────────────────────────────────────────────────────

test("sanitizeString quita las etiquetas HTML y recorta", () => {
  assert.equal(sanitizeString("  <b>Gorra</b> institucional  "), "Gorra institucional");
  assert.equal(sanitizeString("texto sin etiquetas"), "texto sin etiquetas");
});

test("sanitizeString repite hasta que no queda nada que quitar", () => {
  // El bucle do/while es lo que impide el bypass clásico: una pasada única
  // sobre "<scr<script>ipt>" deja una etiqueta reconstruida.
  assert.ok(!sanitizeString("<scr<script>ipt>alert(1)</script>").includes("<script"));
  assert.ok(!sanitizeString("<<div>div>hola<</div>/div>").includes("<div"));
});

test("sanitizeString también borra una etiqueta sin cerrar", () => {
  // El `(>|$)` del patrón cubre el caso de la etiqueta truncada al final.
  assert.equal(sanitizeString("hola <img src=x onerror=alert(1)"), "hola");
});

test("sanitizeString devuelve cadena vacía ante null o undefined", () => {
  assert.equal(sanitizeString(null), "");
  assert.equal(sanitizeString(undefined), "");
  assert.equal(sanitizeString(""), "");
});

// ─────────────────────────────────────────────────────────────────────────────
// cn
// ─────────────────────────────────────────────────────────────────────────────

test("cn deja ganar la última clase de Tailwind en conflicto", () => {
  // Es lo que permite que un componente reciba `className` y de verdad
  // sobrescriba el estilo por defecto en vez de quedar tras él.
  assert.equal(cn("p-2", "p-4"), "p-4");
  assert.equal(cn("text-red-500", "text-white"), "text-white");
});

test("cn ignora falsos y admite condicionales", () => {
  assert.equal(cn("base", false && "oculta", undefined, null, ""), "base");
  assert.equal(cn("base", { activo: true, inactivo: false }), "base activo");
});
