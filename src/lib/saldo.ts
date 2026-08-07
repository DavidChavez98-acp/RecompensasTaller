/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * El único lugar donde se escribe en el ledger.
 *
 * Concentrar aquí el movimiento de puntos no es organización: es lo que hace
 * que la corrección del saldo se pueda auditar leyendo un archivo en vez de
 * quince Server Actions.
 */

import "server-only";

import { db } from "@/db";
import { clientes, errorLog, puntosTransacciones } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { TipoTransaccion } from "@/db/schema";

export type MovimientoPuntos = {
  clienteId: string;
  tipo: TipoTransaccion;
  /** CON SIGNO. Positivo entra, negativo sale. */
  puntos: number;

  montoGastado?: string | null;
  servicioTipoId?: string | null;
  multiplicadorAplicado?: string | null;
  reglaId?: string | null;

  escaneoId?: string | null;
  canjeId?: string | null;
  reversaDeId?: string | null;
  motivo?: string | null;
  documentoReferencia?: string | null;

  creadoPorId?: string | null;
  creadoPorNombre?: string | null;
  creadoPorRol?: string | null;
  sucursalId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type ResultadoMovimiento =
  | { ok: true; transaccionId: string; saldoPosterior: number }
  | { ok: false; motivo: "saldo_insuficiente" | "cliente_inexistente" | "duplicado"; saldoActual?: number };

/** SQLSTATE de Postgres para violación de restricción única. */
const UNIQUE_VIOLATION = "23505";

/**
 * Detecta un choque contra un índice único recorriendo la cadena de `cause`.
 *
 * NO se compara el texto del mensaje: Drizzle envuelve el error de `pg` en un
 * `DrizzleQueryError` cuyo mensaje es "Failed query: insert into…", sin rastro
 * de "duplicate key". Un `includes("duplicate key")` sobre ese mensaje no
 * encuentra nada y el duplicado sale como excepción sin controlar — que es
 * exactamente el bug que tenía este archivo. El código SQLSTATE, además, no
 * depende del idioma del servidor.
 */
function esViolacionDeUnicidad(error: unknown): boolean {
  let actual: unknown = error;
  for (let profundidad = 0; actual && profundidad < 5; profundidad++) {
    if ((actual as { code?: string }).code === UNIQUE_VIOLATION) return true;
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Aplica un movimiento de puntos de forma atómica.
 *
 * ── Por qué un UPDATE condicional y no SELECT + comprobar + INSERT ──
 * El enfoque ingenuo NO es seguro en READ COMMITTED: dos transacciones
 * concurrentes leen el mismo snapshot, las dos pasan la comprobación y las dos
 * insertan. Un CTE de una sola sentencia tampoco lo arregla, porque el SELECT
 * de dentro lee de ese mismo snapshot. Hay que decirlo explícito para que nadie
 * lo "simplifique" más adelante.
 *
 * Este UPDATE sí es seguro por EvalPlanQual: cuando se desbloquea tras el
 * commit de la otra transacción, Postgres REEVALÚA el WHERE contra la versión
 * nueva de la fila. La segunda ve el saldo ya descontado, la condición
 * `saldo_cache >= X` falla, y devuelve 0 filas. Sin SELECT FOR UPDATE, sin
 * SERIALIZABLE, sin reintentos.
 *
 * El `saldo_posterior` del ledger sale del RETURNING, así que es correcto
 * incluso bajo concurrencia: no se calcula en JavaScript.
 */
export async function aplicarMovimiento(mov: MovimientoPuntos): Promise<ResultadoMovimiento> {
  try {
    return await db.transaction(async (tx) => {
      // Para un débito (puntos < 0) la condición exige saldo suficiente.
      // Para un crédito no hay condición que comprobar, pero se usa el mismo
      // UPDATE para obtener el saldo resultante del RETURNING.
      const debito = mov.puntos < 0;

      const filas = await tx
        .update(clientes)
        .set({
          saldo_cache: sql`${clientes.saldo_cache} + ${mov.puntos}`,
          saldo_cache_actualizado: new Date(),
        })
        .where(
          debito
            ? sql`${clientes.id} = ${mov.clienteId} AND ${clientes.saldo_cache} >= ${-mov.puntos}`
            : eq(clientes.id, mov.clienteId)
        )
        .returning({ saldo: clientes.saldo_cache });

      const fila = filas[0];
      if (!fila) {
        // 0 filas puede ser "no existe" o "saldo insuficiente". Se distingue con
        // una lectura, solo en el camino de error (no cuesta nada en el feliz).
        const [existe] = await tx
          .select({ saldo: clientes.saldo_cache })
          .from(clientes)
          .where(eq(clientes.id, mov.clienteId))
          .limit(1);

        if (!existe) return { ok: false as const, motivo: "cliente_inexistente" as const };
        return {
          ok: false as const,
          motivo: "saldo_insuficiente" as const,
          saldoActual: existe.saldo,
        };
      }

      const [transaccion] = await tx
        .insert(puntosTransacciones)
        .values({
          cliente_id: mov.clienteId,
          tipo: mov.tipo,
          puntos: mov.puntos,
          saldo_posterior: fila.saldo,
          monto_gastado: mov.montoGastado ?? null,
          servicio_tipo_id: mov.servicioTipoId ?? null,
          multiplicador_aplicado: mov.multiplicadorAplicado ?? null,
          regla_id: mov.reglaId ?? null,
          escaneo_id: mov.escaneoId ?? null,
          canje_id: mov.canjeId ?? null,
          reversa_de_id: mov.reversaDeId ?? null,
          motivo: mov.motivo ?? null,
          documento_referencia: mov.documentoReferencia ?? null,
          creado_por_id: mov.creadoPorId ?? null,
          creado_por_nombre: mov.creadoPorNombre ?? null,
          creado_por_rol: mov.creadoPorRol ?? null,
          sucursal_id: mov.sucursalId ?? null,
          ip: mov.ip ?? null,
          user_agent: mov.userAgent ?? null,
        })
        .returning({ id: puntosTransacciones.id });

      if (!transaccion) throw new Error("No se pudo escribir en el ledger.");

      return { ok: true as const, transaccionId: transaccion.id, saldoPosterior: fila.saldo };
    });
  } catch (error) {
    // Los índices únicos parciales del ledger (un escaneo = una acreditación,
    // un canje = un débito) rechazan los duplicados en la base. Llegar aquí
    // significa que ese constraint hizo su trabajo: no es un fallo, es la
    // segunda copia de una operación que ya se aplicó, y la transacción entera
    // (incluido el descuento del saldo cacheado) quedó revertida.
    if (esViolacionDeUnicidad(error)) {
      return { ok: false, motivo: "duplicado" };
    }
    throw error;
  }
}

/**
 * Recalcula el saldo real sumando el ledger y corrige el caché si difiere.
 *
 * A este volumen (un taller: ~3.000 clientes × 3 visitas al año, menos de 50
 * filas por cliente) es un index scan trivial. Se ejecuta desde el botón del
 * admin, en el barrido nocturno de clientes con movimiento, y antes de
 * cualquier ajuste manual.
 */
export async function recalcularSaldo(
  clienteId: string
): Promise<{ saldoReal: number; saldoCache: number; corregido: boolean; anomalia?: string }> {
  const [suma] = await db
    .select({ total: sql<number>`coalesce(sum(${puntosTransacciones.puntos}), 0)::int` })
    .from(puntosTransacciones)
    .where(eq(puntosTransacciones.cliente_id, clienteId));

  const saldoReal = suma?.total ?? 0;

  const [cliente] = await db
    .select({ saldo: clientes.saldo_cache })
    .from(clientes)
    .where(eq(clientes.id, clienteId))
    .limit(1);

  const saldoCache = cliente?.saldo ?? 0;

  if (saldoReal === saldoCache) {
    return { saldoReal, saldoCache, corregido: false };
  }

  /*
   * Un ledger que suma negativo significa que hay débitos sin su crédito
   * correspondiente: datos corruptos, no una simple deriva del caché.
   *
   * Escribirlo haría saltar el CHECK `saldo_cache >= 0` y esta función
   * reventaría — justo en el barrido nocturno, que es cuando menos se mira.
   * Se reporta la anomalía y se deja el caché como está: un saldo cacheado
   * demasiado alto es un problema de dinero acotado; un job de mantenimiento
   * que falla en silencio es un problema que crece.
   */
  if (saldoReal < 0) {
    const anomalia = `El ledger del cliente suma ${saldoReal}, que es imposible. Revisión manual necesaria.`;
    console.error(`[SALDO] ${anomalia} cliente=${clienteId}`);

    try {
      await db.insert(errorLog).values({
        contexto: "recalcularSaldo",
        mensaje: anomalia,
        detalle: { clienteId, saldoReal, saldoCache },
      });
    } catch {
      // El registro del error nunca debe tumbar el barrido.
    }

    return { saldoReal, saldoCache, corregido: false, anomalia };
  }

  await db
    .update(clientes)
    .set({ saldo_cache: saldoReal, saldo_cache_actualizado: new Date() })
    .where(eq(clientes.id, clienteId));

  return { saldoReal, saldoCache, corregido: true };
}
