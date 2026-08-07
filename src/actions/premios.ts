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
import { premios, users } from "@/db/schema";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSesionInterna } from "./auth-interno";
import { puedeGestionarPremios } from "@/lib/authz";
import { premioSchema, ajustarStockSchema, type PremioInput } from "@/lib/validations";
import { logAdminAction } from "@/lib/admin-audit";
import { sendEmail, getBaseUrl } from "@/lib/mail";
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
      stock: premios.stock,
    })
    .from(premios)
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
      stock: premios.stock,
      stockMinimoAlerta: premios.stock_minimo_alerta,
      activo: premios.activo,
      orden: premios.orden,
    })
    .from(premios)
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

  const [creado] = await db
    .insert(premios)
    .values({
      codigo: datos.codigo,
      nombre: datos.nombre,
      descripcion: datos.descripcion || null,
      tipo: datos.tipo,
      costo_puntos: datos.costo_puntos,
      stock: datos.stock,
      stock_minimo_alerta: datos.stock_minimo_alerta,
      activo: datos.activo,
      sucursal_id: sesion.sucursal_id,
    })
    .returning({ id: premios.id });

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "premio_creado",
    "premios",
    creado?.id ?? null,
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

  await db
    .update(premios)
    .set({
      codigo: datos.codigo,
      nombre: datos.nombre,
      descripcion: datos.descripcion || null,
      tipo: datos.tipo,
      costo_puntos: datos.costo_puntos,
      // El stock NO se edita aquí: para eso está `ajustarStock`, que exige
      // motivo y deja rastro en auditoría. Cambiarlo desde el formulario
      // general permitiría "corregir" un descuadre sin explicar por qué.
      stock_minimo_alerta: datos.stock_minimo_alerta,
      activo: datos.activo,
      fecha_actualizacion: new Date(),
    })
    .where(eq(premios.id, premioId));

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
  if (!puedeGestionarPremios(sesion)) {
    return { ok: false, error: "Tu rol no permite ajustar inventario." };
  }

  const parsed = ajustarStockSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  const [premio] = await db.select().from(premios).where(eq(premios.id, datos.premio_id)).limit(1);
  if (!premio) return { ok: false, error: "Ese premio no existe." };
  if (premio.stock === null) {
    return { ok: false, error: "Los servicios no llevan inventario." };
  }

  // UPDATE condicional, igual que el saldo de puntos: si dos personas de
  // marketing ajustan a la vez, la resta no puede dejar el stock negativo.
  const filas = await db
    .update(premios)
    .set({
      stock: sql`${premios.stock} + ${datos.cantidad}`,
      fecha_actualizacion: new Date(),
    })
    .where(
      and(
        eq(premios.id, datos.premio_id),
        datos.cantidad < 0
          ? sql`${premios.stock} >= ${-datos.cantidad}`
          : sql`${premios.stock} IS NOT NULL`
      )
    )
    .returning({ stock: premios.stock });

  const fila = filas[0];
  if (!fila) {
    return { ok: false, error: `No hay tantas unidades: quedan ${premio.stock}.` };
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "stock_ajustado",
    "premios",
    datos.premio_id,
    { cantidad: datos.cantidad, motivo: datos.motivo, stockAnterior: premio.stock, stockNuevo: fila.stock },
  );

  await avisarStockBajo(premio.id);

  revalidatePath("/interno/premios");
  revalidatePath("/premios");
  return { ok: true, stockNuevo: fila.stock ?? 0 };
}

/**
 * Avisa por correo al Admin cuando un merchandising baja del umbral.
 *
 * Best-effort: un fallo de correo nunca debe tumbar la operación que ya se
 * ejecutó. Mismo criterio que `logAdminAction`.
 */
export async function avisarStockBajo(premioId: string): Promise<void> {
  try {
    const [premio] = await db.select().from(premios).where(eq(premios.id, premioId)).limit(1);
    if (!premio || premio.stock === null || premio.stock_minimo_alerta === null) return;
    if (premio.stock > premio.stock_minimo_alerta) return;

    const destinatarios = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.activo, true), eq(users.notif_stock_bajo, true)));

    const correos = destinatarios.map((d) => d.email).filter((e): e is string => !!e);
    if (correos.length === 0) return;

    const agotado = premio.stock === 0;
    await sendEmail({
      to: correos,
      subject: agotado
        ? `Sin stock: ${premio.nombre}`
        : `Stock bajo: ${premio.nombre} (quedan ${premio.stock})`,
      html: `
        <p>${agotado ? "Se agotó" : "Está por agotarse"} un premio del catálogo:</p>
        <p><strong>${premio.nombre}</strong> — quedan ${premio.stock} unidad(es).</p>
        <p>Los clientes lo seguirán viendo marcado como agotado hasta que repongas.</p>
        <p><a href="${getBaseUrl()}/interno/premios">Ir al catálogo</a></p>
      `,
      text: `${premio.nombre}: quedan ${premio.stock} unidades.`,
    });
  } catch (error) {
    console.error("No se pudo avisar del stock bajo:", (error as Error)?.message);
  }
}
