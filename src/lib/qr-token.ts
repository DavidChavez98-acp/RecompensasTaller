/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Token del código QR que el cliente muestra al asesor.
 *
 * ── Qué es y qué NO es ──
 * El QR **identifica al cliente**; no es un cupón ni lleva valor dentro. No
 * contiene PII: una foto filtrada no revela cédula, nombre ni saldo, solo un
 * identificador opaco de dispositivo.
 *
 * ── Por qué TOTP-like HMAC y no un JWT del servidor ──
 * El teléfono del cliente puede estar sin datos en el mostrador del taller.
 * Un JWT firmado por el servidor, o un token de un solo uso guardado en la
 * base, exigen red para generarse. Este esquema se calcula con lo que el
 * teléfono ya tiene.
 *
 * Además el payload queda en ~56 caracteres, que da un QR versión 3-4: se lee
 * rápido con un teléfono barato, con la pantalla sucia y bajo luz fluorescente.
 * ECDSA (~150 caracteres) subiría a versión 7-8 y costaría segundos reales por
 * escaneo en el peor caso.
 *
 * El "riesgo" de que un volcado de la base permita forjar códigos se neutraliza
 * cifrando el secreto en reposo (ver `cliente_dispositivos.secreto`), sin
 * necesidad de criptografía asimétrica.
 *
 * ── Isomorfo a propósito ──
 * Usa WebCrypto (`crypto.subtle`), disponible igual en el navegador y en Node.
 * Una sola implementación para generar (cliente) y verificar (servidor)
 * elimina la clase de bugs donde las dos mitades divergen.
 */

import { QR_PASO_SEGUNDOS, QR_PREFIJO, QR_TOLERANCIA_PASOS } from "./constants";

/** Bytes del MAC que viajan en el token. 128 bits sobran para una ventana de 2 minutos. */
const MAC_BYTES = 16;
/** Alfabeto Crockford-base32: sin I, L, O ni U (confundibles al dictar). */
const ALFABETO_RESPALDO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LONGITUD_RESPALDO = 8;

// ─────────────────────────────────────────────────────────────────────────────
// Codificación
// ─────────────────────────────────────────────────────────────────────────────

