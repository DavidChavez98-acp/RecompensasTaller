/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Autoservicio LOPDP del cliente: exportar sus datos y eliminar su cuenta.
 * Todo gateado con getSesionCliente() — sin parámetros de identidad, todo sale
 * de la sesión, para que nadie pueda pedir ni borrar la cuenta de otro.
 *
 * `anonimizarMiCuenta()` NO borra al cliente: el ledger de puntos y el de
 * canjes son registro contable (ver AGENTS.md y politica-privacidad/page.tsx)
 * y se quedan. Lo único que desaparece es lo que identifica a la persona.
 */

"use server";

import { db } from "@/db";
import { canjes, clienteDispositivos, clientes, sesionesCliente, vehiculos } from "@/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { cerrarSesionCliente, getSesionCliente } from "./auth-cliente";
import { listarMisMovimientos, type MovimientoCliente } from "./puntos";
import { listarMisCanjes, type CanjeCliente } from "./canjes";
import { listarDispositivos, type DispositivoListado } from "./dispositivos";
import { decryptField, decryptNullableField, encryptField } from "@/lib/pii-crypto";
import { sendAccountDeletionConfirmation } from "@/lib/mail";

// ─────────────────────────────────────────────────────────────────────────────
// Exportar mis datos
// ─────────────────────────────────────────────────────────────────────────────

type VehiculoExportado = {
  id: string;
  chasis: string;
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  color: string | null;
};

/**
 * No hay una función self-service de vehículos hoy: `src/actions/vehiculos.ts`
 * es todo `getSesionInterna()`, para el personal del taller. Esta consulta
 * vive AQUÍ, sin exportarla, para no tocar ese archivo por una sola pantalla.
 */
async function misVehiculos(clienteId: string): Promise<VehiculoExportado[]> {
  return db
    .select({
      id: vehiculos.id,
      chasis: vehiculos.chasis,
      placa: vehiculos.placa,
      marca: vehiculos.marca,
      modelo: vehiculos.modelo,
      anio: vehiculos.anio,
      color: vehiculos.color,
    })
    .from(vehiculos)
    .where(and(eq(vehiculos.cliente_id, clienteId), eq(vehiculos.activo, true)))
    .orderBy(desc(vehiculos.fecha_creacion));
}

export type ExportacionCliente = {
  generadoEn: string;
  perfil: {
    id: string;
    nombres: string;
    identificacion: string;
    email: string | null;
    telefono: string | null;
    consentimiento: {
      aceptado: boolean;
      version: string | null;
      fecha: Date | null;
      ip: string | null;
      userAgent: string | null;
    };
  };
  vehiculos: VehiculoExportado[];
  movimientos: MovimientoCliente[];
  canjes: CanjeCliente[];
  // El campo `secreto` NUNCA sale de aquí: DispositivoListado ya lo excluye
  // por diseño (ver src/actions/dispositivos.ts).
  dispositivos: DispositivoListado[];
};

export async function exportarMisDatos(): Promise<
  { ok: true; datos: ExportacionCliente } | { ok: false; error: string }
