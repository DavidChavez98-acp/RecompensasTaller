/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analizarToken,
  base64UrlABytes,
  bytesABase64Url,
  compactoAUuid,
  construirMensaje,
  construirToken,
  derivarCodigoRespaldo,
  msHastaSiguientePaso,
  normalizarCodigoRespaldo,
  pasoActual,
  sonIguales,
  uuidACompacto,
  verificarToken,
} from "./qr-token";
import { QR_PASO_SEGUNDOS, QR_TOLERANCIA_PASOS } from "./constants";

// Vectores fijos: si alguien cambia el formato del mensaje firmado o el
// truncado del MAC, estas pruebas caen. Es el objetivo — un cambio ahí invalida
// todos los códigos en circulación y no puede pasar por accidente.
const DISPOSITIVO = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const SECRETO = new Uint8Array(32).fill(7);
const PASO = 29_000_000;

test("uuidACompacto y compactoAUuid son inversos, y comprimen a 22 caracteres", () => {
  const compacto = uuidACompacto(DISPOSITIVO);
  assert.equal(compacto.length, 22, "22 caracteres frente a los 36 del UUID");
  assert.equal(compactoAUuid(compacto), DISPOSITIVO);
});

test("base64url ida y vuelta sin relleno", () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  const texto = bytesABase64Url(bytes);
  assert.ok(!texto.includes("="), "no debe llevar relleno");
  assert.ok(!texto.includes("+") && !texto.includes("/"), "debe ser base64url");
  assert.deepEqual(base64UrlABytes(texto), bytes);
});

test("el mensaje firmado incluye el paso", () => {
  // Si el paso viajara fuera de la firma, cualquiera podría reescribirlo y el
  // MAC seguiría cuadrando con otro instante.
  assert.equal(construirMensaje(DISPOSITIVO, PASO), `GP1|${DISPOSITIVO}|${PASO}`);
  assert.notEqual(construirMensaje(DISPOSITIVO, PASO), construirMensaje(DISPOSITIVO, PASO + 1));
});

test("el token cabe en ~56 caracteres", async () => {
  const { token } = await construirToken(DISPOSITIVO, SECRETO, PASO);
  assert.ok(token.length <= 60, `token demasiado largo (${token.length}): el QR sube de versión`);
  assert.ok(token.startsWith("GP1."), "prefijo de versión");
  assert.equal(token.split(".").length, 4);
});

test("el token NO contiene datos personales", async () => {
  const { token } = await construirToken(DISPOSITIVO, SECRETO, PASO);
  // Una foto del QR ajeno no puede revelar nada del cliente.
  assert.ok(!token.includes("1710034065"));
  assert.ok(!/@/.test(token));
});

test("construir y verificar en el mismo paso funciona", async () => {
  const ahora = PASO * QR_PASO_SEGUNDOS * 1000;
  const { token } = await construirToken(DISPOSITIVO, SECRETO, PASO);
  const resultado = await verificarToken(token, SECRETO, ahora);

  assert.equal(resultado.valido, true);
  if (resultado.valido) {
    assert.equal(resultado.dispositivoId, DISPOSITIVO);
    assert.equal(resultado.paso, PASO);
  }
});

test("el mismo secreto y paso producen siempre el mismo token (determinista)", async () => {
  const a = await construirToken(DISPOSITIVO, SECRETO, PASO);
  const b = await construirToken(DISPOSITIVO, SECRETO, PASO);
  assert.equal(a.token, b.token);
  assert.equal(a.codigoRespaldo, b.codigoRespaldo);
});

test("un secreto distinto produce un token distinto y la firma falla", async () => {
  const otroSecreto = new Uint8Array(32).fill(9);
  const { token } = await construirToken(DISPOSITIVO, SECRETO, PASO);
  const resultado = await verificarToken(token, otroSecreto, PASO * QR_PASO_SEGUNDOS * 1000);

  assert.equal(resultado.valido, false);
  if (!resultado.valido) assert.equal(resultado.motivo, "firma");
});

test("manipular el MAC invalida la firma", async () => {
  const { token } = await construirToken(DISPOSITIVO, SECRETO, PASO);
  const partes = token.split(".");
  // Cambia un carácter del MAC.
  partes[3] = (partes[3] as string).slice(0, -1) + ((partes[3] as string).endsWith("A") ? "B" : "A");
  const resultado = await verificarToken(partes.join("."), SECRETO, PASO * QR_PASO_SEGUNDOS * 1000);

  assert.equal(resultado.valido, false);
  if (!resultado.valido) assert.equal(resultado.motivo, "firma");
});

