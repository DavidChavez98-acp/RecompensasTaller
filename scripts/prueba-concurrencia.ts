/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Prueba de concurrencia contra una base de datos REAL.
 *
 * Las pruebas unitarias no pueden cubrir esto: la corrección del ledger depende
 * de cómo Postgres resuelve dos escrituras simultáneas sobre la misma fila
 * (EvalPlanQual) y de los índices únicos parciales. Un mock siempre pasaría.
 *
 * Uso:  pnpm test:concurrencia
 *
 * Crea sus propios datos con nombres reconocibles y los borra al terminar,
 * incluso si algo falla.
 */

import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { and, eq, sql } from "drizzle-orm";
import { db, cerrarPool } from "../src/db/index";
import {
  clienteDispositivos,
  clientes,
  puntosTransacciones,
  qrEscaneos,
  sucursales,
  users,
} from "../src/db/schema";
import { aplicarMovimiento, recalcularSaldo } from "../src/lib/saldo";
import { registrarEscaneo } from "../src/lib/qr-token.server";

const MARCA = "PRUEBA_CONCURRENCIA";

let fallos = 0;

function comprobar(condicion: boolean, descripcion: string, detalle?: string) {
  if (condicion) {
    console.log(`  ✓ ${descripcion}`);
  } else {
    fallos++;
    console.error(`  ✗ ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  }
}

async function limpiar(clienteId: string | null, usuarioId: string | null, dispositivoId: string | null) {
  // El trigger append-only impide DELETE sobre puntos_transacciones desde la
  // aplicación. Se desactiva solo para esta limpieza de datos de prueba.
  if (clienteId) {
    await db.execute(sql`ALTER TABLE puntos_transacciones DISABLE TRIGGER puntos_transacciones_append_only`);
    await db.delete(puntosTransacciones).where(eq(puntosTransacciones.cliente_id, clienteId));
    await db.execute(sql`ALTER TABLE puntos_transacciones ENABLE TRIGGER puntos_transacciones_append_only`);
  }
  if (dispositivoId) {
    await db.delete(qrEscaneos).where(eq(qrEscaneos.dispositivo_id, dispositivoId));
    await db.delete(clienteDispositivos).where(eq(clienteDispositivos.id, dispositivoId));
  }
  if (clienteId) await db.delete(clientes).where(eq(clientes.id, clienteId));
  if (usuarioId) await db.delete(users).where(eq(users.id, usuarioId));
}

async function main() {
  let clienteId: string | null = null;
  let usuarioId: string | null = null;
  let dispositivoId: string | null = null;

  try {
    const [sucursal] = await db.select({ id: sucursales.id }).from(sucursales).limit(1);
    if (!sucursal) throw new Error("No hay sucursal sembrada. Corre `pnpm db:seed` primero.");

    const [cliente] = await db
      .insert(clientes)
      .values({
        identificacion: `${MARCA}_CEDULA`,
        identificacion_idx: `${MARCA}_${Date.now()}`,
        nombres: "Cliente de prueba concurrencia",
        saldo_cache: 0,
        sucursal_id: sucursal.id,
      })
      .returning({ id: clientes.id });
    clienteId = cliente!.id;

    const [usuario] = await db
      .insert(users)
      .values({ nombre: `${MARCA} Asesor`, role: "Asesor de Servicio", sucursal_id: sucursal.id })
      .returning({ id: users.id });
    usuarioId = usuario!.id;

    const [dispositivo] = await db
      .insert(clienteDispositivos)
      .values({ cliente_id: clienteId, secreto: "prueba" })
      .returning({ id: clienteDispositivos.id });
    dispositivoId = dispositivo!.id;

    // ── 1. Un escaneo no se puede quemar dos veces ────────────────────────────
    console.log("\n1. Anti-replay del código QR");
    const paso = Math.floor(Date.now() / 1000 / 60);
    const intentos = await Promise.all(
      Array.from({ length: 10 }, () =>
        registrarEscaneo({ dispositivoId: dispositivoId!, paso, usuarioId: usuarioId! })
      )
    );
    const exitosos = intentos.filter((r) => r.ok);
    comprobar(
      exitosos.length === 1,
      "10 escaneos simultáneos del mismo código producen exactamente 1 válido",
      `salieron ${exitosos.length}`
    );

    const escaneoId = exitosos[0]!.ok ? exitosos[0]!.escaneoId : "";

    // ── 2. Un escaneo produce como máximo una acreditación ────────────────────
    console.log("\n2. Doble acreditación sobre el mismo escaneo");
    // allSettled y no all: si alguna promesa REVIENTA en vez de devolver un
    // resultado, quiero ver el error, no perder la prueba entera.
    const resultados = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        aplicarMovimiento({
          clienteId: clienteId!,
          tipo: "acreditacion",
          puntos: 100,
          escaneoId,
          creadoPorId: usuarioId,
          creadoPorNombre: "Prueba",
        })
      )
    );

    const reventadas = resultados.filter((r) => r.status === "rejected");
    comprobar(
      reventadas.length === 0,
      "ninguna acreditación lanza excepción sin controlar",
      reventadas.length > 0
        ? `${reventadas.length} excepciones, la primera: ${(reventadas[0] as PromiseRejectedResult).reason?.message}`
        : undefined
    );

    const acreditaciones = resultados
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof aplicarMovimiento>>>).value);

    const aplicadas = acreditaciones.filter((r) => r.ok);
    const duplicadas = acreditaciones.filter((r) => !r.ok && r.motivo === "duplicado");

    comprobar(
      aplicadas.length === 1,
      "20 acreditaciones en paralelo del mismo escaneo aplican exactamente 1",
      `se aplicaron ${aplicadas.length}`
    );
    comprobar(
      duplicadas.length === 19,
      "las otras 19 se rechazan como duplicado",
      `hubo ${duplicadas.length}`
    );

    const [conteo] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(puntosTransacciones)
      .where(
        and(
          eq(puntosTransacciones.cliente_id, clienteId),
          eq(puntosTransacciones.tipo, "acreditacion")
        )
      );
    comprobar(conteo?.n === 1, "el ledger tiene exactamente 1 fila", `tiene ${conteo?.n}`);

    // ── 3. El saldo no se corrompe bajo escritura concurrente ────────────────
    console.log("\n3. Créditos concurrentes sin escaneo (ajustes)");
    await Promise.all(
      Array.from({ length: 30 }, () =>
        aplicarMovimiento({
          clienteId: clienteId!,
          tipo: "ajuste",
          puntos: 10,
          motivo: "prueba concurrencia",
          creadoPorId: usuarioId,
        })
      )
    );

    const verificacion = await recalcularSaldo(clienteId);
    comprobar(
      verificacion.saldoReal === 400,
      "100 de la acreditación + 30 ajustes de 10 = 400 puntos",
      `saldo real ${verificacion.saldoReal}`
    );
    comprobar(
      !verificacion.corregido,
      "el saldo cacheado ya coincidía con el ledger (sin deriva)",
      `caché ${verificacion.saldoCache} vs real ${verificacion.saldoReal}`
    );

    // ── 4. Débitos concurrentes: nadie se sobregira ──────────────────────────
    console.log("\n4. Débitos concurrentes con saldo justo");
    // Saldo 400. Diez débitos simultáneos de 150: solo pueden pasar dos.
    const debitos = await Promise.all(
      Array.from({ length: 10 }, () =>
        aplicarMovimiento({
          clienteId: clienteId!,
          tipo: "ajuste",
          puntos: -150,
          motivo: "prueba débito",
          creadoPorId: usuarioId,
        })
      )
    );

    const debitosOk = debitos.filter((r) => r.ok);
    const rechazados = debitos.filter((r) => !r.ok && r.motivo === "saldo_insuficiente");

    comprobar(
      debitosOk.length === 2,
      "de 10 débitos de 150 sobre saldo 400, pasan exactamente 2",
      `pasaron ${debitosOk.length}`
    );
    comprobar(
      rechazados.length === 8,
      "los otros 8 se rechazan por saldo insuficiente",
      `rechazados ${rechazados.length}`
    );

    const final = await recalcularSaldo(clienteId);
    comprobar(final.saldoReal === 100, "saldo final 400 − 300 = 100", `es ${final.saldoReal}`);
    comprobar(final.saldoReal >= 0, "el saldo nunca quedó negativo");

    // ── 5. La cadena de saldo_posterior es coherente ─────────────────────────
    console.log("\n5. Coherencia de la cadena del ledger");
    const filas = await db
      .select({
        puntos: puntosTransacciones.puntos,
        saldoPosterior: puntosTransacciones.saldo_posterior,
      })
      .from(puntosTransacciones)
      .where(eq(puntosTransacciones.cliente_id, clienteId))
      .orderBy(puntosTransacciones.secuencia);

    let acumulado = 0;
    let cadenaOk = true;
    for (const fila of filas) {
      acumulado += fila.puntos;
      if (fila.saldoPosterior !== acumulado) cadenaOk = false;
    }

    comprobar(
      cadenaOk,
      `saldo_posterior cuadra en las ${filas.length} filas (escrito con RETURNING, no calculado en JS)`
    );
    comprobar(acumulado === 100, "la suma del ledger da el saldo final", `da ${acumulado}`);

    // ── 6. El ledger sigue siendo inmutable ──────────────────────────────────
    console.log("\n6. Inmutabilidad del ledger");
    let bloqueado = false;
    try {
      await db
        .update(puntosTransacciones)
        .set({ puntos: 999999 })
        .where(eq(puntosTransacciones.cliente_id, clienteId));
    } catch (error) {
      // Drizzle envuelve el error de `pg`: el mensaje de arriba solo dice
      // "Failed query: update…". El motivo real vive en la cadena de `cause`.
      let actual: unknown = error;
      for (let i = 0; actual && i < 5 && !bloqueado; i++) {
        bloqueado = String((actual as Error).message ?? "").includes("append-only");
        actual = (actual as { cause?: unknown }).cause;
      }
    }
    comprobar(bloqueado, "un UPDATE sobre el ledger lo rechaza Postgres, no la aplicación");
  } finally {
    await limpiar(clienteId, usuarioId, dispositivoId);
    await cerrarPool();
  }

  console.log(
    fallos === 0
      ? "\nTodas las comprobaciones de concurrencia pasaron.\n"
      : `\n${fallos} comprobación(es) fallaron.\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("La prueba reventó:", error);
  await cerrarPool().catch(() => {});
  process.exit(1);
});
