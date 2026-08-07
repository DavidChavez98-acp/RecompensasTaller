/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Cifrado de confidencialidad para PII en reposo (cédula, email, teléfono del
 * cliente, y el secreto HMAC de cada dispositivo). Evita que los datos queden
 * legibles si alguien obtiene acceso de solo lectura a la base (dump, backup,
 * fuga de credenciales de Neon). AES-256-GCM nativo de Node: sin dependencias
 * nuevas ni servicios de pago.
 *
 * El secreto del dispositivo es el caso más sensible: con él en claro se
 * podrían forjar códigos QR válidos de cualquier cliente. Cifrado, un volcado
 * de la base sin PII_ENCRYPTION_KEY no alcanza para falsificar nada.
 */

import crypto from "crypto";

const ENC_PREFIX = "v1:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits: tamaño recomendado de IV para GCM.

function resolveEncryptionKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw && process.env.NODE_ENV === "production") {
    throw new Error("PII_ENCRYPTION_KEY debe estar configurado en producción.");
  }
  if (!raw) {
    console.warn("ADVERTENCIA: PII_ENCRYPTION_KEY no está definido; usando clave de desarrollo insegura.");
  }
  // SHA-256 normaliza cualquier secreto de entrada (p. ej. la salida de
  // `openssl rand -base64 32`) a exactamente los 32 bytes que exige
  // AES-256-GCM, sin depender de que el operador use una codificación exacta.
  return crypto.createHash("sha256").update(raw || "default_local_dev_pii_key_INSECURE").digest();
}

function resolveIndexKey(): string {
  const raw = process.env.PII_INDEX_KEY;
  if (!raw && process.env.NODE_ENV === "production") {
    throw new Error("PII_INDEX_KEY debe estar configurado en producción.");
  }
  if (!raw) {
    console.warn("ADVERTENCIA: PII_INDEX_KEY no está definido; usando clave de desarrollo insegura.");
  }
  return raw || "default_local_dev_index_key_INSECURE";
}

/** Cifra un valor en texto plano. Formato: v1:<iv>:<authTag>:<ciphertext> (base64url). */
export function encryptField(plaintext: string): string {
  const key = resolveEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function encryptNullableField(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return encryptField(value);
}

/**
 * Desencripta un valor. Si no tiene el prefijo `v1:` se asume texto plano
 * legado y se devuelve tal cual. Si el descifrado falla (clave rotada, dato
 * corrupto), se devuelve el valor de entrada sin reventar: es preferible
 * mostrar el ciphertext en el panel a tumbar toda la vista.
 */
export function decryptField(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value;

  const parts = value.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) return value;
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];

  try {
    const key = resolveEncryptionKey();
    const iv = Buffer.from(ivB64, "base64url");
    const authTag = Buffer.from(tagB64, "base64url");
    const ciphertext = Buffer.from(dataB64, "base64url");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (error) {
    console.error("Error al desencriptar campo PII:", (error as Error)?.message);
    return value;
  }
}

/** Variante para columnas nullable (email, teléfono). */
export function decryptNullableField(value: string | null): string | null {
  if (value == null) return value;
  return decryptField(value);
}

/**
 * Desencripta el secreto HMAC de un dispositivo. Separado de `decryptField`
 * a propósito: si el descifrado falla aquí NO se puede devolver el ciphertext
 * como hace la variante permisiva, porque se generarían MACs válidos contra un
 * secreto equivocado y todos los QR de ese cliente dejarían de verificar en
 * silencio. Mejor fallar ruidoso y forzar el reaprovisionamiento del
 * dispositivo.
 */
export function decryptDeviceSecret(value: string): string {
  const plaintext = decryptField(value);
  if (plaintext === value && value.startsWith(ENC_PREFIX)) {
    throw new Error("No se pudo descifrar el secreto del dispositivo.");
  }
  return plaintext;
}

/**
 * Índice ciego determinístico (HMAC-SHA256) para poder seguir haciendo
 * búsquedas exactas por igualdad (`WHERE columna = ?`) sobre un campo cuyo
 * valor real se guarda cifrado con IV aleatorio.
 *
 * Lo necesitan la cédula (login por OTP, búsqueda del asesor, UNIQUE de
 * cliente) y el email (detectar duplicados sin descifrar la tabla entera).
 */
export function computeBlindIndex(value: string): string {
  const key = resolveIndexKey();
  return crypto.createHmac("sha256", key).update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Desencripta los campos PII de una fila de `clientes` leída de Postgres.
 * Se llama UNA vez, en el borde de lectura de la base (ver src/actions/
 * clientes.ts): todo consumidor aguas abajo recibe texto plano y no necesita
 * saber que existe cifrado. Si añades una consulta directa que esquive los
 * helpers de lectura, tienes que descifrar explícitamente ahí también.
 */
export function decryptClienteRow<
  T extends {
    identificacion: string;
    email: string | null;
    telefono: string | null;
  },
>(row: T): T {
  return {
    ...row,
    identificacion: decryptField(row.identificacion),
    email: decryptNullableField(row.email),
    telefono: decryptNullableField(row.telefono),
  };
}

export function decryptClienteRows<
  T extends {
    identificacion: string;
    email: string | null;
    telefono: string | null;
  },
>(rows: T[]): T[] {
  return rows.map(decryptClienteRow);
}

/** Enmascara un destino de OTP para mostrarlo en la UI sin revelarlo entero. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, user.length - 2))}@${domain}`;
}
