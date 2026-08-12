/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Token de un solo propósito para que un usuario interno recién creado defina
 * su contraseña por correo. Firmado con la misma clave que la sesión de
 * personal, pero con `purpose` propio: nunca se acepta como cookie de sesión
 * ni viceversa.
 *
 * NO lleva "use server": vivió un rato como export de `auth-interno.ts`, y eso
 * lo convertía en un endpoint público — cualquiera podía llamar
 * `createPasswordSetupToken("cualquier-uuid")` sin sesión y recibir un JWT
 * válido 48h para tomar esa cuenta. Hoy no hay nada que consuma el token
 * (el alta de personal por invitación es un hito futuro), pero la fábrica de
 * tokens ya estaba viva. Mismo patrón exacto que `obtenerSecretoDispositivo`
 * en `src/actions/dispositivos.ts` — ver ese comentario.
 */

import "server-only";

import { SignJWT, jwtVerify } from "jose";

const PASSWORD_SETUP_EXPIRATION = "48h";
const PASSWORD_SETUP_PURPOSE = "password-setup";

// Derivación de clave duplicada a propósito, no importada de auth-interno.ts:
// ese archivo lleva "use server", y Next exige que TODO export de un módulo
// así sea una función async invocable — no se puede colar un helper interno
// como `getClave` sin también exponerlo como endpoint. Mismo patrón que
// `getClaveTicket` en `src/actions/puntos.ts`.
let claveCodificada: Uint8Array | null = null;

function getClave(): Uint8Array {
  if (claveCodificada) return claveCodificada;
  const secreto = process.env.ADMIN_SECRET;
  if (!secreto && process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SECRET debe estar configurado en producción.");
  }
  claveCodificada = new TextEncoder().encode(secreto || "default_local_dev_key_INSECURE");
  return claveCodificada;
}

/**
 * Emitir el token es responsabilidad de quien crea o reinvita al usuario
 * (`puedeGestionarUsuarios(sesion)` comprobado ANTES de llamar esto), nunca de
 * un endpoint que reciba un `userId` suelto desde el navegador.
 */
export async function createPasswordSetupToken(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: PASSWORD_SETUP_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(PASSWORD_SETUP_EXPIRATION)
    .sign(getClave());
}

export async function verifyPasswordSetupToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getClave(), { algorithms: ["HS256"] });
    if (payload.purpose !== PASSWORD_SETUP_PURPOSE || typeof payload.userId !== "string") {
      return null;
    }
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
