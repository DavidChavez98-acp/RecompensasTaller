/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Catálogo de premios e inventario de marketing.
 *
 * ── Regla de exposición ──
 * Al CLIENTE nunca se le envía la cantidad exacta de stock, solo
 * `disponible: boolean`. "Quedan 3 gorras" expondría el inventario de marketing
 * a cualquiera con la app y provocaría carreras por las últimas unidades.
 * Un premio agotado se sigue viendo, marcado como tal, para que quien esté
 * ahorrando puntos sepa que existe.
 */

"use server";

import { db } from "@/db";
import { articulos, premios } from "@/db/schema";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSesionInterna } from "./auth-interno";
import { puedeGestionarInventario, puedeGestionarPremios } from "@/lib/authz";
import { premioSchema, ajustarStockSchema, type PremioInput } from "@/lib/validations";
import { logAdminAction } from "@/lib/admin-audit";
import { aplicarMovimientoInventario, aplicarMovimientoInventarioEnTx } from "@/lib/inventario";
import { avisarStockBajo } from "@/lib/stock-alertas.server";
import type { TipoPremio } from "@/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Vista del cliente
// ─────────────────────────────────────────────────────────────────────────────

export type PremioCatalogo = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  tipo: TipoPremio;
  costoPuntos: number;
  imagenUrl: string | null;
  /** Calculado en el servidor. La cantidad exacta NUNCA sale de aquí. */
  disponible: boolean;
};

export async function listarCatalogo(): Promise<PremioCatalogo[]> {
  const ahora = new Date();

  const filas = await db
    .select({
      id: premios.id,
      codigo: premios.codigo,
      nombre: premios.nombre,
      descripcion: premios.descripcion,
      tipo: premios.tipo,
      costoPuntos: premios.costo_puntos,
      imagenUrl: premios.imagen_url,
      // stock del ARTÍCULO enlazado, no de `premios.stock` (deprecado). NULL
      // cuando no hay artículo (servicio: no se agota).
      stock: articulos.stock_cache,
    })
    .from(premios)
    .leftJoin(articulos, eq(articulos.id, premios.articulo_id))
    .where(
      and(
        eq(premios.activo, true),
        or(isNull(premios.visible_desde), lte(premios.visible_desde, ahora)),
        or(isNull(premios.visible_hasta), sql`${premios.visible_hasta} > ${ahora}`)
      )
    )
    .orderBy(asc(premios.orden), asc(premios.costo_puntos));

  return filas.map(({ stock, ...premio }) => ({
    ...premio,
    // stock null = servicio (no se agota). stock > 0 = hay unidades.
    disponible: stock === null || stock > 0,
  }));
}

export async function getPremioCatalogo(premioId: string): Promise<PremioCatalogo | null> {
  const catalogo = await listarCatalogo();
  return catalogo.find((p) => p.id === premioId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vista interna
// ─────────────────────────────────────────────────────────────────────────────

export type PremioAdmin = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  tipo: TipoPremio;
  costoPuntos: number;
  stock: number | null;
  stockMinimoAlerta: number | null;
  activo: boolean;
  orden: number;
};

export async function listarPremiosAdmin(): Promise<PremioAdmin[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeGestionarPremios(sesion)) return [];

  return db
    .select({
      id: premios.id,
      codigo: premios.codigo,
      nombre: premios.nombre,
      descripcion: premios.descripcion,
      tipo: premios.tipo,
      costoPuntos: premios.costo_puntos,
      stock: articulos.stock_cache,
      stockMinimoAlerta: articulos.stock_minimo_alerta,
      activo: premios.activo,
      orden: premios.orden,
    })
    .from(premios)
    .leftJoin(articulos, eq(articulos.id, premios.articulo_id))
    .orderBy(asc(premios.orden), asc(premios.nombre));
}

export async function crearPremio(
  entrada: PremioInput
): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarPremios(sesion)) {
    return { ok: false, error: "Tu rol no permite gestionar el catálogo." };
  }

  const parsed = premioSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  const [existente] = await db
    .select({ id: premios.id })
    .from(premios)
    .where(eq(premios.codigo, datos.codigo))
    .limit(1);

  if (existente) return { ok: false, error: `Ya existe un premio con el código ${datos.codigo}.` };

  /*
   * Un merchandising EXIGE un artículo enlazado (lo impone
   * `premios_articulo_segun_tipo`, ver drizzle/0005_backfill_articulos.sql).
   * Se crea aquí, en la misma transacción que el premio: sin eso, un premio
   * merchandising podría quedar un instante sin inventario que representar.
   *
   * El código del artículo reutiliza el del premio — son namespaces UNIQUE
   * distintos, no colisionan — así que "GORRA" es reconocible como el mismo
   * objeto en las dos tablas sin inventar un mapeo.
   */
  const creadoId = await db.transaction(async (tx) => {
    let articuloId: string | null = null;

    if (datos.tipo === "merchandising") {
      const [articulo] = await tx
        .insert(articulos)
        .values({
          codigo: datos.codigo,
          nombre: datos.nombre,
          stock_cache: 0,
          stock_minimo_alerta: datos.stock_minimo_alerta,
          sucursal_id: sesion.sucursal_id,
        })
        .returning({ id: articulos.id });
      if (!articulo) throw new Error("No se pudo crear el artículo del inventario.");
      articuloId = articulo.id;

      // Stock inicial declarado por el admin, si lo hay. Va por el ledger para
      // que quede explicado en vez de escrito a mano en el caché.
      if (datos.stock && datos.stock > 0) {
        const movimiento = await aplicarMovimientoInventarioEnTx(tx, {
          articuloId,
          motivo: "ajuste_conteo",
          cantidad: datos.stock,
          motivoTexto: "Alta inicial del premio en el catálogo",
          creadoPorId: sesion.id,
          creadoPorNombre: sesion.nombre,
          creadoPorRol: sesion.role,
        });
        if (!movimiento.ok) throw new Error("No se pudo registrar el stock inicial.");
      }
    }

    const [creado] = await tx
      .insert(premios)
      .values({
        codigo: datos.codigo,
        nombre: datos.nombre,
        descripcion: datos.descripcion || null,
        tipo: datos.tipo,
        costo_puntos: datos.costo_puntos,
        articulo_id: articuloId,
        activo: datos.activo,
        sucursal_id: sesion.sucursal_id,
      })
      .returning({ id: premios.id });

    return creado?.id ?? null;
  });

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "premio_creado",
    "premios",
    creadoId,
    { ...datos }
  );

  revalidatePath("/interno/premios");
  revalidatePath("/premios");
  return { ok: true };
}

