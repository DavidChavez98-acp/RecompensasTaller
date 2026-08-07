/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * La parte ATÓMICA del flujo de canje, sin sesión ni correos.
 *
 * Vive aparte de `src/actions/canjes.ts` por la misma razón que `saldo.ts`:
 * la corrección bajo concurrencia depende de cómo Postgres resuelve dos
 * escrituras simultáneas sobre la misma fila, y eso solo se puede probar
 * llamando a la función directamente contra una base real. Una Server Action
 * necesita cookies y no se puede invocar desde un script de prueba.
 */

import "server-only";

import { db } from "@/db";
import { canjes, premios } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * Crea la fila del canje, o recupera la existente si esta clave de idempotencia
 * ya se usó (doble toque del cliente, reintento de red).
 *
 * El `targetWhere` NO es opcional: `canjes_idempotency_uq` es un índice PARCIAL
 * (`WHERE idempotency_key IS NOT NULL`), y Postgres solo lo considera para
 * inferir el conflicto si la sentencia repite ese mismo predicado. Sin él
 * responde 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
 * specification") y la solicitud revienta.
 */
export async function crearCanjeIdempotente(params: {
  clienteId: string;
  premioId: string;
  premioNombre: string;
  costoPuntos: number;
  idempotencyKey: string;
  sucursalId: string | null;
}): Promise<{ canjeId: string; yaExistia: boolean } | null> {
  const [creado] = await db
    .insert(canjes)
    .values({
      cliente_id: params.clienteId,
      premio_id: params.premioId,
      premio_nombre: params.premioNombre,
      costo_puntos: params.costoPuntos,
      estado: "solicitado",
      idempotency_key: params.idempotencyKey,
      sucursal_id: params.sucursalId,
    })
    .onConflictDoNothing({
      target: [canjes.cliente_id, canjes.idempotency_key],
      // En Drizzle 0.45 este `where` se emite como el predicado del índice:
      // `ON CONFLICT (...) WHERE ... DO NOTHING`. No es un filtro de filas.
      where: sql`${canjes.idempotency_key} IS NOT NULL`,
    })
    .returning({ id: canjes.id });

  if (creado) return { canjeId: creado.id, yaExistia: false };

  const [existente] = await db
    .select({ id: canjes.id })
    .from(canjes)
    .where(
      and(
        eq(canjes.cliente_id, params.clienteId),
        eq(canjes.idempotency_key, params.idempotencyKey)
      )
    )
    .limit(1);

  return existente ? { canjeId: existente.id, yaExistia: true } : null;
}

/** Borra un canje cuyo cobro de puntos no llegó a aplicarse. */
export async function descartarCanjeSinCobro(canjeId: string): Promise<void> {
  await db.delete(canjes).where(and(eq(canjes.id, canjeId), eq(canjes.estado, "solicitado")));
}

export type ResultadoAprobacion =
  | { ok: true; codigoEntrega: string; stockRestante: number | null }
  | { ok: false; motivo: "ya_procesado" | "sin_stock" };

/**
 * Aprueba el canje y reserva la unidad, o no hace ninguna de las dos.
 *
 * Dos guardias, ambas dentro de la misma transacción:
 *
 *  1. `WHERE estado = 'solicitado'` — dos jefes aprobando a la vez producen
 *     exactamente un cambio; el segundo recibe 0 filas.
 *  2. `WHERE stock > 0` — Postgres reevalúa la condición contra la versión
 *     nueva de la fila al desbloquearse (EvalPlanQual), así que dos
 *     aprobaciones simultáneas de la ÚLTIMA unidad no pueden pasar las dos.
 *
 * Si la segunda falla, la primera se revierte: no queda un canje aprobado sin
 * inventario apartado.
 */
export async function aprobarCanjeAtomico(params: {
  canjeId: string;
  premioId: string;
  usuarioId: string;
  codigoEntrega: string;
}): Promise<ResultadoAprobacion> {
  try {
    return await db.transaction(async (tx) => {
      const aprobados = await tx
        .update(canjes)
        .set({
          estado: "aprobado",
          codigo_entrega: params.codigoEntrega,
          aprobado_en: new Date(),
          aprobado_por_id: params.usuarioId,
          fecha_actualizacion: new Date(),
        })
        .where(and(eq(canjes.id, params.canjeId), eq(canjes.estado, "solicitado")))
        .returning({ id: canjes.id });

      if (aprobados.length === 0) throw new Error("YA_PROCESADO");

      const conStock = await tx
        .update(premios)
        .set({ stock: sql`${premios.stock} - 1`, fecha_actualizacion: new Date() })
        .where(
          and(
            eq(premios.id, params.premioId),
            sql`(${premios.stock} IS NULL OR ${premios.stock} > 0)`
          )
        )
        .returning({ stock: premios.stock });

      const fila = conStock[0];
      if (!fila) throw new Error("SIN_STOCK");

      return {
        ok: true as const,
        codigoEntrega: params.codigoEntrega,
        stockRestante: fila.stock,
      };
    });
  } catch (error) {
    const mensaje = (error as Error).message;
    if (mensaje === "YA_PROCESADO") return { ok: false, motivo: "ya_procesado" };
    if (mensaje === "SIN_STOCK") return { ok: false, motivo: "sin_stock" };
    throw error;
  }
}

/**
 * Devuelve la unidad al catálogo. Solo se llama al cancelar un canje YA
 * aprobado: en los demás casos nunca se reservó nada.
 */
export async function devolverStock(premioId: string): Promise<void> {
  await db
    .update(premios)
    .set({ stock: sql`${premios.stock} + 1`, fecha_actualizacion: new Date() })
    .where(and(eq(premios.id, premioId), sql`${premios.stock} IS NOT NULL`));
}
