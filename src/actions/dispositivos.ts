/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Aprovisionamiento del dispositivo que genera el código QR del cliente.
 *
 * El secreto HMAC se entrega al navegador UNA sola vez, al crearlo, y allí vive
 * en localStorage. En la base queda cifrado con AES-256-GCM, así que un volcado
 * de Neon sin PII_ENCRYPTION_KEY no permite forjar códigos de nadie.
 *
 * El secreto NUNCA es irrecuperable: si iOS desaloja el almacenamiento (pasa, y
 * borrar el icono de la pantalla de inicio borra el contenedor entero), el
 * cliente simplemente aprovisiona otro dispositivo con su sesión. Si también
 * perdió la cookie, entra con su código por correo. Es un requisito de diseño,
 * no un detalle de implementación.
 */

"use server";

import crypto from "crypto";
import { db } from "@/db";
import { clienteDispositivos } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { getSesionCliente } from "./auth-cliente";
import { encryptField } from "@/lib/pii-crypto";
import { bytesABase64Url } from "@/lib/qr-token";

/** 32 bytes: el tamaño de bloque de SHA-256. Más no aporta seguridad al HMAC. */
const SECRETO_BYTES = 32;

export type DispositivoAprovisionado = {
  dispositivoId: string;
  /** base64url. El navegador lo guarda; el servidor no lo vuelve a enviar. */
  secreto: string;
  algoritmo: string;
};

/** Etiqueta legible para que el cliente reconozca sus dispositivos en /cuenta. */
function describirDispositivo(userAgent: string | null): string {
  if (!userAgent) return "Dispositivo desconocido";

  const sistema = /iPhone|iPad|iPod/i.test(userAgent)
    ? "iPhone"
    : /Android/i.test(userAgent)
      ? "Android"
      : /Macintosh/i.test(userAgent)
        ? "Mac"
        : /Windows/i.test(userAgent)
          ? "Windows"
          : "Otro";

  // El orden importa: Chrome en iOS also dice "Safari", y Edge dice "Chrome".
  const navegador = /Edg\//i.test(userAgent)
    ? "Edge"
    : /CriOS|Chrome/i.test(userAgent)
      ? "Chrome"
      : /Firefox|FxiOS/i.test(userAgent)
        ? "Firefox"
        : /Safari/i.test(userAgent)
          ? "Safari"
          : "Navegador";

  return `${sistema} · ${navegador}`;
}

export async function aprovisionarDispositivo(): Promise<
  { success: true; dispositivo: DispositivoAprovisionado } | { success: false; error: string }
> {
  const sesion = await getSesionCliente();
  if (!sesion) return { success: false, error: "Tu sesión venció. Vuelve a entrar." };

  let userAgent: string | null = null;
  try {
    const h = await headers();
    userAgent = h.get("user-agent");
  } catch {
    // etiqueta genérica
  }

  const secretoBytes = new Uint8Array(crypto.randomBytes(SECRETO_BYTES));
  const secreto = bytesABase64Url(secretoBytes);

  const [creado] = await db
    .insert(clienteDispositivos)
    .values({
      cliente_id: sesion.clienteId,
      secreto: encryptField(secreto),
      algoritmo: "hmac-sha256",
      etiqueta: describirDispositivo(userAgent),
      ultima_actividad: new Date(),
    })
    .returning({ id: clienteDispositivos.id });

  if (!creado) return { success: false, error: "No pudimos preparar tu código." };

  return {
    success: true,
    dispositivo: { dispositivoId: creado.id, secreto, algoritmo: "hmac-sha256" },
  };
}

export type DispositivoListado = {
  id: string;
  etiqueta: string | null;
  ultimaActividad: Date | null;
  fechaCreacion: Date;
};

export async function listarDispositivos(): Promise<DispositivoListado[]> {
  const sesion = await getSesionCliente();
  if (!sesion) return [];

  return db
    .select({
      id: clienteDispositivos.id,
      etiqueta: clienteDispositivos.etiqueta,
      ultimaActividad: clienteDispositivos.ultima_actividad,
      fechaCreacion: clienteDispositivos.fecha_creacion,
    })
    .from(clienteDispositivos)
    .where(
      and(
        eq(clienteDispositivos.cliente_id, sesion.clienteId),
        isNull(clienteDispositivos.revocado_en)
      )
    )
    .orderBy(desc(clienteDispositivos.fecha_creacion));
}

export async function revocarDispositivo(
  dispositivoId: string
): Promise<{ success: boolean; error?: string }> {
  const sesion = await getSesionCliente();
  if (!sesion) return { success: false, error: "Tu sesión venció." };

  // El filtro por cliente_id va en el WHERE, no en una comprobación previa:
  // un dispositivo de otro cliente simplemente no existe para esta consulta.
  const revocados = await db
    .update(clienteDispositivos)
    .set({ revocado_en: new Date() })
    .where(
      and(
        eq(clienteDispositivos.id, dispositivoId),
        eq(clienteDispositivos.cliente_id, sesion.clienteId),
        isNull(clienteDispositivos.revocado_en)
      )
    )
    .returning({ id: clienteDispositivos.id });

  if (revocados.length === 0) {
    return { success: false, error: "Ese dispositivo ya no está activo." };
  }
  return { success: true };
}

/*
 * OJO: no añadas aquí un `obtenerSecretoDispositivo`.
 *
 * TODA función exportada desde un archivo "use server" es una Server Action
 * invocable desde el navegador con cualquier argumento. Exportar el descifrado
 * del secreto desde aquí permitiría a cualquiera pedir el secreto de un
 * dispositivo ajeno y forjar sus códigos QR.
 *
 * Esa función vive en `src/lib/qr-token.server.ts`, que es un módulo normal:
 * se puede importar desde el servidor, pero no se expone como endpoint.
 */
