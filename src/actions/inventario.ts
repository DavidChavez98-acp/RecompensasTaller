/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * El inventario de marketing, de verdad separado del catálogo de premios.
 *
 * `crearPremio` (en `premios.ts`) sigue siendo el camino para un merchandising
 * CANJEABLE — crea su artículo enlazado en la misma transacción. Este archivo
 * es para lo que `crearPremio` no cubre: artículos sin premio (un roll-up, un
 * tríptico) y las dos operaciones que mueven stock sin pasar por un canje:
 * ingreso de mercadería y salida (feria, entrega de vehículo, merma, uso
 * interno).
 *
 * ── Dos permisos, no uno ──
 * `puedeGestionarInventario` (Admin, Jefe de Marketing) puede TODO: alta de
 * artículos, ingresos, ajustes, y también salidas. `puedeRegistrarSalidaInventario`
 * añade al Asesor Comercial, pero SOLO para salidas — su rol no tiene alta de
 * artículos ni ingresos. Cada función de este archivo comprueba el predicado
 * que le corresponde, no el más permisivo por comodidad.
 */

"use server";

import { db } from "@/db";
import { articulos, movimientosInventario, vehiculos } from "@/db/schema";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSesionInterna } from "./auth-interno";
import { puedeGestionarInventario, puedeRegistrarSalidaInventario } from "@/lib/authz";
import { aplicarMovimientoInventario } from "@/lib/inventario";
import {
  articuloSchema,
  ingresoInventarioSchema,
  salidaInventarioSchema,
} from "@/lib/validations";
import { logAdminAction } from "@/lib/admin-audit";
import type { MotivoInventario } from "@/db/schema";

export type ArticuloResumen = {
  id: string;
  codigo: string;
  nombre: string;
  unidad: string;
  stock: number;
  stockMinimoAlerta: number | null;
  activo: boolean;
};

export async function listarArticulos(): Promise<ArticuloResumen[]> {
  const sesion = await getSesionInterna();
  if (!sesion) return [];
  if (!puedeGestionarInventario(sesion) && !puedeRegistrarSalidaInventario(sesion)) return [];

  const filas = await db
    .select({
      id: articulos.id,
      codigo: articulos.codigo,
      nombre: articulos.nombre,
      unidad: articulos.unidad,
      stock: articulos.stock_cache,
      stockMinimoAlerta: articulos.stock_minimo_alerta,
      activo: articulos.activo,
    })
    .from(articulos)
    .where(eq(articulos.activo, true))
    .orderBy(articulos.nombre);

  return filas;
}

export type ArticuloDetalle = ArticuloResumen & {
  descripcion: string | null;
  costoUnitario: string | null;
};

export async function getArticuloDetalle(articuloId: string): Promise<ArticuloDetalle | null> {
  const sesion = await getSesionInterna();
  if (!sesion) return null;
  if (!puedeGestionarInventario(sesion) && !puedeRegistrarSalidaInventario(sesion)) return null;

  const [fila] = await db
    .select({
      id: articulos.id,
      codigo: articulos.codigo,
      nombre: articulos.nombre,
      descripcion: articulos.descripcion,
      unidad: articulos.unidad,
      stock: articulos.stock_cache,
      stockMinimoAlerta: articulos.stock_minimo_alerta,
      costoUnitario: articulos.costo_unitario,
      activo: articulos.activo,
    })
    .from(articulos)
    .where(eq(articulos.id, articuloId))
    .limit(1);

  return fila ?? null;
}

export type MovimientoArticulo = {
  id: string;
  motivo: MotivoInventario;
  cantidad: number;
  stockPosterior: number;
  evento: string | null;
  motivoTexto: string | null;
  documentoReferencia: string | null;
  actor: string | null;
  fecha: Date;
};

export async function listarMovimientosArticulo(
  articuloId: string,
  limite = 50
): Promise<MovimientoArticulo[]> {
  const sesion = await getSesionInterna();
  if (!sesion) return [];
  if (!puedeGestionarInventario(sesion) && !puedeRegistrarSalidaInventario(sesion)) return [];

  return db
    .select({
      id: movimientosInventario.id,
      motivo: movimientosInventario.motivo,
      cantidad: movimientosInventario.cantidad,
      stockPosterior: movimientosInventario.stock_posterior,
      evento: movimientosInventario.evento,
      motivoTexto: movimientosInventario.motivo_texto,
      documentoReferencia: movimientosInventario.documento_referencia,
      actor: movimientosInventario.creado_por_nombre,
      fecha: movimientosInventario.fecha_creacion,
    })
    .from(movimientosInventario)
    .where(eq(movimientosInventario.articulo_id, articuloId))
    .orderBy(desc(movimientosInventario.fecha_creacion))
    .limit(limite);
}

