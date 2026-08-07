/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Concurrencia del flujo de canje contra la base de datos REAL.
 *
 * Los dos escenarios que el concesionario planteó:
 *  · un cliente con saldo para un solo premio que pide varios a la vez;
 *  · dos clientes peleándose la última gorra de marketing.
 *
 * Uso:  pnpm test:canjes
 */

import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { eq, sql, inArray } from "drizzle-orm";
import { db, cerrarPool } from "../src/db/index";
import {
  canjeHistorial,
  canjes,
  clientes,
  premios,
  puntosTransacciones,
  sucursales,
  users,
} from "../src/db/schema";
import { aplicarMovimiento, recalcularSaldo } from "../src/lib/saldo";
import {
  aprobarCanjeAtomico,
  crearCanjeIdempotente,
  descartarCanjeSinCobro,
  devolverStock,
} from "../src/lib/canje-operaciones";
import { generarCodigoEntrega } from "../src/lib/otp";

const MARCA = "PRUEBA_CANJES";
let fallos = 0;

function comprobar(condicion: boolean, descripcion: string, detalle?: string) {
  if (condicion) console.log(`  ✓ ${descripcion}`);
  else {
    fallos++;
    console.error(`  ✗ ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  }
}

async function limpiar(clienteIds: string[], usuarioId: string | null, premioIds: string[]) {
  if (clienteIds.length > 0) {
    const filasCanje = await db
      .select({ id: canjes.id })
      .from(canjes)
      .where(inArray(canjes.cliente_id, clienteIds));
    const canjeIds = filasCanje.map((f) => f.id);

    await db.execute(sql`ALTER TABLE puntos_transacciones DISABLE TRIGGER puntos_transacciones_append_only`);
    await db.delete(puntosTransacciones).where(inArray(puntosTransacciones.cliente_id, clienteIds));
    await db.execute(sql`ALTER TABLE puntos_transacciones ENABLE TRIGGER puntos_transacciones_append_only`);

    if (canjeIds.length > 0) {
      await db.delete(canjeHistorial).where(inArray(canjeHistorial.canje_id, canjeIds));
      await db.delete(canjes).where(inArray(canjes.id, canjeIds));
    }
    await db.delete(clientes).where(inArray(clientes.id, clienteIds));
  }
  if (premioIds.length > 0) await db.delete(premios).where(inArray(premios.id, premioIds));
  if (usuarioId) await db.delete(users).where(eq(users.id, usuarioId));
}

async function main() {
  const clienteIds: string[] = [];
  const premioIds: string[] = [];
  let usuarioId: string | null = null;
  let premioId: string | null = null;

  try {
    const [sucursal] = await db.select({ id: sucursales.id }).from(sucursales).limit(1);
    if (!sucursal) throw new Error("Corre `pnpm db:seed` primero.");

    const [usuario] = await db
      .insert(users)
      .values({ nombre: `${MARCA} Jefe`, role: "Jefe de Taller", sucursal_id: sucursal.id })
      .returning({ id: users.id });
    usuarioId = usuario!.id;

    // Merchandising con UNA sola unidad: la gorra en disputa.
    const [premio] = await db
      .insert(premios)
      .values({
        codigo: `${MARCA}_GORRA_${Date.now()}`,
        nombre: "Gorra de prueba",
        tipo: "merchandising",
        costo_puntos: 500,
        stock: 1,
        sucursal_id: sucursal.id,
      })
      .returning({ id: premios.id });
    premioId = premio!.id;
    premioIds.push(premioId);

    /**
     * El saldo se siembra con una fila de ledger, NO escribiendo `saldo_cache`
     * a mano. El caché es una denormalización del ledger; si se rellenan por
     * separado, `recalcularSaldo` detecta —con razón— que los datos no cuadran.
     */
    async function crearCliente(nombre: string, saldo: number): Promise<string> {
      const [fila] = await db
        .insert(clientes)
        .values({
          identificacion: `${MARCA}_${nombre}`,
          identificacion_idx: `${MARCA}_${nombre}_${Date.now()}_${Math.random()}`,
          nombres: nombre,
          saldo_cache: 0,
          sucursal_id: sucursal!.id,
        })
        .returning({ id: clientes.id });

      clienteIds.push(fila!.id);

      if (saldo > 0) {
        await aplicarMovimiento({
          clienteId: fila!.id,
          tipo: "ajuste",
          puntos: saldo,
          motivo: "Saldo inicial de prueba",
        });
      }

      return fila!.id;
    }

    // ── 1. Doble gasto: un cliente pide varios premios a la vez ──────────────
    console.log("\n1. Doble gasto del mismo saldo");
    // Saldo 500: alcanza para UNA gorra de 500.
    const gastador = await crearCliente("Gastador", 500);

    const solicitudes = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        // Mismo camino que `solicitarCanje` en producción: si la prueba
        // reimplementa el INSERT, deja de cubrir el código que de verdad corre
        // (así se coló un ON CONFLICT roto contra un índice parcial).
        const creado = await crearCanjeIdempotente({
          clienteId: gastador,
          premioId: premioId!,
          premioNombre: "Gorra de prueba",
          costoPuntos: 500,
          idempotencyKey: crypto.randomUUID(),
          sucursalId: sucursal!.id,
        });

        const debito = await aplicarMovimiento({
          clienteId: gastador,
          tipo: "canje",
          puntos: -500,
          canjeId: creado!.canjeId,
          motivo: `Canje concurrente ${i}`,
        });

        if (!debito.ok) {
          await descartarCanjeSinCobro(creado!.canjeId);
        }
        return debito.ok;
      })
    );

    const cobrados = solicitudes.filter(Boolean).length;
    comprobar(
      cobrados === 1,
      "8 solicitudes simultáneas con saldo para una: solo 1 cobra",
      `cobraron ${cobrados}`
    );

    const saldoGastador = await recalcularSaldo(gastador);
    comprobar(saldoGastador.saldoReal === 0, "el saldo queda en 0, nunca negativo", `es ${saldoGastador.saldoReal}`);

    const canjesVivos = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(canjes)
      .where(eq(canjes.cliente_id, gastador));
    comprobar(
      canjesVivos[0]?.n === 1,
      "queda exactamente 1 canje en la cola (los demás se borraron al no cobrar)",
      `quedaron ${canjesVivos[0]?.n}`
    );

    // ── 2. La última gorra: dos clientes, una unidad ─────────────────────────
    console.log("\n2. Dos clientes, la última gorra");
    const compradores = await Promise.all(
      Array.from({ length: 6 }, (_, i) => crearCliente(`Comprador${i}`, 500))
    );

    const canjesEnCola = await Promise.all(
      compradores.map(async (clienteId) => {
        const creado = await crearCanjeIdempotente({
          clienteId,
          premioId: premioId!,
          premioNombre: "Gorra de prueba",
          costoPuntos: 500,
          idempotencyKey: crypto.randomUUID(),
          sucursalId: sucursal!.id,
        });

        await aplicarMovimiento({
          clienteId,
          tipo: "canje",
          puntos: -500,
          canjeId: creado!.canjeId,
          motivo: "Canje última gorra",
        });

        return { canjeId: creado!.canjeId, clienteId };
      })
    );

    comprobar(
      canjesEnCola.length === 6,
      "los 6 clientes pagan sus puntos y entran a la cola",
      `entraron ${canjesEnCola.length}`
    );

    // El Jefe (o varios a la vez) aprueban. Solo hay una gorra.
    const aprobaciones = await Promise.all(
      canjesEnCola.map(({ canjeId }) =>
        aprobarCanjeAtomico({
          canjeId,
          premioId: premioId!,
          usuarioId: usuarioId!,
          codigoEntrega: generarCodigoEntrega(),
        })
      )
    );

    const aprobados = aprobaciones.filter((a) => a.ok);
    const sinStock = aprobaciones.filter((a) => !a.ok && a.motivo === "sin_stock");

    comprobar(
      aprobados.length === 1,
      "6 aprobaciones simultáneas de la última unidad: solo 1 pasa",
      `pasaron ${aprobados.length}`
    );
    comprobar(
      sinStock.length === 5,
      "las otras 5 se rechazan por falta de stock",
      `fueron ${sinStock.length}`
    );

    const [stockFinal] = await db
      .select({ stock: premios.stock })
      .from(premios)
      .where(eq(premios.id, premioId!));
    comprobar(stockFinal?.stock === 0, "el stock queda en 0, nunca negativo", `es ${stockFinal?.stock}`);

    // Los 5 rechazados deben seguir en 'solicitado' para que el Jefe los
    // rechace y se les devuelvan los puntos.
    const [aunSolicitados] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(canjes)
      .where(sql`${canjes.premio_id} = ${premioId} AND ${canjes.estado} = 'solicitado'`);
    comprobar(
      aunSolicitados?.n === 6,
      "los canjes no aprobados siguen en cola (5 de la carrera + 1 del gastador)",
      `hay ${aunSolicitados?.n}`
    );

    // ── 3. Rechazar devuelve los puntos ──────────────────────────────────────
    console.log("\n3. Rechazo devuelve los puntos al cliente");
    const perdedor = canjesEnCola.find(
      (c) => !aprobados.some(() => false) && c.canjeId !== undefined
    );
    const canjePerdedor = canjesEnCola.filter((c) =>
      aprobaciones[canjesEnCola.indexOf(c)]?.ok === false
    )[0];

    if (canjePerdedor) {
      const antes = await recalcularSaldo(canjePerdedor.clienteId);
      comprobar(antes.saldoReal === 0, "antes del rechazo el cliente está en 0");

      const reverso = await aplicarMovimiento({
        clienteId: canjePerdedor.clienteId,
        tipo: "reverso",
        puntos: 500,
        canjeId: canjePerdedor.canjeId,
        motivo: "Sin stock",
      });
      comprobar(reverso.ok, "el reverso se aplica");

      const despues = await recalcularSaldo(canjePerdedor.clienteId);
      comprobar(despues.saldoReal === 500, "recupera sus 500 puntos", `tiene ${despues.saldoReal}`);

      // Un segundo reverso del mismo canje debe rebotar contra el índice único.
      const duplicado = await aplicarMovimiento({
        clienteId: canjePerdedor.clienteId,
        tipo: "reverso",
        puntos: 500,
        canjeId: canjePerdedor.canjeId,
        motivo: "Intento de doble devolución",
      });
      comprobar(
        !duplicado.ok && duplicado.motivo === "duplicado",
        "un segundo reverso del mismo canje se rechaza (no se regalan puntos)",
        duplicado.ok ? "se aplicó dos veces" : `motivo ${duplicado.motivo}`
      );
    } else {
      comprobar(false, "no se pudo identificar un canje rechazado para probar el reverso");
    }
    void perdedor;

    // ── 4. Cancelar un canje aprobado devuelve la unidad a bodega ────────────
    console.log("\n4. Cancelar un canje aprobado devuelve el stock");
    await devolverStock(premioId!);
    const [trasDevolver] = await db
      .select({ stock: premios.stock })
      .from(premios)
      .where(eq(premios.id, premioId!));
    comprobar(trasDevolver?.stock === 1, "la gorra vuelve al catálogo", `stock ${trasDevolver?.stock}`);

    // ── 5. Un servicio (stock null) no se agota nunca ────────────────────────
    console.log("\n5. Los servicios no se agotan");
    const [servicio] = await db
      .insert(premios)
      .values({
        codigo: `${MARCA}_ACEITE_${Date.now()}`,
        nombre: "Cambio de aceite de prueba",
        tipo: "servicio",
        costo_puntos: 100,
        stock: null,
        sucursal_id: sucursal.id,
      })
      .returning({ id: premios.id });
    premioIds.push(servicio!.id);

    const clienteServicio = await crearCliente("ClienteServicio", 1000);
    const aprobacionesServicio = [];
    for (let i = 0; i < 3; i++) {
      const creado = await crearCanjeIdempotente({
        clienteId: clienteServicio,
        premioId: servicio!.id,
        premioNombre: "Cambio de aceite de prueba",
        costoPuntos: 100,
        idempotencyKey: crypto.randomUUID(),
        sucursalId: sucursal.id,
      });

      await aplicarMovimiento({
        clienteId: clienteServicio,
        tipo: "canje",
        puntos: -100,
        canjeId: creado!.canjeId,
        motivo: "Canje de servicio",
      });

      aprobacionesServicio.push(
        await aprobarCanjeAtomico({
          canjeId: creado!.canjeId,
          premioId: servicio!.id,
          usuarioId: usuarioId!,
          codigoEntrega: generarCodigoEntrega(),
        })
      );
    }

    comprobar(
      aprobacionesServicio.every((a) => a.ok),
      "tres canjes seguidos de un servicio se aprueban todos",
      `${aprobacionesServicio.filter((a) => a.ok).length}/3`
    );

    const [stockServicio] = await db
      .select({ stock: premios.stock })
      .from(premios)
      .where(eq(premios.id, servicio!.id));
    comprobar(stockServicio?.stock === null, "el stock del servicio sigue siendo nulo (sin límite)");
  } finally {
    await limpiar(clienteIds, usuarioId, premioIds);
    await cerrarPool();
  }

  console.log(
    fallos === 0 ? "\nEl flujo de canje aguanta la concurrencia.\n" : `\n${fallos} fallo(s).\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("La prueba reventó:", error);
  await cerrarPool().catch(() => {});
  process.exit(1);
});