test("reescribir el paso invalida la firma (no solo la ventana)", async () => {
  const { token } = await construirToken(DISPOSITIVO, SECRETO, PASO);
  const partes = token.split(".");
  partes[2] = (PASO + 1).toString(36);
  const resultado = await verificarToken(partes.join("."), SECRETO, (PASO + 1) * QR_PASO_SEGUNDOS * 1000);

  assert.equal(resultado.valido, false);
  if (!resultado.valido) {
    assert.equal(resultado.motivo, "firma", "debe fallar por firma, no por ventana");
  }
});

test("la tolerancia acepta ±2 pasos y rechaza el tercero", async () => {
  const { token } = await construirToken(DISPOSITIVO, SECRETO, PASO);

  for (let desfase = -QR_TOLERANCIA_PASOS; desfase <= QR_TOLERANCIA_PASOS; desfase++) {
    const ahora = (PASO + desfase) * QR_PASO_SEGUNDOS * 1000;
    const resultado = await verificarToken(token, SECRETO, ahora);
    assert.equal(resultado.valido, true, `desfase ${desfase} debería aceptarse`);
  }

  const demasiadoViejo = (PASO + QR_TOLERANCIA_PASOS + 1) * QR_PASO_SEGUNDOS * 1000;
  const resultado = await verificarToken(token, SECRETO, demasiadoViejo);
  assert.equal(resultado.valido, false);
  if (!resultado.valido) {
    assert.equal(resultado.motivo, "fuera_de_ventana");
    // El desfase permite decirle al asesor "el reloj del teléfono está corrido"
    // en vez de un error genérico.
    assert.equal(resultado.desfasePasos, -(QR_TOLERANCIA_PASOS + 1));
  }
});

test("analizarToken rechaza basura y acepta el token dentro de una URL", async () => {
  assert.equal(analizarToken("no es un token"), null);
  assert.equal(analizarToken("GP1.solo.tres"), null);
  assert.equal(analizarToken("XX1.a.b.c"), null, "prefijo equivocado");

  const { token } = await construirToken(DISPOSITIVO, SECRETO, PASO);
  const desdeUrl = analizarToken(`https://recompensas.grupopalacios.com.ec/q/${token}`);
  assert.notEqual(desdeUrl, null, "debe aceptar el token embebido en una URL");
  assert.equal(desdeUrl?.dispositivoId, DISPOSITIVO);
});

test("sonIguales compara correctamente", () => {
  assert.equal(sonIguales(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(sonIguales(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(sonIguales(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});

test("el código de respaldo tiene 8 caracteres sin confundibles", async () => {
  const { codigoRespaldo } = await construirToken(DISPOSITIVO, SECRETO, PASO);
  assert.equal(codigoRespaldo.length, 8);
  assert.match(codigoRespaldo, /^[0-9A-HJ-NP-TV-Z]{8}$/);
});

test("normalizarCodigoRespaldo corrige lo que confunde el asesor al teclear", () => {
  assert.equal(normalizarCodigoRespaldo(" ab-cd ef1 "), "ABCDEF1", "recorta, sube a mayúsculas y quita separadores");
  assert.equal(normalizarCodigoRespaldo("O0IL1U"), "00111V", "O→0, I y L→1, U→V");
  assert.equal(normalizarCodigoRespaldo("oi"), "01");
});

test("pasoActual avanza una vez por minuto", () => {
  const base = 1_800_000_000_000;
  assert.equal(pasoActual(base), pasoActual(base + 1000), "un segundo después, mismo paso");
  assert.equal(
    pasoActual(base + QR_PASO_SEGUNDOS * 1000) - pasoActual(base),
    1,
    "un minuto después, paso siguiente"
  );
});

test("msHastaSiguientePaso alimenta la cuenta atrás", () => {
  const duracionMs = QR_PASO_SEGUNDOS * 1000;
  const justoEmpezado = pasoActual() * duracionMs;
  assert.equal(msHastaSiguientePaso(justoEmpezado), duracionMs);
  assert.equal(msHastaSiguientePaso(justoEmpezado + 1000), duracionMs - 1000);
});

test("derivarCodigoRespaldo es determinista y cambia con el MAC", () => {
  const mac = new Uint8Array([0xff, 0x00, 0xab, 0xcd, 0xef, 1, 2, 3]);
  assert.equal(derivarCodigoRespaldo(mac), derivarCodigoRespaldo(mac));

  const otro = new Uint8Array([0xfe, 0x00, 0xab, 0xcd, 0xef, 1, 2, 3]);
  assert.notEqual(derivarCodigoRespaldo(mac), derivarCodigoRespaldo(otro));
});