export async function actualizarPremio(
  premioId: string,
  entrada: PremioInput
): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarPremios(sesion)) {
    return { ok: false, error: "Tu rol no permite gestionar el catálogo." };
  }

  const parsed = premioSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  const [anterior] = await db.select().from(premios).where(eq(premios.id, premioId)).limit(1);
  if (!anterior) return { ok: false, error: "Ese premio no existe." };

  /*
   * El formulario deshabilita el campo `tipo` al editar (ver GestionPremios.tsx:
   * "el tipo no se cambia después de crear el premio"), pero eso es cosmético —
   * cualquiera puede llamar a esta acción directamente. Server-side es donde
   * cuenta: cambiar de tipo dejaría un merchandising sin artículo enlazado o un
   * servicio con uno de sobra, violando `premios_articulo_segun_tipo`.
   */
  if (datos.tipo !== anterior.tipo) {
    return { ok: false, error: "El tipo de premio no se puede cambiar después de creado." };
  }

  await db
    .update(premios)
    .set({
      codigo: datos.codigo,
      nombre: datos.nombre,
      descripcion: datos.descripcion || null,
      costo_puntos: datos.costo_puntos,
      // El stock NO se edita aquí: para eso está `ajustarStock`, que exige
      // motivo y deja rastro en auditoría. Cambiarlo desde el formulario
      // general permitiría "corregir" un descuadre sin explicar por qué.
      activo: datos.activo,
      fecha_actualizacion: new Date(),
    })
    .where(eq(premios.id, premioId));

  // El umbral de alerta vive en el ARTÍCULO, no en el premio (deprecado):
  // aquí es donde `avisarStockBajo` lo lee de verdad.
  if (anterior.articulo_id) {
    await db
      .update(articulos)
      .set({ stock_minimo_alerta: datos.stock_minimo_alerta, fecha_actualizacion: new Date() })
      .where(eq(articulos.id, anterior.articulo_id));
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "premio_actualizado",
    "premios",
    premioId,
    { antes: { nombre: anterior.nombre, costo: anterior.costo_puntos, activo: anterior.activo }, despues: datos }
  );

  revalidatePath("/interno/premios");
  revalidatePath("/premios");
  return { ok: true };
}

/**
 * Ajuste explícito de inventario, siempre con motivo.
 *
 * Es la única vía para mover el stock a mano (recepción de mercadería, merma,
 * corrección de conteo). El movimiento automático —reservar al aprobar,
 * devolver al cancelar— lo hace `canjes.ts`.
 */
export async function ajustarStock(entrada: {
  premio_id: string;
  cantidad: number;
  motivo: string;
}): Promise<{ ok: boolean; error?: string; stockNuevo?: number }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarInventario(sesion)) {
    return { ok: false, error: "Tu rol no permite ajustar inventario." };
  }

  const parsed = ajustarStockSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  const [premio] = await db.select().from(premios).where(eq(premios.id, datos.premio_id)).limit(1);
  if (!premio) return { ok: false, error: "Ese premio no existe." };
  if (!premio.articulo_id) {
    return { ok: false, error: "Los servicios no llevan inventario." };
  }

  // Va por el ledger de inventario, no por un UPDATE directo a `premios.stock`
  // (deprecado): es la misma primitiva atómica que usa cualquier otro
  // movimiento, con el mismo UPDATE condicional contra negativos.
  const movimiento = await aplicarMovimientoInventario({
    articuloId: premio.articulo_id,
    motivo: "ajuste_conteo",
    cantidad: datos.cantidad,
    motivoTexto: datos.motivo,
    creadoPorId: sesion.id,
    creadoPorNombre: sesion.nombre,
    creadoPorRol: sesion.role,
  });

  if (!movimiento.ok) {
    if (movimiento.motivo === "stock_insuficiente") {
      return { ok: false, error: `No hay tantas unidades: quedan ${movimiento.stockActual ?? 0}.` };
    }
    return { ok: false, error: movimiento.detalle ?? "No se pudo ajustar el inventario." };
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "stock_ajustado",
    "premios",
    datos.premio_id,
    { cantidad: datos.cantidad, motivo: datos.motivo, stockNuevo: movimiento.stockPosterior },
  );

  await avisarStockBajo(premio.id);

  revalidatePath("/interno/premios");
  revalidatePath("/premios");
  return { ok: true, stockNuevo: movimiento.stockPosterior };
}
