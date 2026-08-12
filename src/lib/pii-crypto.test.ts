/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Cifrado de PII en reposo. Lo que se prueba aquí es la propiedad que hace que
 * un volcado de la base de Neon no sea una filtración: sin PII_ENCRYPTION_KEY
 * las cédulas no se leen, y sin ella tampoco se pueden forjar códigos QR.
 *
 * Estas pruebas corren con las claves de desarrollo (las variables no están
 * definidas en el entorno de prueba). Eso es correcto: se comprueba el
 * ALGORITMO, no el secreto.
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeBlindIndex,
  decryptClienteRow,
  decryptClienteRows,
  decryptDeviceSecret,
  decryptField,
  decryptNullableField,
  encryptField,
  encryptNullableField,
  maskEmail,
} from "./pii-crypto";

const CEDULA = "1710034065";

// ─────────────────────────────────────────────────────────────────────────────
// Formato e ida y vuelta
// ─────────────────────────────────────────────────────────────────────────────

test("el cifrado lleva el prefijo de versión y sus tres partes", () => {
  // Formato: v1:<iv>:<authTag>:<ciphertext>. El prefijo es lo que permite
  // distinguir un valor cifrado de un texto plano legado sin adivinar.
  const cifrado = encryptField(CEDULA);
  assert.ok(cifrado.startsWith("v1:"), "falta el prefijo de versión");
  assert.equal(cifrado.split(":").length, 4, "v1 + iv + tag + ciphertext");
});

test("ida y vuelta conserva el valor exacto, incluidos acentos y emoji", () => {
  // El nombre del cliente y la dirección pueden traer tildes y la ñ; un
  // roundtrip que corrompa bytes se vería como datos rotos en el panel.
  for (const valor of [CEDULA, "cliente@example.com", "0987654321", "Ñandú ïóü 🇪🇨", ""]) {
    assert.equal(decryptField(encryptField(valor)), valor, `falló con ${JSON.stringify(valor)}`);
  }
});

test("dos cifrados del mismo texto difieren: el IV es aleatorio", () => {
  // Sin IV aleatorio, un atacante con acceso de lectura podría contar cuántos
  // clientes comparten un valor (y con un diccionario, cuál es).
  const muestras = new Set(Array.from({ length: 50 }, () => encryptField(CEDULA)));
  assert.equal(muestras.size, 50, "algún cifrado se repitió: el IV no es aleatorio");
});

test("el texto plano nunca aparece dentro del cifrado", () => {
  const cifrado = encryptField(CEDULA);
  assert.ok(!cifrado.includes(CEDULA));
  assert.ok(!Buffer.from(cifrado).includes(Buffer.from(CEDULA)));
});

// ─────────────────────────────────────────────────────────────────────────────
// Autenticación GCM: manipular el dato tiene que fallar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cambia el PRIMER carácter de una de las partes base64url.
 *
 * No el último a propósito: el carácter final de un base64url sin relleno
 * arrastra bits de sobra que el decodificador descarta, así que tocarlo puede
 * producir exactamente los mismos bytes y la prueba pasaría o fallaría según el
 * valor aleatorio del IV. El primero siempre son 6 bits significativos.
 */
function manipular(cifrado: string, indiceParte: number): string {
  const partes = cifrado.split(":");
  const parte = partes[indiceParte] as string;
  partes[indiceParte] = (parte.startsWith("A") ? "B" : "A") + parte.slice(1);
  return partes.join(":");
}

test("manipular el ciphertext NO devuelve texto plano (falla la autenticación GCM)", () => {
  // GCM autentica además de cifrar: cambiar un byte invalida el authTag. Si
  // esto fallara, alguien con UPDATE sobre la base podría reescribir la cédula
  // de un cliente y el sistema lo aceptaría como válido.
  const manipulado = manipular(encryptField(CEDULA), 3);
  assert.equal(
    decryptField(manipulado),
    manipulado,
    "un dato manipulado debe devolverse tal cual, nunca descifrado a medias"
  );
  assert.notEqual(decryptField(manipulado), CEDULA);
});

test("manipular el authTag o el IV tampoco descifra", () => {
  for (const indice of [1, 2]) {
    const manipulado = manipular(encryptField(CEDULA), indice);
    assert.notEqual(decryptField(manipulado), CEDULA, `parte ${indice}`);
  }
});

test("decryptField no revienta ante basura: devuelve la entrada", () => {
  // Preferible mostrar el ciphertext en el panel a tumbar la vista entera del
  // asesor por una fila corrupta.
  for (const basura of ["v1:", "v1:solo:dos", "v1:a:b:c:d", "v1:!!!:???:###"]) {
    assert.equal(decryptField(basura), basura, `falló con ${basura}`);
  }
});

test("un texto plano legado (sin prefijo) se devuelve tal cual", () => {
  assert.equal(decryptField(CEDULA), CEDULA);
  assert.equal(decryptField("cualquier-cosa-vieja"), "cualquier-cosa-vieja");
});

// ─────────────────────────────────────────────────────────────────────────────
// El secreto del dispositivo: aquí fallar en silencio es inaceptable
// ─────────────────────────────────────────────────────────────────────────────

test("decryptDeviceSecret recupera el secreto cuando la clave es correcta", () => {
  const secreto = "c2VjcmV0by1kZS1kaXNwb3NpdGl2bw";
  assert.equal(decryptDeviceSecret(encryptField(secreto)), secreto);
});

