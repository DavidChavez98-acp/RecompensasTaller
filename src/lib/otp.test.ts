/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { generarCodigoOtp, hashearCodigo, verificarCodigo, generarCodigoEntrega } from "./otp";
import { codigoOtpSchema } from "./validations";
import { computeBlindIndex, encryptField, decryptField, maskEmail } from "./pii-crypto";

test("generarCodigoOtp siempre devuelve 6 dígitos", () => {
  for (let i = 0; i < 200; i++) {
    const codigo = generarCodigoOtp();
    assert.match(codigo, /^\d{6}$/, `código inválido: ${codigo}`);
  }
});

test("generarCodigoOtp conserva los ceros a la izquierda", () => {
  // Un `String(randomInt())` sin padStart produciría "42" en vez de "000042",
  // y el esquema lo rechazaría al verificar. La prueba fija el contrato.
  const codigos = Array.from({ length: 500 }, generarCodigoOtp);
  assert.ok(
    codigos.every((c) => c.length === 6),
    "algún código salió con menos de 6 caracteres"
  );
});

test("generarCodigoOtp no repite en exceso (entropía razonable)", () => {
  const muestras = new Set(Array.from({ length: 300 }, generarCodigoOtp));
  // Con 10^6 posibles, 300 muestras deberían ser prácticamente todas distintas.
  assert.ok(muestras.size > 290, `demasiadas repeticiones: ${muestras.size}/300`);
});

test("el código generado pasa el esquema de verificación", () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(codigoOtpSchema.safeParse(generarCodigoOtp()).success, true);
  }
});

test("codigoOtpSchema rechaza longitudes y caracteres inválidos", () => {
  assert.equal(codigoOtpSchema.safeParse("12345").success, false, "5 dígitos");
  assert.equal(codigoOtpSchema.safeParse("1234567").success, false, "7 dígitos");
  assert.equal(codigoOtpSchema.safeParse("12a456").success, false, "letra");
  assert.equal(codigoOtpSchema.safeParse("").success, false, "vacío");
  assert.equal(codigoOtpSchema.safeParse(" 123456 ").success, true, "recorta espacios");
});

test("hashear y verificar un código funciona, y el incorrecto falla", async () => {
  const codigo = "482915";
  const hash = await hashearCodigo(codigo);

  assert.notEqual(hash, codigo, "el código no puede quedar en claro");
  assert.match(hash, /^\$2[aby]\$12\$/, "debe ser bcrypt con coste 12");
  assert.equal(await verificarCodigo(codigo, hash), true);
  assert.equal(await verificarCodigo("482916", hash), false);
});

test("generarCodigoEntrega evita caracteres confundibles", () => {
  // Sin I, L, O ni U: el asesor lo dicta en voz alta en el mostrador.
  for (let i = 0; i < 300; i++) {
    const codigo = generarCodigoEntrega();
    assert.match(codigo, /^[0-9A-HJ-NP-TV-Z]{6}$/, `código inválido: ${codigo}`);
    assert.ok(!/[ILOU]/.test(codigo), `contiene carácter confundible: ${codigo}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PII: lo que hace que una cédula no sea legible en un volcado de la base
// ─────────────────────────────────────────────────────────────────────────────

test("encryptField no es determinístico pero decryptField lo recupera", () => {
  const cedula = "1710034065";
  const a = encryptField(cedula);
  const b = encryptField(cedula);

  assert.notEqual(a, b, "IV aleatorio: dos cifrados del mismo valor deben diferir");
  assert.ok(!a.includes(cedula), "el texto plano no puede aparecer en el cifrado");
  assert.equal(decryptField(a), cedula);
  assert.equal(decryptField(b), cedula);
});

test("computeBlindIndex sí es determinístico (por eso permite buscar)", () => {
  // El cifrado con IV aleatorio no sirve para `WHERE columna = ?`; el índice
  // ciego es lo que hace posible el login por cédula y el UNIQUE de cliente.
  assert.equal(computeBlindIndex("1710034065"), computeBlindIndex("1710034065"));
  assert.equal(computeBlindIndex(" 1710034065 "), computeBlindIndex("1710034065"), "recorta espacios");
  assert.notEqual(computeBlindIndex("1710034065"), computeBlindIndex("0926687856"));
});

test("computeBlindIndex normaliza mayúsculas (emails)", () => {
  assert.equal(
    computeBlindIndex("Cliente@Example.com"),
    computeBlindIndex("cliente@example.com")
  );
});

test("maskEmail oculta el usuario pero deja reconocible el dominio", () => {
  const enmascarado = maskEmail("cliente.prueba@example.com");
  assert.ok(enmascarado.startsWith("cl"), "deja dos caracteres para reconocerlo");
  assert.ok(enmascarado.endsWith("@example.com"));
  assert.ok(!enmascarado.includes("prueba"), "no puede filtrar el resto del usuario");
});