export async function crearArticulo(entrada: {
  codigo: string;
  nombre: string;
  descripcion?: string;
  unidad?: string;
  stock_minimo_alerta: number | null;
}): Promise<{ ok: boolean; error?: string; articuloId?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarInventario(sesion)) {
    return { ok: false, error: "Tu rol no permite dar de alta artículos." };
  }

  const parsed = articuloSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  const [existente] = await db
    .select({ id: articulos.id })
    .from(articulos)
    .where(eq(articulos.codigo, datos.codigo))
    .limit(1);
  if (existente) return { ok: false, error: `Ya existe un artículo con el código ${datos.codigo}.` };

  const [creado] = await db
    .insert(articulos)
    .values({
      codigo: datos.codigo,
      nombre: datos.nombre,
      descripcion: datos.descripcion || null,
      unidad: datos.unidad || "unidad",
      stock_minimo_alerta: datos.stock_minimo_alerta,
      sucursal_id: sesion.sucursal_id,
    })
    .returning({ id: articulos.id });

  if (!creado) return { ok: false, error: "No se pudo crear el artículo." };

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "articulo_creado",
    "articulos",
    creado.id,
    { ...datos }
  );

  revalidatePath("/interno/inventario");
  return { ok: true, articuloId: creado.id };
}

export async function registrarIngreso(entrada: {
  articulo_id: string;
  motivo?: "ingreso_compra" | "ingreso_devolucion";
  cantidad: number;
  costo_unitario?: number;
  documento_referencia?: string;
  evento?: string;
}): Promise<{ ok: boolean; error?: string; stockNuevo?: number }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarInventario(sesion)) {
    return { ok: false, error: "Tu rol no permite registrar ingresos." };
  }

  const parsed = ingresoInventarioSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  const movimiento = await aplicarMovimientoInventario({
    articuloId: datos.articulo_id,
    motivo: datos.motivo,
    cantidad: datos.cantidad,
    costoUnitario: datos.costo_unitario?.toFixed(2),
    documentoReferencia: datos.documento_referencia || null,
    evento: datos.motivo === "ingreso_devolucion" ? datos.evento || null : null,
    creadoPorId: sesion.id,
    creadoPorNombre: sesion.nombre,
    creadoPorRol: sesion.role,
    sucursalId: sesion.sucursal_id,
  });

  if (!movimiento.ok) {
    return { ok: false, error: movimiento.detalle ?? "No se pudo registrar el ingreso." };
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "ingreso_inventario",
    "articulos",
    datos.articulo_id,
    { motivo: datos.motivo, cantidad: datos.cantidad, documentoReferencia: datos.documento_referencia }
  );

  revalidatePath("/interno/inventario");
  return { ok: true, stockNuevo: movimiento.stockPosterior };
}

export async function registrarSalida(entrada: {
  articulo_id: string;
  motivo: "salida_entrega_vehiculo" | "salida_evento" | "salida_merma" | "salida_interna";
  cantidad: number;
  evento?: string;
  vehiculo_id?: string;
  motivo_texto?: string;
}): Promise<{ ok: boolean; error?: string; stockNuevo?: number }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeRegistrarSalidaInventario(sesion)) {
    return { ok: false, error: "Tu rol no permite registrar salidas de inventario." };
  }

  const parsed = salidaInventarioSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  // El vehículo se busca por chasis en la pantalla, pero la Server Action no
  // confía en el id que le llega: lo revalida contra la base. Un vehiculo_id
  // inventado (o de un cliente cuya cuenta cambió) no debe poder colarse en
  // el ledger como si fuera una entrega real.
  if (datos.motivo === "salida_entrega_vehiculo") {
    // El refine del schema ya exige vehiculo_id no vacío para este motivo.
    if (!datos.vehiculo_id) return { ok: false, error: "Busca el vehículo por chasis." };
    const [vehiculo] = await db
      .select({ id: vehiculos.id })
      .from(vehiculos)
      .where(eq(vehiculos.id, datos.vehiculo_id))
      .limit(1);
    if (!vehiculo) return { ok: false, error: "Ese vehículo no existe." };
  }

  const movimiento = await aplicarMovimientoInventario({
    articuloId: datos.articulo_id,
    motivo: datos.motivo,
    cantidad: -datos.cantidad,
    evento: datos.evento || null,
    vehiculoId: datos.vehiculo_id || null,
    motivoTexto: datos.motivo_texto || null,
    creadoPorId: sesion.id,
    creadoPorNombre: sesion.nombre,
    creadoPorRol: sesion.role,
    sucursalId: sesion.sucursal_id,
  });

  if (!movimiento.ok) {
    if (movimiento.motivo === "stock_insuficiente") {
      return {
        ok: false,
        error: `No hay tantas unidades: quedan ${movimiento.stockActual ?? 0}.`,
      };
    }
    return { ok: false, error: movimiento.detalle ?? "No se pudo registrar la salida." };
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "salida_inventario",
    "articulos",
    datos.articulo_id,
    { motivo: datos.motivo, cantidad: datos.cantidad, evento: datos.evento, vehiculoId: datos.vehiculo_id }
  );

  revalidatePath("/interno/inventario");
  return { ok: true, stockNuevo: movimiento.stockPosterior };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reportes — solo Jefe de Marketing y Admin. El Asesor Comercial saca
