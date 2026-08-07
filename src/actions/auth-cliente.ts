/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Sesión del CLIENTE: cédula + código de un solo uso por correo. Sin contraseña.
 *
 * Separación estricta frente a la sesión del personal (`auth-interno.ts`):
 * secreto propio (CLIENTE_SESSION_SECRET), cookie propia y claim `aud` propio.
 * Un token de cliente no debe poder tocar /interno ni por accidente.
 */

"use server";

import { db } from "@/db";
import { clientes, otpCodigos, sesionesCliente, sucursales } from "@/db/schema";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeClientIp } from "@/lib/utils";
import { sendOtpCode } from "@/lib/mail";
import { generarCodigoOtp, hashearCodigo, verificarCodigo } from "@/lib/otp";
import {
  computeBlindIndex,
  decryptField,
  encryptField,
  encryptNullableField,
  maskEmail,
} from "@/lib/pii-crypto";
import {
  AUD_CLIENTE,
  COOKIE_SESION_CLIENTE,
  OTP_MAX_INTENTOS,
  OTP_MAX_SOLICITUDES,
  OTP_VENTANA_MINUTOS,
  OTP_VIGENCIA_MINUTOS,
  POLITICA_VERSION,
  SESION_CLIENTE_DIAS,
} from "@/lib/constants";
import {
  codigoOtpSchema,
  registroClienteSchema,
  solicitarOtpSchema,
  type RegistroClienteInput,
} from "@/lib/validations";

const COOKIE_FLUJO = "gp_acceso_flujo";
const FLUJO_PURPOSE = "otp-flow";
const FLUJO_VIGENCIA_MINUTOS = 15;

let claveCodificada: Uint8Array | null = null;

/** Perezosa por la misma razón que en auth-interno.ts: `next build` importa las rutas. */
function getClave(): Uint8Array {
  if (claveCodificada) return claveCodificada;

  const secreto = process.env.CLIENTE_SESSION_SECRET;
  if (!secreto && process.env.NODE_ENV === "production") {
    throw new Error("CLIENTE_SESSION_SECRET debe estar configurado en producción.");
  }
  if (!secreto) {
    console.warn("ADVERTENCIA: CLIENTE_SESSION_SECRET no está definido; usando clave de desarrollo insegura.");
  }
  claveCodificada = new TextEncoder().encode(secreto || "default_local_dev_cliente_key_INSECURE");
  return claveCodificada;
}

export type SesionCliente = {
  clienteId: string;
  nombres: string;
  saldo: number;
  verificado: boolean;
};