test("decryptDeviceSecret LANZA si no puede descifrar (no devuelve el ciphertext)", () => {
  // La variante permisiva devolvería el ciphertext, y con él se calcularían
  // MACs válidos contra un secreto equivocado: todos los QR de ese cliente
  // dejarían de verificar sin que nadie se entere. Mejor romper ruidoso.
  const manipulado = manipular(encryptField("secreto"), 3);
  assert.throws(() => decryptDeviceSecret(manipulado), /No se pudo descifrar/);
});

test("decryptDeviceSecret acepta un secreto legado en texto plano", () => {
  // Sin prefijo v1: no hay nada que descifrar, así que no es un fallo.
  assert.equal(decryptDeviceSecret("secreto-plano-legado"), "secreto-plano-legado");
});

// ─────────────────────────────────────────────────────────────────────────────
// Variantes nullable (email y teléfono son opcionales)
// ─────────────────────────────────────────────────────────────────────────────

test("encryptNullableField convierte el vacío en NULL, no en un cifrado de ''", () => {
  // Un cliente sin teléfono debe quedar como NULL en la columna: cifrar la
  // cadena vacía guardaría 60 bytes que dicen "nada".
  assert.equal(encryptNullableField(null), null);
  assert.equal(encryptNullableField(undefined), null);
  assert.equal(encryptNullableField(""), null);

  const cifrado = encryptNullableField("0987654321");
  assert.notEqual(cifrado, null);
  assert.equal(decryptNullableField(cifrado), "0987654321");
});

test("decryptNullableField deja pasar el NULL", () => {
  assert.equal(decryptNullableField(null), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Índice ciego: lo que permite `WHERE columna = ?` sobre un campo cifrado
// ─────────────────────────────────────────────────────────────────────────────

test("computeBlindIndex es determinista y de longitud fija (HMAC-SHA256 hex)", () => {
  const indice = computeBlindIndex(CEDULA);
  assert.equal(indice.length, 64, "SHA-256 en hexadecimal");
  assert.match(indice, /^[0-9a-f]{64}$/);
  assert.equal(indice, computeBlindIndex(CEDULA), "misma entrada, mismo índice");
});

test("computeBlindIndex normaliza espacios y mayúsculas antes de firmar", () => {
  // El asesor teclea con espacios y el cliente escribe el correo en mayúsculas;
  // si el índice no normalizara, el UNIQUE de cliente dejaría entrar duplicados.
  assert.equal(computeBlindIndex(` ${CEDULA} `), computeBlindIndex(CEDULA));
  assert.equal(computeBlindIndex("Cliente@Example.COM"), computeBlindIndex("cliente@example.com"));
});

test("computeBlindIndex NO revela el valor original", () => {
  const indice = computeBlindIndex(CEDULA);
  assert.ok(!indice.includes(CEDULA));
  assert.notEqual(indice, computeBlindIndex("1710034066"), "una cédula distinta da otro índice");
});

// ─────────────────────────────────────────────────────────────────────────────
// El borde de lectura
// ─────────────────────────────────────────────────────────────────────────────

test("decryptClienteRow descifra los tres campos PII y conserva el resto", () => {
  const fila = {
    id: "11111111-1111-1111-1111-111111111111",
    nombres: "Cliente de Prueba",
    saldo_cache: 1500,
    identificacion: encryptField(CEDULA),
    email: encryptNullableField("cliente@example.com"),
    telefono: encryptNullableField("0987654321"),
  };

  const claro = decryptClienteRow(fila);
  assert.equal(claro.identificacion, CEDULA);
  assert.equal(claro.email, "cliente@example.com");
  assert.equal(claro.telefono, "0987654321");
  assert.equal(claro.saldo_cache, 1500, "las columnas no-PII pasan intactas");
  assert.equal(claro.nombres, "Cliente de Prueba");
});

test("decryptClienteRow tolera email y teléfono nulos", () => {
  const claro = decryptClienteRow({
    identificacion: encryptField(CEDULA),
    email: null,
    telefono: null,
  });
  assert.equal(claro.identificacion, CEDULA);
  assert.equal(claro.email, null);
  assert.equal(claro.telefono, null);
});

test("decryptClienteRows descifra la lista entera y respeta el orden", () => {
  const filas = ["1710034065", "0926687856"].map((cedula) => ({
    identificacion: encryptField(cedula),
    email: null,
    telefono: null,
  }));

  assert.deepEqual(
    decryptClienteRows(filas).map((f) => f.identificacion),
    ["1710034065", "0926687856"]
  );
  assert.deepEqual(decryptClienteRows([]), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Enmascarado del destino del OTP
// ─────────────────────────────────────────────────────────────────────────────

test("maskEmail deja reconocible el correo sin permitir reconstruirlo", () => {
  const enmascarado = maskEmail("cliente.prueba@example.com");
  assert.equal(enmascarado, "cl************@example.com");
  assert.ok(!enmascarado.includes("prueba"));
});

test("maskEmail no se queda corto con usuarios de 1 o 2 caracteres", () => {
  // Con `repeat(user.length - 2)` a secas, "a@b.com" daría "a@b.com" sin
  // enmascarar nada (y un `repeat(-1)` reventaría). El mínimo de 2 lo evita.
  assert.equal(maskEmail("a@b.com"), "a**@b.com");
  assert.equal(maskEmail("ab@b.com"), "ab**@b.com");
});

test("maskEmail devuelve *** ante algo que no es un correo", () => {
  assert.equal(maskEmail("sin-arroba"), "***");
  assert.equal(maskEmail(""), "***");
  assert.equal(maskEmail("@solodominio.com"), "***", "usuario vacío no deja nada que mostrar");
});
