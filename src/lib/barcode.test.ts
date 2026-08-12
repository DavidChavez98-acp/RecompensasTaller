/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Lo probable sin navegador del lector de QR: la detección de capacidad (que
 * decide si se descargan ~20 KB de respaldo o cero), las restricciones de
 * cámara, y el mensaje que lee el asesor cuando la cámara no arranca.
 *
 * `crearLectorQr` necesita un <video> real y queda fuera: eso se verifica en el
 * mostrador con un teléfono, no aquí.
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  explicarErrorCamara,
  RESTRICCIONES_CAMARA,
  soportaBarcodeDetectorNativo,
} from "./barcode";

type GlobalConDetector = typeof globalThis & { BarcodeDetector?: unknown };

/** Instala un BarcodeDetector falso y devuelve cómo desinstalarlo. */
function conDetector(formatos: string[] | Error): () => void {
  const global = globalThis as GlobalConDetector;
  const previo = global.BarcodeDetector;

  global.BarcodeDetector = class {
    static getSupportedFormats() {
      if (formatos instanceof Error) return Promise.reject(formatos);
      return Promise.resolve(formatos);
    }
  };

  return () => {
    if (previo === undefined) delete global.BarcodeDetector;
    else global.BarcodeDetector = previo;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección de capacidad
// ─────────────────────────────────────────────────────────────────────────────

test("sin BarcodeDetector (Safari en iOS) se declara no soportado", async () => {
  // Es lo que dispara el import dinámico de qr-scanner. Un falso positivo aquí
  // dejaría al asesor con un escáner que nunca lee nada.
  const global = globalThis as GlobalConDetector;
  const previo = global.BarcodeDetector;
  delete global.BarcodeDetector;

  try {
    assert.equal(await soportaBarcodeDetectorNativo(), false);
  } finally {
    if (previo !== undefined) global.BarcodeDetector = previo;
  }
});

test("con BarcodeDetector que lee qr_code se usa el camino nativo", async () => {
  const restaurar = conDetector(["qr_code", "ean_13", "code_128"]);
  try {
    assert.equal(await soportaBarcodeDetectorNativo(), true);
  } finally {
    restaurar();
  }
});

test("un BarcodeDetector que NO lista qr_code no sirve", async () => {
  // Algunos navegadores exponen el API solo para códigos de barras 1D.
  const restaurar = conDetector(["ean_13", "code_128"]);
  try {
    assert.equal(await soportaBarcodeDetectorNativo(), false);
  } finally {
    restaurar();
  }
});

test("si getSupportedFormats revienta se cae al respaldo, no a una excepción", async () => {
  // Un throw aquí dejaría la pantalla de escaneo en blanco en vez de cargar el
  // lector alternativo.
  const restaurar = conDetector(new Error("no implementado"));
  try {
    assert.equal(await soportaBarcodeDetectorNativo(), false);
  } finally {
    restaurar();
  }
});

test("un BarcodeDetector sin formatos declarados tampoco cuenta", async () => {
  const restaurar = conDetector([]);
  try {
    assert.equal(await soportaBarcodeDetectorNativo(), false);
  } finally {
    restaurar();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Restricciones de cámara
// ─────────────────────────────────────────────────────────────────────────────

test("las restricciones piden cámara trasera y nunca micrófono", () => {
  // `audio: true` haría que iOS pidiera permiso de micrófono para escanear un
  // QR, y el cliente vería un aviso que no tiene nada que ver.
  assert.equal(RESTRICCIONES_CAMARA.audio, false);

  const video = RESTRICCIONES_CAMARA.video as MediaTrackConstraints;
  assert.deepEqual(video.facingMode, { ideal: "environment" }, "trasera, no selfie");
  // `ideal` y no `exact`: con `exact`, un portátil sin cámara trasera fallaría
  // en vez de usar la que tiene.
  assert.ok("ideal" in (video.facingMode as Record<string, unknown>));
});

test("la resolución pedida alcanza para leer un QR a 30 cm", () => {
  const video = RESTRICCIONES_CAMARA.video as MediaTrackConstraints;
  assert.deepEqual(video.width, { ideal: 1280 });
  assert.deepEqual(video.height, { ideal: 720 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mensajes de error de cámara
// ─────────────────────────────────────────────────────────────────────────────

test("cada fallo de cámara tiene su explicación accionable", () => {
  // "No pudimos abrir la cámara" a secas manda al asesor a llamar a sistemas;
  // "diste No permitir" lo manda a los ajustes del navegador.
  const casos: Array<[string, RegExp]> = [
    ["NotAllowedError", /ajustes del navegador/i],
    ["NotFoundError", /no tiene cámara/i],
    ["NotReadableError", /otra aplicación/i],
    ["OverconstrainedError", /cámara trasera/i],
    ["SecurityError", /HTTPS/],
  ];

  for (const [nombre, patron] of casos) {
    assert.match(explicarErrorCamara({ name: nombre }), patron, `mensaje pobre para ${nombre}`);
  }
});

test("un error desconocido no deja al asesor sin salida: le ofrece el código tecleado", () => {
  // El código de respaldo de 8 caracteres existe justo para esto.
  for (const error of [null, undefined, {}, new Error("cualquier cosa"), "texto suelto", 42]) {
    assert.match(
      explicarErrorCamara(error),
      /código tecleado/i,
      `no ofreció alternativa ante ${JSON.stringify(error)}`
    );
  }
});

test("todos los mensajes están en español y no filtran jerga del navegador", () => {
  const nombres = [
    "NotAllowedError",
    "NotFoundError",
    "NotReadableError",
    "OverconstrainedError",
    "SecurityError",
    "AlgoRaroError",
  ];

  for (const nombre of nombres) {
    const mensaje = explicarErrorCamara({ name: nombre });
    assert.ok(mensaje.length > 20, `mensaje demasiado corto para ${nombre}`);
    assert.ok(!mensaje.includes("Error"), `${nombre} filtró el nombre técnico: ${mensaje}`);
  }
});