> {
  const sesion = await getSesionCliente();
  if (!sesion) return { ok: false, error: "Tu sesión venció. Vuelve a entrar." };

  const [fila] = await db
    .select({
      id: clientes.id,
      nombres: clientes.nombres,
      identificacion: clientes.identificacion,
      email: clientes.email,
      telefono: clientes.telefono,
      consentimientoAceptado: clientes.consentimiento_aceptado,
      politicaVersion: clientes.politica_version,
      consentimientoEn: clientes.consentimiento_en,
      consentimientoIp: clientes.consentimiento_ip,
      consentimientoUserAgent: clientes.consentimiento_user_agent,
    })
    .from(clientes)
    .where(eq(clientes.id, sesion.clienteId))
    .limit(1);

  if (!fila) return { ok: false, error: "No pudimos encontrar tu cuenta." };

  // Límite alto y explícito: la exportación tiene que ser completa, no la
  // vista paginada de 50 que usa la pantalla de movimientos.
  const [movimientos, misCanjes, dispositivos, vehiculosCliente] = await Promise.all([
    listarMisMovimientos(100000),
    listarMisCanjes(),
    listarDispositivos(),
    misVehiculos(sesion.clienteId),
  ]);

  return {
    ok: true,
    datos: {
      generadoEn: new Date().toISOString(),
      perfil: {
        id: fila.id,
        nombres: fila.nombres,
        identificacion: decryptField(fila.identificacion),
        email: decryptNullableField(fila.email),
        telefono: decryptNullableField(fila.telefono),
        consentimiento: {
          aceptado: fila.consentimientoAceptado,
          version: fila.politicaVersion,
          fecha: fila.consentimientoEn,
          ip: fila.consentimientoIp,
          userAgent: fila.consentimientoUserAgent,
        },
      },
      vehiculos: vehiculosCliente,
      movimientos,
      canjes: misCanjes,
      dispositivos,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Eliminar (anonimizar) mi cuenta
// ─────────────────────────────────────────────────────────────────────────────

const ESTADOS_CANJE_BLOQUEANTES = ["solicitado", "aprobado"] as const;

export async function anonimizarMiCuenta(): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionCliente();
  if (!sesion) return { ok: false, error: "Tu sesión venció. Vuelve a entrar." };

  // Antes de tocar nada: un canje en curso tiene puntos ya debitados o stock
  // ya reservado. Anonimizar debajo de eso dejaría un canje huérfano que nadie
  // puede resolver (el cliente ya no podría entrar a cancelarlo).
  const pendientes = await db
    .select({ id: canjes.id })
    .from(canjes)
    .where(
      and(eq(canjes.cliente_id, sesion.clienteId), inArray(canjes.estado, ESTADOS_CANJE_BLOQUEANTES))
    )
    .limit(1);

  if (pendientes.length > 0) {
    return {
      ok: false,
      error: "Tienes un canje pendiente de resolver antes de eliminar tu cuenta. Ve a Canjes para cancelarlo o retirarlo.",
    };
  }

  // El UPDATE de abajo pone el email a NULL: hay que leerlo ANTES para poder
  // avisarle a esa dirección que su cuenta se eliminó.
  const [antes] = await db
    .select({ email: clientes.email })
    .from(clientes)
    .where(eq(clientes.id, sesion.clienteId))
    .limit(1);
  const emailPrevio = decryptNullableField(antes?.email ?? null);

  const anonimizado = await db.transaction(async (tx) => {
    // Guardia de idempotencia: si dos pestañas piden la baja a la vez, la
    // segunda no encuentra fila (`anonimizado_en IS NULL` ya no se cumple).
    //
    // OJO: `identificacion_idx` NO se toca. `solicitarCodigoOtp` en
    // auth-cliente.ts depende de que ese índice ciego siga intacto para
    // reconocer una cuenta ya anonimizada y responder "Acércate al taller" en
    // vez de tratarla como cédula nueva.
    const filas = await tx
      .update(clientes)
      .set({
        nombres: "Cliente eliminado",
        identificacion: encryptField("ELIMINADO"),
        email: null,
        email_idx: null,
        telefono: null,
        activo: false,
        anonimizado_en: new Date(),
        fecha_actualizacion: new Date(),
      })
      .where(and(eq(clientes.id, sesion.clienteId), isNull(clientes.anonimizado_en)))
      .returning({ id: clientes.id });

    if (filas.length === 0) return false;

    // NO se tocan puntos_transacciones, canjes ni vehiculos: es el ledger
    // contable y el parque de vehículos del taller, no datos de la persona.
    await tx
      .update(clienteDispositivos)
      .set({ revocado_en: new Date() })
      .where(
        and(eq(clienteDispositivos.cliente_id, sesion.clienteId), isNull(clienteDispositivos.revocado_en))
      );

    await tx
      .update(sesionesCliente)
      .set({ revocada_en: new Date() })
      .where(and(eq(sesionesCliente.cliente_id, sesion.clienteId), isNull(sesionesCliente.revocada_en)));

    return true;
  });

  if (!anonimizado) {
    return { ok: false, error: "Tu cuenta ya fue eliminada." };
  }

  // Fuera de la transacción, ya comprometida: borra la cookie de este
  // navegador con el mismo camino que "Cerrar sesión".
  await cerrarSesionCliente();

  if (emailPrevio) {
    // Best-effort: un correo que no sale no debe deshacer una anonimización
    // ya comprometida en la base.
    await sendAccountDeletionConfirmation({ to: emailPrevio, nombre: sesion.nombres }).catch((error) => {
      console.error("Confirmación de baja LOPDP:", (error as Error)?.message);
    });
  }

  return { ok: true };
}
