/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Mantenimiento periódico: poda de tablas efímeras y verificación del saldo.
 *
 * ── Por qué no hay cron ──
 * El plan gratuito de Vercel da un cron diario, y depender de él para la
 * integridad del saldo sería frágil. En su lugar esto se dispara con `after()`
 * desde el layout del panel interno: no añade latencia a la respuesta, y en un
 * taller donde el personal entra todos los días se ejecuta a diario sin
 * infraestructura extra.
 *
 * El throttle es global (una fila en `settings`), no en memoria: en serverless
 * cada instancia tiene su propia memoria y el barrido correría decenas de veces
 * al día. Con la marca en base, corre una vez y las demás instancias lo ven.
 */

import "server-only";

import { db } from "@/db";
import {
  clientes,
  errorLog,
  otpCodigos,
  puntosTransacciones,
  qrEscaneos,
  settings,
} from "@/db/schema";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { recalcularSaldo } from "./saldo";
import {
  RETENCION_ERROR_LOG_DIAS,
  RETENCION_OTP_DIAS,
  RETENCION_QR_ESCANEOS_DIAS,
} from "./constants";

const CLAVE_ULTIMA_EJECUCION = "mantenimiento_ultima_ejecucion";
const INTERVALO_HORAS = 20;

function hace(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

/**
 * Marca el arranque de forma atómica: si dos instancias entran a la vez, solo
 * una consigue actualizar la fila y la otra se retira. El `WHERE` compara
 * contra el valor leído, igual que las guardias optimistas del resto del
 * sistema.
 */
async function tomarElTurno(): Promise<boolean> {
  const ahora = new Date();
  const limite = new Date(Date.now() - INTERVALO_HORAS * 60 * 60 * 1000);

  const [existente] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, CLAVE_ULTIMA_EJECUCION))
    .limit(1);

  if (!existente) {
    const insertadas = await db
      .insert(settings)
      .values({ key: CLAVE_ULTIMA_EJECUCION, value: ahora.toISOString() })
      .onConflictDoNothing({ target: settings.key })
      .returning({ key: settings.key });
    return insertadas.length > 0;
  }

  const ultima = new Date(existente.value);
  if (Number.isFinite(ultima.getTime()) && ultima > limite) return false;

  const actualizadas = await db
    .update(settings)
    .set({ value: ahora.toISOString(), fecha_actualizacion: ahora })
    .where(and(eq(settings.key, CLAVE_ULTIMA_EJECUCION), eq(settings.value, existente.value)))
    .returning({ key: settings.key });

  return actualizadas.length > 0;
}

export type ResultadoMantenimiento = {
  ejecutado: boolean;
  escaneosPodados?: number;
  otpPodados?: number;
  erroresPodados?: number;
  saldosRevisados?: number;
  saldosCorregidos?: number;
};

export async function ejecutarMantenimiento(): Promise<ResultadoMantenimiento> {
  if (!(await tomarElTurno())) return { ejecutado: false };

  const resultado: ResultadoMantenimiento = { ejecutado: true };

  try {
    // ── Poda ────────────────────────────────────────────────────────────────
    // `qr_escaneos` crece con cada visita y solo sirve para el anti-replay, que
    // opera en una ventana de dos minutos. A los 30 días no aporta nada.
    //
    // OJO: solo se borran los escaneos que NINGUNA fila del ledger referencia.
    // Un DELETE a secas chocaría contra la clave foránea, y perder la
    // trazabilidad de una acreditación sería peor que gastar unos kilobytes.
    const escaneos = await db
      .delete(qrEscaneos)
      .where(
        and(
          lt(qrEscaneos.fecha_creacion, hace(RETENCION_QR_ESCANEOS_DIAS)),
          sql`NOT EXISTS (
            SELECT 1 FROM puntos_transacciones pt WHERE pt.escaneo_id = ${qrEscaneos.id}
          )`
        )
      )
      .returning({ id: qrEscaneos.id });
    resultado.escaneosPodados = escaneos.length;

    // Los OTP consumidos o vencidos son basura con valor sensible: cuanto menos
    // tiempo vivan, mejor.
    const otps = await db
      .delete(otpCodigos)
      .where(lt(otpCodigos.fecha_creacion, hace(RETENCION_OTP_DIAS)))
      .returning({ id: otpCodigos.id });
    resultado.otpPodados = otps.length;

    const errores = await db
      .delete(errorLog)
      .where(lt(errorLog.fecha_creacion, hace(RETENCION_ERROR_LOG_DIAS)))
      .returning({ id: errorLog.id });
    resultado.erroresPodados = errores.length;

    // ── Verificación del saldo ──────────────────────────────────────────────
    // SOLO los clientes con movimiento en las últimas 24 h. Recalcular todos
    // cada noche sería gratis hoy (3.000 clientes) y caro en tres años, sin
    // aportar nada: un saldo que nadie tocó no puede haber derivado.
    const conMovimiento = await db
      .selectDistinct({ clienteId: puntosTransacciones.cliente_id })
      .from(puntosTransacciones)
      .where(gt(puntosTransacciones.fecha_creacion, hace(1)));

    let corregidos = 0;
    for (const { clienteId } of conMovimiento) {
      const verificacion = await recalcularSaldo(clienteId);
      if (verificacion.corregido) {
        corregidos++;
        await db.insert(errorLog).values({
          contexto: "mantenimiento.saldo",
          mensaje: `Saldo corregido de ${verificacion.saldoCache} a ${verificacion.saldoReal}`,
          detalle: { clienteId, ...verificacion },
        });
      }
    }

    resultado.saldosRevisados = conMovimiento.length;
    resultado.saldosCorregidos = corregidos;

    // Un cliente con saldo cacheado negativo no debería existir (hay un CHECK),
    // pero si apareciera hay que saberlo antes de que alguien reclame.
    const [negativos] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(clientes)
      .where(sql`${clientes.saldo_cache} < 0`);

    if ((negativos?.n ?? 0) > 0) {
      await db.insert(errorLog).values({
        contexto: "mantenimiento.saldo",
        mensaje: `${negativos!.n} cliente(s) con saldo negativo. Revisión manual urgente.`,
        detalle: { cantidad: negativos!.n },
      });
    }
  } catch (error) {
    console.error("[MANTENIMIENTO] Falló:", (error as Error)?.message);
    try {
      await db.insert(errorLog).values({
        contexto: "mantenimiento",
        mensaje: (error as Error)?.message ?? "Error desconocido",
      });
    } catch {
      // Si ni siquiera se puede registrar el error, no hay más que hacer.
    }
  }

  return resultado;
}
