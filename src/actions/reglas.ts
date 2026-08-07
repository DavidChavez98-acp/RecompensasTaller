/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * La economía del programa: cuántos puntos vale un dólar, y cuánto pesa cada
 * tipo de servicio.
 *
 * ── Las reglas se VERSIONAN, no se editan ──
 * `reglas_puntos` nunca recibe un UPDATE. Cambiar la regla es insertar una fila
 * nueva y cerrar la anterior con `vigente_hasta`. El ledger guarda `regla_id`,
 * así que una acreditación de marzo sigue siendo explicable en diciembre aunque
 * la regla haya cambiado tres veces: se puede reconstruir exactamente con qué
 * números se calculó.
 *
 * Con un UPDATE, esa pregunta —"¿por qué a este cliente le dieron 15 puntos y
 * hoy le darían 20?"— no tendría respuesta.
 *
 * ── Los multiplicadores SÍ se editan en sitio ──
 * `servicios_tipo.multiplicador` sí se actualiza, porque el ledger guarda
 * `multiplicador_aplicado` como copia en el momento de la acreditación. La
 * trazabilidad ya está garantizada por el snapshot, y versionar cada servicio
 * multiplicaría filas sin aportar nada.
 */

"use server";

import { db } from "@/db";
import { reglasPuntos, serviciosTipo, users } from "@/db/schema";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSesionInterna } from "./auth-interno";
import { puedeGestionarReglas } from "@/lib/authz";
import { reglaPuntosSchema, type ReglaPuntosInput } from "@/lib/validations";
import { logAdminAction } from "@/lib/admin-audit";
import { reglaDesdeFila, type ReglaCalculo } from "@/lib/puntos-calculo";

export type ReglaVigente = {
  id: string;
  nombre: string;
  montoBase: string;
  puntosPorBase: number;
  redondeo: string;
  montoMinimo: string;
  puntosMaximosTransaccion: number | null;
  vigenteDesde: Date;
  creadoPor: string | null;
};

export type ReglaHistorica = ReglaVigente & { vigenteHasta: Date | null };

export async function getReglaVigente(): Promise<ReglaVigente | null> {
  const sesion = await getSesionInterna();
  if (!sesion) return null;

  const [fila] = await db
    .select({
      id: reglasPuntos.id,
      nombre: reglasPuntos.nombre,
      montoBase: reglasPuntos.monto_base,
      puntosPorBase: reglasPuntos.puntos_por_base,
      redondeo: reglasPuntos.redondeo,
      montoMinimo: reglasPuntos.monto_minimo,
      puntosMaximosTransaccion: reglasPuntos.puntos_maximos_transaccion,
      vigenteDesde: reglasPuntos.vigente_desde,
      creadoPor: users.nombre,
    })
    .from(reglasPuntos)
    .leftJoin(users, eq(users.id, reglasPuntos.creado_por_id))
    .where(
      and(
        isNull(reglasPuntos.vigente_hasta),
        sesion.sucursal_id
          ? or(eq(reglasPuntos.sucursal_id, sesion.sucursal_id), isNull(reglasPuntos.sucursal_id))
          : undefined
      )
    )
    .orderBy(desc(reglasPuntos.vigente_desde))
    .limit(1);

  return fila ?? null;
}

export async function listarHistorialReglas(): Promise<ReglaHistorica[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeGestionarReglas(sesion)) return [];

  return db
    .select({
      id: reglasPuntos.id,
      nombre: reglasPuntos.nombre,
      montoBase: reglasPuntos.monto_base,
      puntosPorBase: reglasPuntos.puntos_por_base,
      redondeo: reglasPuntos.redondeo,
      montoMinimo: reglasPuntos.monto_minimo,
      puntosMaximosTransaccion: reglasPuntos.puntos_maximos_transaccion,
      vigenteDesde: reglasPuntos.vigente_desde,
      vigenteHasta: reglasPuntos.vigente_hasta,
      creadoPor: users.nombre,
    })
    .from(reglasPuntos)
    .leftJoin(users, eq(users.id, reglasPuntos.creado_por_id))
    .orderBy(desc(reglasPuntos.vigente_desde))
    .limit(20);
}

/**
 * Publica una regla nueva. La anterior se cierra en la MISMA transacción: si se
 * hiciera en dos pasos, una acreditación que cayera justo en medio encontraría
 * dos reglas vigentes (o ninguna) y no habría forma de saber cuál se aplicó.
 */