// mercadería, pero valorizar el inventario o ver qué ferias quedaron abiertas
// es una decisión de gestión, no de mostrador.
// ─────────────────────────────────────────────────────────────────────────────

export type ValorizacionArticulo = {
  id: string;
  nombre: string;
  stock: number;
  costoUnitario: string | null;
  valor: number;
};

export type Valorizacion = {
  articulos: ValorizacionArticulo[];
  total: number;
  sinCosto: number;
};

/** Stock × último costo unitario conocido. Los artículos sin costo no suman, pero se listan. */
export async function getValorizacionInventario(): Promise<Valorizacion> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeGestionarInventario(sesion)) return { articulos: [], total: 0, sinCosto: 0 };

  const filas = await db
    .select({
      id: articulos.id,
      nombre: articulos.nombre,
      stock: articulos.stock_cache,
      costoUnitario: articulos.costo_unitario,
    })
    .from(articulos)
    .where(eq(articulos.activo, true))
    .orderBy(desc(articulos.stock_cache));

  const conValor = filas.map((f) => ({
    ...f,
    valor: f.costoUnitario ? f.stock * Number(f.costoUnitario) : 0,
  }));

  return {
    articulos: conValor,
    total: conValor.reduce((acc, f) => acc + f.valor, 0),
    sinCosto: conValor.filter((f) => f.costoUnitario === null && f.stock > 0).length,
  };
}

export type ConsumoCanal = { motivo: MotivoInventario; unidades: number };

/** Unidades que salieron por cada canal en los últimos `dias`. */
export async function getConsumoPorCanal(dias = 30): Promise<ConsumoCanal[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeGestionarInventario(sesion)) return [];

  return db
    .select({
      motivo: movimientosInventario.motivo,
      unidades: sql<number>`sum(abs(${movimientosInventario.cantidad}))::int`,
    })
    .from(movimientosInventario)
    // starts_with y no LIKE: motivo es un enum (42883 sin cast) y el `_` de
    // LIKE es comodín de un carácter — ver AGENTS.md.
    .where(
      and(
        sql`starts_with(${movimientosInventario.motivo}::text, 'salida_')`,
        sql`${movimientosInventario.fecha_creacion} >= now() - make_interval(days => ${dias})`
      )
    )
    .groupBy(movimientosInventario.motivo)
    .orderBy(sql`sum(abs(${movimientosInventario.cantidad})) desc`);
}

export type FeriaSinCerrar = { evento: string; primeraSalida: Date; diasAbierta: number };

/**
 * Eventos con `salida_evento` y NINGÚN `ingreso_devolucion` con el mismo
 * texto de `evento`, abiertos hace más de `diasUmbral` días.
 *
 * Es la mitigación acordada por modelar la feria como dos movimientos sueltos
 * en vez de una consignación con su propio estado — ver
 * PLAN-INVENTARIO-MARKETING.md. Sin este reporte, una feria sin cerrar deja
 * el stock bajo para siempre y nadie se entera hasta el conteo físico.
 */
export async function getFeriasSinCerrar(diasUmbral = 7): Promise<FeriaSinCerrar[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeGestionarInventario(sesion)) return [];

  const filas = await db
    .select({
      evento: movimientosInventario.evento,
      primeraSalida: sql<string>`min(${movimientosInventario.fecha_creacion})`,
    })
    .from(movimientosInventario)
    .where(
      and(
        isNotNull(movimientosInventario.evento),
        or(
          eq(movimientosInventario.motivo, "salida_evento"),
          eq(movimientosInventario.motivo, "ingreso_devolucion")
        )
      )
    )
    .groupBy(movimientosInventario.evento)
    .having(
      sql`bool_or(${movimientosInventario.motivo} = 'ingreso_devolucion') = false
          and min(${movimientosInventario.fecha_creacion}) < now() - make_interval(days => ${diasUmbral})`
    )
    .orderBy(sql`min(${movimientosInventario.fecha_creacion})`);

  const ahora = Date.now();
  return filas
    .filter((f): f is { evento: string; primeraSalida: string } => f.evento !== null)
    .map((f) => {
      const primeraSalida = new Date(f.primeraSalida);
      return {
        evento: f.evento,
        primeraSalida,
        diasAbierta: Math.floor((ahora - primeraSalida.getTime()) / 86_400_000),
      };
    });
}