export function bytesABase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlABytes(texto: string): Uint8Array {
  const base64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const relleno = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(relleno);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** UUID (36 chars) → 16 bytes → 22 caracteres base64url. Ahorra 14 caracteres del QR. */
export function uuidACompacto(uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) throw new Error(`UUID inválido: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytesABase64Url(bytes);
}

export function compactoAUuid(compacto: string): string {
  const bytes = base64UrlABytes(compacto);
  if (bytes.length !== 16) throw new Error("Identificador de dispositivo inválido");
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso temporal
// ─────────────────────────────────────────────────────────────────────────────

/** Paso TOTP actual. Cada paso dura QR_PASO_SEGUNDOS. */
export function pasoActual(ahoraMs: number = Date.now()): number {
  return Math.floor(ahoraMs / 1000 / QR_PASO_SEGUNDOS);
}

/** Milisegundos que faltan para que el código cambie. Alimenta la cuenta atrás de la UI. */
export function msHastaSiguientePaso(ahoraMs: number = Date.now()): number {
  const duracionMs = QR_PASO_SEGUNDOS * 1000;
  return duracionMs - (ahoraMs % duracionMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// HMAC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El `paso` entra en el mensaje firmado, no solo como dato suelto: si viajara
 * fuera de la firma, cualquiera podría reescribirlo y el MAC seguiría cuadrando
 * con otro instante.
 */
export function construirMensaje(dispositivoId: string, paso: number): string {
  return `${QR_PREFIJO}|${dispositivoId}|${paso}`;
}

async function importarClave(secreto: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    secreto as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function calcularMac(secreto: Uint8Array, mensaje: string): Promise<Uint8Array> {
  const clave = await importarClave(secreto);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(mensaje));
  return new Uint8Array(firma).slice(0, MAC_BYTES);
}

// ─────────────────────────────────────────────────────────────────────────────
// Construcción y análisis del token
// ─────────────────────────────────────────────────────────────────────────────

export type TokenQr = {
  /** Lo que se pinta dentro del QR. ~56 caracteres. */
  token: string;
  /** 8 caracteres tecleables, para cuando la cámara falla. */
  codigoRespaldo: string;
  paso: number;
};

export async function construirToken(
  dispositivoId: string,
  secreto: Uint8Array,
  paso: number = pasoActual()
): Promise<TokenQr> {
  const mac = await calcularMac(secreto, construirMensaje(dispositivoId, paso));
  const token = [
    QR_PREFIJO,
    uuidACompacto(dispositivoId),
    paso.toString(36),
    bytesABase64Url(mac),
  ].join(".");

  return { token, codigoRespaldo: derivarCodigoRespaldo(mac), paso };
}

export type TokenAnalizado = {
  dispositivoId: string;
  paso: number;
  mac: Uint8Array;
};

/**
 * Acepta tanto el token pelado como una URL que lo contenga (`https://…/q/GP1…`),
 * por si alguien lo lee con la cámara nativa del sistema en vez de la app. Lo
 * que se imprime en el QR es siempre el token pelado: menos bytes, QR más chico.
 */
export function analizarToken(entrada: string): TokenAnalizado | null {
  let texto = entrada.trim();

  const posicion = texto.lastIndexOf(`${QR_PREFIJO}.`);
  if (posicion > 0) texto = texto.slice(posicion);

  const partes = texto.split(".");
  if (partes.length !== 4) return null;

  const [prefijo, dispositivoCompacto, pasoBase36, macBase64] = partes as [string, string, string, string];
  if (prefijo !== QR_PREFIJO) return null;

  const paso = parseInt(pasoBase36, 36);
  if (!Number.isSafeInteger(paso) || paso <= 0) return null;

  try {
    const mac = base64UrlABytes(macBase64);
    if (mac.length !== MAC_BYTES) return null;
    return { dispositivoId: compactoAUuid(dispositivoCompacto), paso, mac };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificación
// ─────────────────────────────────────────────────────────────────────────────

/** Comparación en tiempo constante: un `===` sobre el MAC filtra información por temporización. */
export function sonIguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= (a[i] as number) ^ (b[i] as number);
  return diferencia === 0;
}

export type ResultadoVerificacion =
  | { valido: true; dispositivoId: string; paso: number }
  /**
   * `desfase` distingue "reloj del teléfono corrido" de "código inválido". Sin
   * esa distinción el asesor solo vería un error genérico y no sabría que la
   * solución es poner el teléfono del cliente en hora automática.
   */
  | { valido: false; motivo: "formato" | "firma" | "fuera_de_ventana"; desfasePasos?: number };

export async function verificarToken(
  entrada: string,
  secreto: Uint8Array,
  ahoraMs: number = Date.now()
): Promise<ResultadoVerificacion> {
  const analizado = analizarToken(entrada);
  if (!analizado) return { valido: false, motivo: "formato" };

  const esperado = await calcularMac(
    secreto,
    construirMensaje(analizado.dispositivoId, analizado.paso)
  );

  // La firma se comprueba ANTES que la ventana temporal: así un token con firma
  // falsa nunca produce un mensaje de "reloj desfasado" que le diría al atacante
  // que su firma era correcta.
  if (!sonIguales(esperado, analizado.mac)) {
    return { valido: false, motivo: "firma" };
  }

  const desfase = analizado.paso - pasoActual(ahoraMs);
  if (Math.abs(desfase) > QR_TOLERANCIA_PASOS) {
    return { valido: false, motivo: "fuera_de_ventana", desfasePasos: desfase };
  }

  return { valido: true, dispositivoId: analizado.dispositivoId, paso: analizado.paso };
}

// ─────────────────────────────────────────────────────────────────────────────
// Código de respaldo tecleable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 40 bits del mismo MAC en Crockford-base32. Cuando la cámara no funciona
 * (pantalla rota, permiso denegado en iOS, lente sucia), el asesor teclea estos
 * 8 caracteres y entra por exactamente la misma verificación.
 *
 * 40 bits en una ventana de 2 minutos, con rate limit, sobran: adivinarlo por
 * fuerza bruta exigiría ~10^12 intentos.
 */
export function derivarCodigoRespaldo(mac: Uint8Array): string {
  let salida = "";
  let acumulador = 0;
  let bits = 0;

  for (let i = 0; i < 5; i++) {
    acumulador = (acumulador << 8) | (mac[i] as number);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      salida += ALFABETO_RESPALDO[(acumulador >>> bits) & 0b11111];
    }
  }

  return salida.slice(0, LONGITUD_RESPALDO);
}

/** Normaliza lo que teclea el asesor: minúsculas y los confundibles clásicos. */
export function normalizarCodigoRespaldo(entrada: string): string {
  return entrada
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
}