export async function publicarRegla(
  entrada: ReglaPuntosInput
): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarReglas(sesion)) {
    return { ok: false, error: "Solo el Admin puede cambiar las reglas de puntos." };
  }

  const parsed = reglaPuntosSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  const anterior = await getReglaVigente();
  const ahora = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(reglasPuntos)
      .set({ vigente_hasta: ahora })
      .where(
        and(
          isNull(reglasPuntos.vigente_hasta),
          sesion.sucursal_id
            ? or(eq(reglasPuntos.sucursal_id, sesion.sucursal_id), isNull(reglasPuntos.sucursal_id))
            : undefined
        )
      );

    await tx.insert(reglasPuntos).values({
      nombre: datos.nombre,
      monto_base: datos.monto_base.toFixed(2),
      puntos_por_base: datos.puntos_por_base,
      redondeo: datos.redondeo,
      monto_minimo: datos.monto_minimo.toFixed(2),
      puntos_maximos_transaccion: datos.puntos_maximos_transaccion,
      vigente_desde: ahora,
      sucursal_id: sesion.sucursal_id,
      creado_por_id: sesion.id,
    });
  });

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "regla_publicada",
    "reglas_puntos",
    null,
    {
      anterior: anterior
        ? `${anterior.puntosPorBase} pts por $${anterior.montoBase}`
        : "ninguna",
      nueva: `${datos.puntos_por_base} pts por $${datos.monto_base}`,
      tope: datos.puntos_maximos_transaccion,
    }
  );

  revalidatePath("/interno/reglas");
  revalidatePath("/interno/escanear");
  return { ok: true };
}

export type ServicioAdmin = {
  id: string;
  codigo: string;
  nombre: string;
  multiplicador: string;
  activo: boolean;
  orden: number;
};

export async function listarServicios(): Promise<ServicioAdmin[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeGestionarReglas(sesion)) return [];

  return db
    .select({
      id: serviciosTipo.id,
      codigo: serviciosTipo.codigo,
      nombre: serviciosTipo.nombre,
      multiplicador: serviciosTipo.multiplicador,
      activo: serviciosTipo.activo,
      orden: serviciosTipo.orden,
    })
    .from(serviciosTipo)
    .orderBy(serviciosTipo.orden);
}

export async function actualizarServicio(entrada: {
  id: string;
  nombre: string;
  multiplicador: number;
  activo: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarReglas(sesion)) {
    return { ok: false, error: "Solo el Admin puede cambiar los multiplicadores." };
  }

  if (!Number.isFinite(entrada.multiplicador) || entrada.multiplicador <= 0) {
    return { ok: false, error: "El multiplicador debe ser mayor a cero." };
  }
  if (entrada.multiplicador > 10) {
    // Un dedazo aquí (15 en vez de 1.5) multiplica por diez el pasivo del
    // programa sin que nadie lo note hasta el cierre de mes.
    return { ok: false, error: "Un multiplicador mayor a 10 es casi seguro un error de tecleo." };
  }
  if (entrada.nombre.trim().length < 3) {
    return { ok: false, error: "El nombre del servicio es demasiado corto." };
  }

  const [anterior] = await db
    .select()
    .from(serviciosTipo)
    .where(eq(serviciosTipo.id, entrada.id))
    .limit(1);

  if (!anterior) return { ok: false, error: "Ese servicio no existe." };

  await db
    .update(serviciosTipo)
    .set({
      nombre: entrada.nombre.trim(),
      multiplicador: entrada.multiplicador.toFixed(3),
      activo: entrada.activo,
    })
    .where(eq(serviciosTipo.id, entrada.id));

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "servicio_actualizado",
    "servicios_tipo",
    entrada.id,
    {
      antes: { nombre: anterior.nombre, multiplicador: anterior.multiplicador, activo: anterior.activo },
      despues: { nombre: entrada.nombre, multiplicador: entrada.multiplicador, activo: entrada.activo },
    }
  );

  revalidatePath("/interno/reglas");
  revalidatePath("/interno/escanear");
  return { ok: true };
}

/** Convierte la regla vigente al tipo que consume `calcularPuntos`. */
export async function getReglaCalculo(): Promise<ReglaCalculo | null> {
  const regla = await getReglaVigente();
  if (!regla) return null;

  return reglaDesdeFila({
    monto_base: regla.montoBase,
    puntos_por_base: regla.puntosPorBase,
    redondeo: regla.redondeo,
    monto_minimo: regla.montoMinimo,
    puntos_maximos_transaccion: regla.puntosMaximosTransaccion,
  });
}
