/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Generación y verificación del código de un solo uso con el que entra el
 * cliente. Sin contraseña: el cliente del taller viene ~3 veces al año y
 * cualquier contraseña que elija la habrá olvidado para la siguiente visita.
 */

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { OTP_LONGITUD } from "./constants";

/**
 * Código numérico de 6 dígitos con `randomInt`, no con `Math.random()`.
 * `Math.random()` es predecible desde una sola muestra observada, y aquí el
 * código es la única credencial que protege la cuenta.
 *
 * Se usan dígitos y no base32 a propósito: el cliente lo teclea desde el
 * teclado numérico del teléfono, muchas veces mayor de edad y con el correo
 * abierto en otra app.
 */
export function generarCodigoOtp(): string {
  const maximo = 10 ** OTP_LONGITUD;
  return String(crypto.randomInt(0, maximo)).padStart(OTP_LONGITUD, "0");
}

/**
 * Coste 12, igual que las contraseñas del personal. Es deliberadamente lento
 * (~200ms): un atacante que robe la base no puede probar el espacio de 10^6
 * códigos a ciegas, y el retardo también amortigua el ataque en línea aunque
 * fallara el rate limit.
 */
export function hashearCodigo(codigo: string): Promise<string> {
  return bcrypt.hash(codigo, 12);
}

export function verificarCodigo(codigo: string, hash: string): Promise<boolean> {
  return bcrypt.compare(codigo, hash);
}

/**
 * Código de entrega de un canje: 6 caracteres Crockford-base32, sin I/L/O/U
 * para que nadie confunda 1 con I ni 0 con O dictándolo en el mostrador.
 * Se declara aquí porque comparte la fuente de aleatoriedad; se usa en el
 * hito 5.
 */
export function generarCodigoEntrega(): string {
  const alfabeto = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let salida = "";
  for (let i = 0; i < 6; i++) {
    salida += alfabeto[crypto.randomInt(0, alfabeto.length)];
  }
  return salida;
}
