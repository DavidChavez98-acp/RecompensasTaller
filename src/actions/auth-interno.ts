/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Sesión del PERSONAL INTERNO (panel del taller). Adaptado de `auth.ts` del
 * proyecto "solicitud credito".
 *
 * Separación estricta frente a la sesión del cliente (`auth-cliente.ts`):
 * secreto distinto (ADMIN_SECRET vs CLIENTE_SESSION_SECRET), cookie distinta y
 * claim `aud` distinto. Un token de cliente no debe poder tocar /interno ni por
 * accidente, y verificar el `aud` es lo que lo garantiza aunque alguien
 * confunda los secretos en el futuro.
 *
 * NO se replicó el "acceso mock" de desarrollo del proyecto hermano: concede
 * rol Admin sin contraseña y aquí protege un pasivo contable.
 */

"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeClientIp } from "@/lib/utils";
import {
  AUD_INTERNO,
  COOKIE_SESION_INTERNA,
  SESION_INTERNA_HORAS,
} from "@/lib/constants";
import type { RolInterno } from "@/lib/authz";

const SESSION_DURATION_MS = SESION_INTERNA_HORAS * 60 * 60 * 1000;

/**
 * La clave se resuelve PEREZOSAMENTE, no al importar el módulo: `next build`
 * recolecta datos de página importando cada ruta, y hacerlo fallar ahí obliga
 * a tener secretos de producción presentes solo para compilar.
 *
 * La exigencia en producción sigue siendo dura — solo se evalúa cuando se va a
 * firmar o verificar de verdad. Firmar un JWT con una clave conocida
 * permitiría falsificar sesiones de Admin, y un Admin falso puede acreditar
 * puntos ilimitados.
 */
let claveCodificada: Uint8Array | null = null;

function getClave(): Uint8Array {
  if (claveCodificada) return claveCodificada;

  const secretKey = process.env.ADMIN_SECRET;
  if (!secretKey && process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SECRET debe estar configurado en producción.");
  }
  if (!secretKey) {
    console.warn("ADVERTENCIA: ADMIN_SECRET no está definido; usando clave de desarrollo insegura.");
  }
  claveCodificada = new TextEncoder().encode(secretKey || "default_local_dev_key_INSECURE");
  return claveCodificada;
}

export type SesionInterna = {
  id: string;
  email: string | null;
  nombre: string;
  role: RolInterno;
  sucursal_id: string | null;
  expiresAt: Date;
};

async function firmarSesion(payload: SesionInterna): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(AUD_INTERNO)
    .setExpirationTime(`${SESION_INTERNA_HORAS}h`)
    .sign(getClave());
}

async function verificarSesion(token: string | undefined = ""): Promise<SesionInterna | null> {
  try {
    const { payload } = await jwtVerify(token, getClave(), {
      algorithms: ["HS256"],
      audience: AUD_INTERNO,
    });
    return payload as unknown as SesionInterna;
  } catch {
    return null;
  }
}

export async function login(
  email: string,
  pass: string
): Promise<{ success: boolean; error?: string; role?: RolInterno }> {
  // Rate limiting contra fuerza bruta: por IP y por cuenta.
  try {
    const h = await headers();
    const ip = normalizeClientIp(h.get("x-forwarded-for"));
    const ipLimit = checkRateLimit(`login:ip:${ip}`, { limit: 10, windowMs: 5 * 60 * 1000 });
    if (ipLimit.limited) {
      return { success: false, error: `Demasiados intentos. Intente de nuevo en ${ipLimit.resetSeconds} segundos.` };
    }
    const emailKey = (email || "").toLowerCase().trim();
    const emailLimit = checkRateLimit(`login:email:${emailKey}`, { limit: 5, windowMs: 15 * 60 * 1000 });
    if (emailLimit.limited) {
      return { success: false, error: `Demasiados intentos para esta cuenta. Intente de nuevo en ${emailLimit.resetSeconds} segundos.` };
    }
  } catch {
    // Si los headers no están disponibles, no bloquear el login por un fallo
    // del rate limiter.
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email.trim().toLowerCase()),
    });

    // Mismo mensaje para "no existe" y "contraseña mala": no confirmar qué
    // correos son de empleados.
    if (!user) {
      return { success: false, error: "Credenciales inválidas" };
    }

    if (!user.activo) {
      return { success: false, error: "Credenciales inválidas" };
    }

    // Nunca autenticar sobre una cuenta sin contraseña configurada. El
    // aprovisionamiento se hace por seed o invitación, no en el primer login.
    if (!user.password_hash) {
      return { success: false, error: "La cuenta no tiene contraseña configurada. Contacte al administrador." };
    }

    const isValid = await bcrypt.compare(pass, user.password_hash);
    if (!isValid) {
      return { success: false, error: "Credenciales inválidas" };
    }

    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const token = await firmarSesion({
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      role: user.role,
      sucursal_id: user.sucursal_id ?? null,
      expiresAt,
    });

    const cookieStore = await cookies();
    cookieStore.set(COOKIE_SESION_INTERNA, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      expires: expiresAt,
      sameSite: "lax",
      path: "/",
    });

    await db.update(users).set({ ultimo_acceso: new Date() }).where(eq(users.id, user.id));

    return { success: true, role: user.role };
  } catch (error) {
    console.error("Login interno:", (error as Error)?.message);
    return { success: false, error: "Error en el servidor de autenticación" };
  }
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_SESION_INTERNA);
  return { success: true };
}

// Lectura del usuario deduplicada por request (cache de React) para no
// multiplicar consultas a Postgres en cada getSesionInterna — el free tier de
// Neon se agota por N+1, no por una consulta cara suelta.
const buscarUsuarioDeSesion = cache(async (id: string) => {
  return db.query.users.findFirst({ where: eq(users.id, id) });
});

export async function getSesionInterna(): Promise<SesionInterna | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_SESION_INTERNA)?.value;
  if (!token) return null;

  const payload = await verificarSesion(token);
  if (!payload) return null;

  // Revocación: el usuario debe seguir existiendo y estar activo. Dar de baja
  // a un empleado invalida sus sesiones vivas de inmediato.
  try {
    const user = await buscarUsuarioDeSesion(payload.id);
    if (!user || user.activo === false) return null;
    // El rol y la sucursal se releen de la BD en vez de confiar en el JWT: si
    // el Admin degrada a alguien de Jefe a Asesor, el cambio surte efecto sin
    // esperar a que expire su cookie.
    return {
      ...payload,
      role: user.role,
      sucursal_id: user.sucursal_id ?? null,
      nombre: user.nombre,
      email: user.email,
    };
  } catch {
    // Fallo transitorio de BD: no cerrar la sesión por ello.
    return payload;
  }
}

/*
 * OJO: no reintroduzcas aquí `createPasswordSetupToken` /
 * `verifyPasswordSetupToken`.
 *
 * Vivieron un rato como export de este archivo y eso los convertía en
 * endpoint público: toda función exportada desde un módulo "use server" es
 * invocable desde el navegador con cualquier argumento. Cualquiera podía
 * llamar `createPasswordSetupToken("cualquier-uuid")` sin sesión y recibir un
 * JWT válido 48h para tomar esa cuenta.
 *
 * Viven en `src/lib/password-setup.server.ts` (con `server-only`), y solo
 * deben invocarse desde una Server Action que ya comprobó
 * `puedeGestionarUsuarios(sesion)`.
 */