type ResultadoSolicitud =
  | { success: true; destinoMasked: string }
  | { success: false; requiereRegistro: true }
  | { success: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Cookie de flujo
//
// Lleva la cédula entre /acceso y /acceso/codigo. Va en una cookie firmada y
// NO en la URL: un parámetro de consulta con la cédula queda en el historial
// del navegador, en los logs del servidor y en el Referer hacia terceros.
// ─────────────────────────────────────────────────────────────────────────────

async function guardarFlujo(datos: { idx: string; clienteId: string | null; destinoMasked: string }) {
  const token = await new SignJWT({ ...datos, purpose: FLUJO_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${FLUJO_VIGENCIA_MINUTOS}m`)
    .sign(getClave());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_FLUJO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: FLUJO_VIGENCIA_MINUTOS * 60,
    sameSite: "lax",
    path: "/",
  });
}

async function leerFlujo(): Promise<{ idx: string; clienteId: string | null; destinoMasked: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_FLUJO)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getClave(), { algorithms: ["HS256"] });
    if (payload.purpose !== FLUJO_PURPOSE || typeof payload.idx !== "string") return null;
    return {
      idx: payload.idx,
      clienteId: (payload.clienteId as string | null) ?? null,
      destinoMasked: (payload.destinoMasked as string) ?? "",
    };
  } catch {
    return null;
  }
}

async function limpiarFlujo() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_FLUJO);
}

/** Estado del flujo para pintar /acceso/codigo sin volver a pedir la cédula. */
export async function getFlujoAcceso(): Promise<{ destinoMasked: string } | null> {
  const flujo = await leerFlujo();
  return flujo ? { destinoMasked: flujo.destinoMasked } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Solicitud del código
// ─────────────────────────────────────────────────────────────────────────────

export async function solicitarCodigoOtp(identificacion: string): Promise<ResultadoSolicitud> {
  const parsed = solicitarOtpSchema.safeParse({ identificacion });
  if (!parsed.success) {
    return { success: false, error: "Cédula o RUC inválido" };
  }
  const cedula = parsed.data.identificacion;
  const idx = computeBlindIndex(cedula);

  // ── Nivel 1: en memoria, por IP. Barato y corta ráfagas dentro de una misma
  //    instancia. NO es suficiente por sí solo (ver nivel 2).
  try {
    const h = await headers();
    const ip = normalizeClientIp(h.get("x-forwarded-for"));
    const limiteIp = checkRateLimit(`otp:ip:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
    if (limiteIp.limited) {
      return { success: false, error: `Demasiadas solicitudes. Intenta en ${limiteIp.resetSeconds} segundos.` };
    }
  } catch {
    // Sin headers disponibles no se bloquea: el nivel 2 sigue puesto.
  }

  // ── Nivel 2: persistente, contado en SQL. Este es el que de verdad manda.
  //    El limitador en memoria no sobrevive entre instancias serverless de
  //    Vercel: sin este conteo, pedir 200 códigos es cuestión de reintentar
  //    hasta caer en una instancia fría.
  const desde = new Date(Date.now() - OTP_VENTANA_MINUTOS * 60 * 1000);
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(otpCodigos)
    .where(and(eq(otpCodigos.identificacion_idx, idx), gte(otpCodigos.fecha_creacion, desde)));

  if (total >= OTP_MAX_SOLICITUDES) {
    return {
      success: false,
      error: `Ya pediste ${OTP_MAX_SOLICITUDES} códigos. Espera ${OTP_VENTANA_MINUTOS} minutos antes de volver a intentar.`,
    };
  }

  const cliente = await db.query.clientes.findFirst({
    where: eq(clientes.identificacion_idx, idx),
  });

  // Revela si una cédula está registrada. Es el precio de ofrecer auto-registro
  // sin pedir el correo a los que ya existen; el conteo persistente de arriba
  // (3 cada 15 min) hace inviable enumerar cédulas a escala.
  if (!cliente) {
    return { success: false, requiereRegistro: true };
  }

  if (!cliente.activo || cliente.anonimizado_en) {
    return { success: false, error: "Esta cuenta no está disponible. Acércate al taller." };
  }

  if (!cliente.email) {
    return { success: false, error: "Tu cuenta no tiene correo registrado. Acércate al taller para actualizarlo." };
  }

  const email = decryptField(cliente.email);
  const codigo = generarCodigoOtp();
  const destinoMasked = maskEmail(email);

  // Cerrar los códigos vivos anteriores: si el cliente pidió tres, solo el
  // último debe servir. Sin esto, un código viejo interceptado seguiría valiendo.
  await db
    .update(otpCodigos)
    .set({ consumido_en: new Date(), motivo_cierre: "reemplazado" })
    .where(and(eq(otpCodigos.identificacion_idx, idx), isNull(otpCodigos.consumido_en)));

  let ipSolicitante: string | null = null;
  try {
    const h = await headers();
    ipSolicitante = normalizeClientIp(h.get("x-forwarded-for"));
  } catch {
    // sin cabeceras, se guarda null
  }

  await db.insert(otpCodigos).values({
    identificacion_idx: idx,
    cliente_id: cliente.id,
    codigo_hash: await hashearCodigo(codigo),
    canal: "email",
    destino_masked: destinoMasked,
    expira_en: new Date(Date.now() + OTP_VIGENCIA_MINUTOS * 60 * 1000),
    ip_solicitante: ipSolicitante,
  });

  const envio = await sendOtpCode({
    to: email,
    codigo,
    minutosVigencia: OTP_VIGENCIA_MINUTOS,
  });

  if (!envio.success) {
    return { success: false, error: "No pudimos enviar el código. Intenta de nuevo en un momento." };
  }

  await guardarFlujo({ idx, clienteId: cliente.id, destinoMasked });
  return { success: true, destinoMasked };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificación del código
// ─────────────────────────────────────────────────────────────────────────────

export async function verificarCodigoOtp(
  codigo: string
): Promise<{ success: boolean; error?: string }> {
  const flujo = await leerFlujo();
  if (!flujo) {
    return { success: false, error: "La sesión de acceso venció. Pide un código nuevo." };
  }

  const parsed = codigoOtpSchema.safeParse(codigo);
  if (!parsed.success) {
    return { success: false, error: "El código son 6 dígitos." };
  }
  const codigoLimpio = parsed.data;

  // Límite de intentos por IP, además del contador por código de más abajo:
  // impide barrer el espacio de códigos rotando de cuenta.
  try {
    const h = await headers();
    const ip = normalizeClientIp(h.get("x-forwarded-for"));
    const limite = checkRateLimit(`otp-verify:ip:${ip}`, { limit: 20, windowMs: 15 * 60 * 1000 });
    if (limite.limited) {
      return { success: false, error: `Demasiados intentos. Espera ${limite.resetSeconds} segundos.` };
    }
  } catch {
    // el contador por código sigue puesto
  }

  const registro = await db.query.otpCodigos.findFirst({
    where: and(eq(otpCodigos.identificacion_idx, flujo.idx), isNull(otpCodigos.consumido_en)),
    orderBy: [desc(otpCodigos.fecha_creacion)],
  });

  if (!registro) {
    return { success: false, error: "No hay un código pendiente. Pide uno nuevo." };
  }

  if (registro.expira_en.getTime() < Date.now()) {
    await db
      .update(otpCodigos)
      .set({ consumido_en: new Date(), motivo_cierre: "expirado" })
      .where(eq(otpCodigos.id, registro.id));
    return { success: false, error: "El código venció. Pide uno nuevo." };
  }

  if (registro.intentos >= OTP_MAX_INTENTOS) {
    await db
      .update(otpCodigos)
      .set({ consumido_en: new Date(), motivo_cierre: "agotado" })
      .where(eq(otpCodigos.id, registro.id));
    return { success: false, error: "Agotaste los intentos de este código. Pide uno nuevo." };
  }

  const valido = await verificarCodigo(codigoLimpio, registro.codigo_hash);

  if (!valido) {
    const intentos = registro.intentos + 1;
    await db.update(otpCodigos).set({ intentos }).where(eq(otpCodigos.id, registro.id));
    const restantes = OTP_MAX_INTENTOS - intentos;
    return {
      success: false,
      error: restantes > 0 ? `Código incorrecto. Te quedan ${restantes} intentos.` : "Agotaste los intentos. Pide un código nuevo.",
    };
  }

  if (!registro.cliente_id) {
    return { success: false, error: "No pudimos identificar tu cuenta. Acércate al taller." };
  }

  await db
    .update(otpCodigos)
    .set({ consumido_en: new Date(), motivo_cierre: "usado" })
    .where(eq(otpCodigos.id, registro.id));

  await crearSesion(registro.cliente_id);
  await limpiarFlujo();

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro del cliente nuevo
// ─────────────────────────────────────────────────────────────────────────────

export async function registrarCliente(
  entrada: RegistroClienteInput
): Promise<{ success: boolean; error?: string; destinoMasked?: string }> {
  const parsed = registroClienteSchema.safeParse(entrada);
  if (!parsed.success) {
    const primero = parsed.error.issues[0];
    return { success: false, error: primero?.message ?? "Revisa los datos ingresados." };
  }
  const datos = parsed.data;

  try {
    const h = await headers();
    const ip = normalizeClientIp(h.get("x-forwarded-for"));
    const limite = checkRateLimit(`registro:ip:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
    if (limite.limited) {
      return { success: false, error: `Demasiados registros. Intenta en ${limite.resetSeconds} segundos.` };
    }
  } catch {
    // continuar
  }

  const idx = computeBlindIndex(datos.identificacion);

  const existente = await db.query.clientes.findFirst({
    where: eq(clientes.identificacion_idx, idx),
  });

  if (existente) {
    // No es un error del usuario: ya tiene cuenta, se le manda el código.
    return solicitarCodigoOtp(datos.identificacion).then((r) =>
      r.success ? { success: true, destinoMasked: r.destinoMasked } : { success: false, error: "Ya tienes una cuenta. Vuelve a la pantalla anterior e ingresa tu cédula." }
    );
  }

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = normalizeClientIp(h.get("x-forwarded-for"));
    userAgent = h.get("user-agent");
  } catch {
    // se guarda null
  }

  // Sucursal por defecto. En v1 hay una sola; dejarla puesta desde el registro
  // es lo que hace que encender multi-sucursal no necesite backfill.
  const [matriz] = await db.select({ id: sucursales.id }).from(sucursales).limit(1);

  const [creado] = await db
    .insert(clientes)
    .values({
      identificacion: encryptField(datos.identificacion),
      identificacion_idx: idx,
      nombres: datos.nombres,
      email: encryptField(datos.email),
      email_idx: computeBlindIndex(datos.email),
      telefono: encryptNullableField(datos.telefono || null),
      // Queda en falso hasta que un asesor coteje la cédula física en la
      // primera visita: el auto-registro prueba el correo, no la identidad.
      verificado: false,
      consentimiento_aceptado: true,
      politica_version: POLITICA_VERSION,
      consentimiento_ip: ip,
      consentimiento_user_agent: userAgent,
      consentimiento_en: new Date(),
      origen: "auto-registro",
      sucursal_id: matriz?.id ?? null,
    })
    .returning({ id: clientes.id });

  if (!creado) {
    return { success: false, error: "No pudimos crear tu cuenta. Intenta de nuevo." };
  }

  // El código de acceso también sirve para probar que el correo es suyo.
  const resultado = await solicitarCodigoOtp(datos.identificacion);
  if (!resultado.success) {
    return { success: false, error: "requiereRegistro" in resultado ? "No pudimos enviar el código." : resultado.error };
  }

  return { success: true, destinoMasked: resultado.destinoMasked };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sesión
// ─────────────────────────────────────────────────────────────────────────────

async function crearSesion(clienteId: string) {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = normalizeClientIp(h.get("x-forwarded-for"));
    userAgent = h.get("user-agent");
  } catch {
    // se guarda null
  }

  const [sesion] = await db
    .insert(sesionesCliente)
    .values({ cliente_id: clienteId, ip, user_agent: userAgent })
    .returning({ id: sesionesCliente.id });

  if (!sesion) throw new Error("No se pudo crear la sesión del cliente.");

  const expiraEn = new Date(Date.now() + SESION_CLIENTE_DIAS * 24 * 60 * 60 * 1000);

  // El JWT lleva solo identificadores opacos: ni cédula, ni nombre, ni saldo.
  // Una cookie filtrada no revela datos personales por sí sola.
  const token = await new SignJWT({ clienteId, sid: sesion.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(AUD_CLIENTE)
    .setExpirationTime(`${SESION_CLIENTE_DIAS}d`)
    .sign(getClave());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_SESION_CLIENTE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: expiraEn,
    sameSite: "lax",
    path: "/",
  });
}

// Deduplicado por request: el layout, la página y los componentes llaman a
// getSesionCliente() y esto lo convierte en una sola consulta.
const buscarClienteDeSesion = cache(async (clienteId: string, sid: string) => {
  const [fila] = await db
    .select({
      id: clientes.id,
      nombres: clientes.nombres,
      saldo_cache: clientes.saldo_cache,
      verificado: clientes.verificado,
      activo: clientes.activo,
      anonimizado_en: clientes.anonimizado_en,
      sesion_revocada: sesionesCliente.revocada_en,
    })
    .from(clientes)
    .innerJoin(sesionesCliente, eq(sesionesCliente.id, sid))
    .where(and(eq(clientes.id, clienteId), eq(sesionesCliente.cliente_id, clienteId)))
    .limit(1);

  return fila ?? null;
});

export async function getSesionCliente(): Promise<SesionCliente | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_SESION_CLIENTE)?.value;
  if (!token) return null;

  let clienteId: string;
  let sid: string;
  try {
    const { payload } = await jwtVerify(token, getClave(), {
      algorithms: ["HS256"],
      audience: AUD_CLIENTE,
    });
    if (typeof payload.clienteId !== "string" || typeof payload.sid !== "string") return null;
    clienteId = payload.clienteId;
    sid = payload.sid;
  } catch {
    return null;
  }

  const fila = await buscarClienteDeSesion(clienteId, sid);
  if (!fila) return null;
  // Revocación: cerrar sesión desde /cuenta o dar de baja al cliente invalida
  // la cookie de inmediato, sin esperar a que expiren los 180 días.
  if (fila.sesion_revocada || !fila.activo || fila.anonimizado_en) return null;

  return {
    clienteId: fila.id,
    nombres: fila.nombres,
    saldo: fila.saldo_cache,
    verificado: fila.verificado,
  };
}

export async function cerrarSesionCliente(): Promise<{ success: boolean }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_SESION_CLIENTE)?.value;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, getClave(), {
        algorithms: ["HS256"],
        audience: AUD_CLIENTE,
      });
      if (typeof payload.sid === "string") {
        await db
          .update(sesionesCliente)
          .set({ revocada_en: new Date() })
          .where(eq(sesionesCliente.id, payload.sid));
      }
    } catch {
      // token ilegible: basta con borrar la cookie
    }
  }

  cookieStore.delete(COOKIE_SESION_CLIENTE);
  return { success: true };
}
