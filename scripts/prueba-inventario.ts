/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Concurrencia del inventario de marketing contra la base de datos REAL.
 *
 * Llama a `aplicarMovimientoInventario` / `aplicarMovimientoInventarioEnTx` y
 * a `aprobarCanjeAtomico` directamente — las mismas funciones que usa
 * producción, no una reimplementación. Ver AGENTS.md: "las pruebas de
 * concurrencia deben llamar al mismo código".
 *
 * Uso: pnpm test:inventario
 */

import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { eq, sql, inArray } from "drizzle-orm";
import { db, cerrarPool } from "../src/db/index";
import {
  articulos,
  canjeHistorial,
  canjes,
  clientes,
  movimientosInventario,
  premios,
  puntosTransacciones,
  sucursales,
  users,
} from "../src/db/schema";
import { aplicarMovimiento } from "../src/lib/saldo";
import { aplicarMovimientoInventario, recalcularStock } from "../src/lib/inventario";
import { aprobarCanjeAtomico, crearCanjeIdempotente } from "../src/lib/canje-operaciones";
import { generarCodigoEntrega } from "../src/lib/otp";

const MARCA = "PRUEBA_INVENTARIO";
let fallos = 0;

function comprobar(condicion: boolean, descripcion: string, detalle?: string) {
  if (condicion) console.log(`  ✓ ${descripcion}`);
  else {
    fallos++;
    console.error(`  ✗ ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  }
}

async function limpiar(
  articuloIds: string[],
  clienteIds: string[],
  premioIds: string[],
  usuarioId: string | null
) {
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
      await db.execute(sql`ALTER TABLE movimientos_inventario DISABLE TRIGGER movimientos_inventario_append_only`);
      await db.delete(movimientosInventario).where(inArray(movimientosInventario.canje_id, canjeIds));
      await db.execute(sql`ALTER TABLE movimientos_inventario ENABLE TRIGGER movimientos_inventario_append_only`);

      await db.delete(canjeHistorial).where(inArray(canjeHistorial.canje_id, canjeIds));
      await db.delete(canjes).where(inArray(canjes.id, canjeIds));
    }
    await db.delete(clientes).where(inArray(clientes.id, clienteIds));
  }
  if (premioIds.length > 0) await db.delete(premios).where(inArray(premios.id, premioIds));
  if (articuloIds.length > 0) {
    await db.execute(sql`ALTER TABLE movimientos_inventario DISABLE TRIGGER movimientos_inventario_append_only`);
    await db.delete(movimientosInventario).where(inArray(movimientosInventario.articulo_id, articuloIds));
    await db.execute(sql`ALTER TABLE movimientos_inventario ENABLE TRIGGER movimientos_inventario_append_only`);
    await db.delete(articulos).where(inArray(articulos.id, articuloIds));
  }
  if (usuarioId) await db.delete(users).where(eq(users.id, usuarioId));
}

async function main() {
  const articuloIds: string[] = [];
  const clienteIds: string[] = [];
  const premioIds: string[] = [];
  let usuarioId: string | null = null;

  try {
    const [sucursal] = await db.select({ id: sucursales.id }).from(sucursales).limit(1);
    if (!sucursal) throw new Error("Corre `pnpm db:seed` primero.");

    const [usuario] = await db
      .insert(users)
      .values({ nombre: `${MARCA} Jefe`, role: "Jefe de Marketing", sucursal_id: sucursal.id })
      .returning({ id: users.id });
    usuarioId = usuario!.id;

    async function crearArticulo(nombre: string, stockInicial: number): Promise<string> {
      const [fila] = await db
        .insert(articulos)
        .values({ codigo: `${MARCA}_${nombre}_${Date.now()}_${Math.random()}`, nombre, stock_cache: 0 })
        .returning({ id: articulos.id });
      articuloIds.push(fila!.id);

      if (stockInicial > 0) {
        const mov = await aplicarMovimientoInventario({
          articuloId: fila!.id,
          motivo: "ajuste_conteo",
          cantidad: stockInicial,
          motivoTexto: "Saldo inicial de prueba",
        });
        if (!mov.ok) throw new Error(`No se pudo sembrar stock: ${JSON.stringify(mov)}`);
      }
      return fila!.id;
    }

    // ── 1. Diez salidas simultáneas sobre UNA sola unidad ────────────────────
    console.log("\n1. Diez salidas simultáneas, un solo artículo con 1 unidad");
    const articuloUnico = await crearArticulo("GORRA_UNICA", 1);

    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        aplicarMovimientoInventario({
          articuloId: articuloUnico,
          motivo: "salida_evento",
          cantidad: -1,
          evento: `Feria concurrente ${i}`,
        })
      )
    );

    const exitosas = resultados.filter((r) => r.ok);
    const sinStock = resultados.filter((r) => !r.ok && r.motivo === "stock_insuficiente");

    comprobar(exitosas.length === 1, "exactamente 1 de las 10 salidas tiene éxito", `tuvieron éxito ${exitosas.length}`);
    comprobar(sinStock.length === 9, "las otras 9 se rechazan por falta de stock", `fueron ${sinStock.length}`);

    const [articuloFinal] = await db
      .select({ stock: articulos.stock_cache })
      .from(articulos)
      .where(eq(articulos.id, articuloUnico));
    comprobar(articuloFinal?.stock === 0, "el stock queda en 0, nunca negativo", `es ${articuloFinal?.stock}`);

    const [filasLedger] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(movimientosInventario)
      .where(eq(movimientosInventario.articulo_id, articuloUnico));
    comprobar(
      filasLedger?.n === 2, // el ajuste_conteo inicial + la única salida que pasó
      "el ledger tiene exactamente 2 filas (siembra + 1 salida), no 11",
      `tiene ${filasLedger?.n}`
    );

    // ── 2. Canje vs. entrega de vehículo: la última unidad, dos canales ──────
    console.log("\n2. Canje y entrega de vehículo compitiendo por la última unidad");
    const articuloCompartido = await crearArticulo("GORRA_COMPARTIDA", 1);

    const [premio] = await db
      .insert(premios)
      .values({
        codigo: `${MARCA}_PREMIO_${Date.now()}`,
        nombre: "Gorra de prueba compartida",
        tipo: "merchandising",
        costo_puntos: 500,
        articulo_id: articuloCompartido,
        sucursal_id: sucursal.id,
      })
      .returning({ id: premios.id });
    premioIds.push(premio!.id);

    async function crearCliente(nombre: string, saldo: number): Promise<string> {
      const [fila] = await db
        .insert(clientes)
        .values({
          identificacion: `${MARCA}_${nombre}`,
          identificacion_idx: `${MARCA}_${nombre}_${Date.now()}_${Math.random()}`,
          nombres: nombre,
          saldo_cache: 0,
          sucursal_id: sucursal.id,
        })
        .returning({ id: clientes.id });
      clienteIds.push(fila!.id);

      await aplicarMovimiento({ clienteId: fila!.id, tipo: "ajuste", puntos: saldo, motivo: "Saldo inicial de prueba" });
      return fila!.id;
    }

    const compradora = await crearCliente("CompradoraCanje", 500);
    const creado = await crearCanjeIdempotente({
      clienteId: compradora,
      premioId: premio!.id,
      premioNombre: "Gorra de prueba compartida",
      costoPuntos: 500,
      idempotencyKey: crypto.randomUUID(),
      sucursalId: sucursal.id,
    });
    await aplicarMovimiento({
      clienteId: compradora,
      tipo: "canje",
      puntos: -500,
      canjeId: creado!.canjeId,
      motivo: "Canje concurrente vs entrega de vehículo",
    });

    // Los dos canales corren EN PARALELO sobre el mismo artículo, con 1 sola unidad.
    const [resultadoCanje, resultadoEntrega] = await Promise.all([
      aprobarCanjeAtomico({
        canjeId: creado!.canjeId,
        premioId: premio!.id,
        usuarioId: usuarioId!,
        codigoEntrega: generarCodigoEntrega(),
      }),
      aplicarMovimientoInventario({
        articuloId: articuloCompartido,
        motivo: "salida_entrega_vehiculo",
        cantidad: -1,
      }),
    ]);

    const ganoElCanje = resultadoCanje.ok;
    const ganoLaEntrega = resultadoEntrega.ok;

    comprobar(
      ganoElCanje !== ganoLaEntrega,
      "gana exactamente uno de los dos canales, nunca los dos ni ninguno",
      `canje=${ganoElCanje} entrega=${ganoLaEntrega}`
    );

    const [stockCompartido] = await db
      .select({ stock: articulos.stock_cache })
      .from(articulos)
      .where(eq(articulos.id, articuloCompartido));
    comprobar(stockCompartido?.stock === 0, "el stock queda en 0, nunca negativo", `es ${stockCompartido?.stock}`);

    if (!ganoElCanje) {
      // El canje perdió la carrera: el Jefe lo rechaza y se devuelven los puntos.
      const reverso = await aplicarMovimiento({
        clienteId: compradora,
        tipo: "reverso",
        puntos: 500,
        canjeId: creado!.canjeId,
        motivo: "Sin stock: ganó la entrega de vehículo",
      });
      comprobar(reverso.ok, "si el canje pierde, sus puntos se pueden devolver sin problema");
    }

    // ── 3. El mismo canje_id no puede descontar dos veces ────────────────────
    console.log("\n3. El mismo canje_id no descuenta dos veces (UNIQUE parcial)");
    const articuloDoble = await crearArticulo("GORRA_DOBLE", 5);

    // Canje NUEVO, independiente del paso 2: reutilizar `creado.canjeId` de
    // arriba sería ambiguo, porque si ganó la carrera del paso 2 esa fila YA
    // tiene un movimiento con ese canje_id, y el primer descuento de aquí
    // saldría "duplicado" en vez de "ok" — falseando la prueba.
    const compradoraDoble = await crearCliente("CompradoraDoble", 500);
    const canjeDoble = await crearCanjeIdempotente({
      clienteId: compradoraDoble,
      premioId: premio!.id,
      premioNombre: "Gorra de prueba compartida",
      costoPuntos: 500,
      idempotencyKey: crypto.randomUUID(),
      sucursalId: sucursal.id,
    });
    await aplicarMovimiento({
      clienteId: compradoraDoble,
      tipo: "canje",
      puntos: -500,
      canjeId: canjeDoble!.canjeId,
      motivo: "Canje de prueba para el descuento duplicado",
    });

    const primerDescuento = await aplicarMovimientoInventario({
      articuloId: articuloDoble,
      motivo: "salida_canje",
      cantidad: -1,
      canjeId: canjeDoble!.canjeId,
    });
    comprobar(primerDescuento.ok, "el primer descuento de este canje_id se aplica");

    const segundoDescuento = await aplicarMovimientoInventario({
      articuloId: articuloDoble,
      motivo: "salida_canje",
      cantidad: -1,
      canjeId: canjeDoble!.canjeId,
    });
    comprobar(
      !segundoDescuento.ok && segundoDescuento.motivo === "duplicado",
      "el segundo descuento del MISMO canje_id se rechaza como duplicado",
      segundoDescuento.ok ? "se aplicó dos veces" : `motivo ${segundoDescuento.motivo}`
    );

    const [stockDoble] = await db
      .select({ stock: articulos.stock_cache })
      .from(articulos)
      .where(eq(articulos.id, articuloDoble));
    comprobar(stockDoble?.stock === 4, "el stock solo bajó una vez (5 → 4, no 3)", `es ${stockDoble?.stock}`);

    // ── 4. El trigger append-only rechaza UPDATE y DELETE ────────────────────
    console.log("\n4. movimientos_inventario es append-only");
    const [filaExistente] = await db
      .select({ id: movimientosInventario.id })
      .from(movimientosInventario)
      .where(eq(movimientosInventario.articulo_id, articuloDoble))
      .limit(1);

    let updateFallo = false;
    try {
      await db
        .update(movimientosInventario)
        .set({ cantidad: 999 })
        .where(eq(movimientosInventario.id, filaExistente!.id));
    } catch {
      updateFallo = true;
    }
    comprobar(updateFallo, "UPDATE sobre el ledger de inventario es rechazado por el trigger");

    let deleteFallo = false;
    try {
      await db.delete(movimientosInventario).where(eq(movimientosInventario.id, filaExistente!.id));
    } catch {
      deleteFallo = true;
    }
    comprobar(deleteFallo, "DELETE sobre el ledger de inventario es rechazado por el trigger");

    // ── 5. recalcularStock() coincide con el ledger tras todo lo anterior ────
    console.log("\n5. recalcularStock() no encuentra deriva");
    for (const id of [articuloUnico, articuloCompartido, articuloDoble]) {
      const resultado = await recalcularStock(id);
      comprobar(
        resultado.stockReal === resultado.stockCache && !resultado.corregido,
        `el artículo ${id.slice(0, 8)} no tiene deriva entre ledger y caché`,
        `real=${resultado.stockReal} cache=${resultado.stockCache}`
      );
    }
  } finally {
    await limpiar(articuloIds, clienteIds, premioIds, usuarioId);
    await cerrarPool();
  }

  console.log(
    fallos === 0 ? "\nEl inventario de marketing aguanta la concurrencia.\n" : `\n${fallos} fallo(s).\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("La prueba reventó:", error);
  await cerrarPool().catch(() => {});
  process.exit(1);
});
