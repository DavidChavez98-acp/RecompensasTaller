/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Flujo del canje: el cliente pide, el Jefe aprueba contra bodega, el Asesor
 * entrega. Ver `src/lib/canje-estado.ts` para la máquina de estados y el
 * porqué de cada momento.
 *
 * ── Orden de operaciones ante un fallo a medias ──
 * Ninguna secuencia de dos escrituras es atómica si cruzan transacciones
 * distintas, así que el orden se elige por a quién perjudica el fallo:
 *
 *  · DEVOLVER puntos (rechazo/cancelación): primero el abono, después el
 *    cambio de estado. Si el proceso muere en medio, el cliente ya tiene sus
 *    puntos y el canje se resuelve al reintentar. El índice único
 *    `(canje_id) WHERE tipo='reverso'` impide abonar dos veces.
 *
 *  · COBRAR puntos (solicitud): primero la fila del canje, después el cobro,
 *    y si el cobro falla se borra el canje. La ventana es de milisegundos, y
 *    `aprobarCanje` verifica igualmente que exista el débito antes de
 *    comprometer inventario — un canje sin cobro no se aprueba.
 *
 * Las transiciones de estado usan guardia optimista
 * (`WHERE id = ? AND estado = ?`): dos jefes aprobando a la vez producen
 * exactamente un cambio, y el segundo recibe "ya fue procesado".
 */

"use server";

import { db } from "@/db";
import { canjeHistorial, canjes, clientes, premios, puntosTransacciones, users } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSesionCliente } from "./auth-cliente";
import { getSesionInterna } from "./auth-interno";
import { aplicarMovimiento } from "@/lib/saldo";
import {
  aprobarCanjeAtomico,
  crearCanjeIdempotente,
  descartarCanjeSinCobro,
} from "@/lib/canje-operaciones";
import { generarCodigoEntrega } from "@/lib/otp";
import {
  MOTIVOS_RECHAZO,
  puedeTransicionar,
  type Actor,
  type MotivoRechazo,
} from "@/lib/canje-estado";
import { entregarCanjeSchema, solicitarCanjeSchema } from "@/lib/validations";
import { sendEmail, getBaseUrl } from "@/lib/mail";
import { decryptNullableField } from "@/lib/pii-crypto";
import { logAdminAction } from "@/lib/admin-audit";
import type { EstadoCanje } from "@/db/schema";

async function registrarHistorial(params: {
  canjeId: string;
  anterior: EstadoCanje | null;
  nuevo: EstadoCanje;
  actorTipo: "cliente" | "usuario" | "sistema";
  actorId: string | null;
  actorNombre: string;
  comentario?: string | null;
}) {
  await db.insert(canjeHistorial).values({
    canje_id: params.canjeId,
    estado_anterior: params.anterior,
    estado_nuevo: params.nuevo,
    actor_tipo: params.actorTipo,
    actor_id: params.actorId,
    actor_nombre: params.actorNombre,
    comentario: params.comentario ?? null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente: solicitar
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoSolicitud =
  | { ok: true; canjeId: string; saldoNuevo: number }
  | { ok: false; error: string };

export async function solicitarCanje(entrada: {
  premio_id: string;
  idempotency_key: string;
}): Promise<ResultadoSolicitud> {
  const sesion = await getSesionCliente();
  if (!sesion) return { ok: false, error: "Tu sesión venció. Vuelve a entrar." };

  const parsed = solicitarCanjeSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: "Solicitud inválida." };
  const datos = parsed.data;

  const [premio] = await db.select().from(premios).where(eq(premios.id, datos.premio_id)).limit(1);
  if (!premio || !premio.activo) {
    return { ok: false, error: "Ese premio ya no está disponible." };
  }

  // La interfaz deshabilita el botón de un premio agotado, pero la interfaz
  // nunca es la defensa: alguien puede llamar a esta acción directamente.
  if (premio.stock !== null && premio.stock <= 0) {
    return { ok: false, error: "Ese premio está agotado por ahora." };
  }

  if (sesion.saldo < premio.costo_puntos) {
    const faltan = premio.costo_puntos - sesion.saldo;
    return { ok: false, error: `Te faltan ${faltan} puntos para este premio.` };
  }

  // Idempotencia por gesto: un doble toque manda la misma clave y recupera el
  // canje ya creado en vez de crear otro (y cobrar dos veces).
  const creado = await crearCanjeIdempotente({
    clienteId: sesion.clienteId,
    premioId: premio.id,
    premioNombre: premio.nombre,
    costoPuntos: premio.costo_puntos,
    idempotencyKey: datos.idempotency_key,
    sucursalId: premio.sucursal_id,
  });

  if (!creado) {
    return { ok: false, error: "No pudimos registrar tu canje. Inténtalo de nuevo." };
  }

  if (creado.yaExistia) {
    return { ok: true, canjeId: creado.canjeId, saldoNuevo: sesion.saldo };
  }

  const movimiento = await aplicarMovimiento({
    clienteId: sesion.clienteId,
    tipo: "canje",
    puntos: -premio.costo_puntos,
    canjeId: creado.canjeId,
    motivo: `Canje de ${premio.nombre}`,
  });

  if (!movimiento.ok) {
    // El cobro no entró: la fila del canje no puede quedarse suelta o el Jefe
    // vería en la cola un premio que nadie pagó.
    await descartarCanjeSinCobro(creado.canjeId);

    if (movimiento.motivo === "saldo_insuficiente") {
      return { ok: false, error: "Tus puntos no alcanzan. Puede que otro canje se haya procesado antes." };
    }
    return { ok: false, error: "No pudimos descontar tus puntos. Inténtalo de nuevo." };
  }

  await registrarHistorial({
    canjeId: creado.canjeId,
    anterior: null,
    nuevo: "solicitado",
    actorTipo: "cliente",
    actorId: sesion.clienteId,
    actorNombre: sesion.nombres,
  });

  await avisarCanjeSolicitado(creado.canjeId, premio.nombre, sesion.nombres);

  revalidatePath("/canjes");
  revalidatePath("/premios");
  revalidatePath("/interno/canjes");

  return { ok: true, canjeId: creado.canjeId, saldoNuevo: movimiento.saldoPosterior };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente: cancelar
// ─────────────────────────────────────────────────────────────────────────────

export async function cancelarCanje(canjeId: string): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionCliente();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };

  const [canje] = await db.select().from(canjes).where(eq(canjes.id, canjeId)).limit(1);
  if (!canje) return { ok: false, error: "Ese canje no existe." };

  const actor: Actor = { tipo: "cliente", clienteId: sesion.clienteId };
  const permiso = puedeTransicionar(actor, canje, "cancelado");
  if (!permiso.permitido) return { ok: false, error: permiso.motivo };

  // Primero devolver los puntos (ver nota de orden en la cabecera).
  const reverso = await aplicarMovimiento({
    clienteId: canje.cliente_id,
    tipo: "reverso",
    puntos: canje.costo_puntos,
    canjeId: canje.id,
    motivo: "Canje cancelado por el cliente",
  });

  if (!reverso.ok && reverso.motivo !== "duplicado") {
    return { ok: false, error: "No pudimos devolver tus puntos. Inténtalo de nuevo." };
  }

  const filas = await db
    .update(canjes)
    .set({ estado: "cancelado", cerrado_en: new Date(), motivo_cierre: "Cancelado por el cliente", fecha_actualizacion: new Date() })
    .where(and(eq(canjes.id, canje.id), eq(canjes.estado, "solicitado")))
    .returning({ id: canjes.id });

  if (filas.length === 0) {
    return { ok: false, error: "Este canje ya fue procesado por el taller." };
  }

  await registrarHistorial({
    canjeId: canje.id,
    anterior: "solicitado",
    nuevo: "cancelado",
    actorTipo: "cliente",
    actorId: sesion.clienteId,
    actorNombre: sesion.nombres,
  });

  revalidatePath("/canjes");
  revalidatePath("/interno/canjes");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Taller: aprobar
// ─────────────────────────────────────────────────────────────────────────────

export async function aprobarCanje(
  canjeId: string
): Promise<{ ok: boolean; error?: string; codigoEntrega?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };

  const [canje] = await db.select().from(canjes).where(eq(canjes.id, canjeId)).limit(1);
  if (!canje) return { ok: false, error: "Ese canje no existe." };

  const permiso = puedeTransicionar({ tipo: "usuario", sesion }, canje, "aprobado");
  if (!permiso.permitido) return { ok: false, error: permiso.motivo };

  // Un canje sin débito registrado sería un premio gratis. Solo puede ocurrir
  // si el proceso murió entre crear la fila y cobrar; nunca se aprueba.
  const [debito] = await db
    .select({ id: puntosTransacciones.id })
    .from(puntosTransacciones)
    .where(and(eq(puntosTransacciones.canje_id, canje.id), eq(puntosTransacciones.tipo, "canje")))
    .limit(1);

  if (!debito) {
    return { ok: false, error: "Este canje no tiene el cobro de puntos registrado. Recházalo y pide al cliente que lo solicite de nuevo." };
  }

  const codigoEntrega = generarCodigoEntrega();

  // La parte atómica vive en lib/canje-operaciones.ts para poder probarla bajo
  // concurrencia real sin necesitar una sesión (ver pnpm test:canjes).
  const resultado = await aprobarCanjeAtomico({
    canjeId: canje.id,
    premioId: canje.premio_id,
    usuarioId: sesion.id,
    codigoEntrega,
  });

  if (!resultado.ok) {
    if (resultado.motivo === "ya_procesado") {
      return { ok: false, error: "Este canje ya fue procesado por otro usuario." };
    }
    return {
      ok: false,
      error: "Ya no queda stock de ese premio. Recházalo para devolverle los puntos al cliente.",
    };
  }

  await registrarHistorial({
    canjeId: canje.id,
    anterior: "solicitado",
    nuevo: "aprobado",
    actorTipo: "usuario",
    actorId: sesion.id,
    actorNombre: sesion.nombre,
  });

  await avisarCanjeAprobado(canje.id);

  const { avisarStockBajo } = await import("./premios");
  await avisarStockBajo(canje.premio_id);

  revalidatePath("/interno/canjes");
  revalidatePath("/canjes");
  return { ok: true, codigoEntrega };
}

// ─────────────────────────────────────────────────────────────────────────────
// Taller: rechazar
// ─────────────────────────────────────────────────────────────────────────────

export async function rechazarCanje(
  canjeId: string,
  motivo: MotivoRechazo
): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };

  const [canje] = await db.select().from(canjes).where(eq(canjes.id, canjeId)).limit(1);
  if (!canje) return { ok: false, error: "Ese canje no existe." };

  const permiso = puedeTransicionar({ tipo: "usuario", sesion }, canje, "rechazado");
  if (!permiso.permitido) return { ok: false, error: permiso.motivo };

  const texto = MOTIVOS_RECHAZO[motivo] ?? MOTIVOS_RECHAZO.otro;

  const reverso = await aplicarMovimiento({
    clienteId: canje.cliente_id,
    tipo: "reverso",
    puntos: canje.costo_puntos,
    canjeId: canje.id,
    motivo: `Canje rechazado: ${motivo}`,
    creadoPorId: sesion.id,
    creadoPorNombre: sesion.nombre,
    creadoPorRol: sesion.role,
  });

  if (!reverso.ok && reverso.motivo !== "duplicado") {
    return { ok: false, error: "No pudimos devolver los puntos al cliente." };
  }

  const filas = await db
    .update(canjes)
    .set({
      estado: "rechazado",
      cerrado_en: new Date(),
      cerrado_por_id: sesion.id,
      motivo_cierre: texto,
      fecha_actualizacion: new Date(),
    })
    .where(and(eq(canjes.id, canje.id), eq(canjes.estado, "solicitado")))
    .returning({ id: canjes.id });

  if (filas.length === 0) {
    return { ok: false, error: "Este canje ya fue procesado por otro usuario." };
  }

  await registrarHistorial({
    canjeId: canje.id,
    anterior: "solicitado",
    nuevo: "rechazado",
    actorTipo: "usuario",
    actorId: sesion.id,
    actorNombre: sesion.nombre,
    comentario: texto,
  });

  await avisarCanjeRechazado(canje.id, texto);

  revalidatePath("/interno/canjes");
  revalidatePath("/canjes");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Taller: entregar
// ─────────────────────────────────────────────────────────────────────────────

export async function entregarCanje(entrada: {
  canje_id: string;
  codigo_entrega: string;
}): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };

  const parsed = entregarCanjeSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Código inválido." };
  }

  const [canje] = await db.select().from(canjes).where(eq(canjes.id, parsed.data.canje_id)).limit(1);
  if (!canje) return { ok: false, error: "Ese canje no existe." };

  const permiso = puedeTransicionar({ tipo: "usuario", sesion }, canje, "entregado");
  if (!permiso.permitido) return { ok: false, error: permiso.motivo };

  // El código va en el WHERE, no en un `if` previo: la comparación la hace
  // Postgres sobre la fila, y no hay ventana entre comprobar y escribir.
  const filas = await db
    .update(canjes)
    .set({
      estado: "entregado",
      entregado_en: new Date(),
      entregado_por_id: sesion.id,
      fecha_actualizacion: new Date(),
    })
    .where(
      and(
        eq(canjes.id, canje.id),
        eq(canjes.estado, "aprobado"),
        eq(canjes.codigo_entrega, parsed.data.codigo_entrega)
      )
    )
    .returning({ id: canjes.id });

  if (filas.length === 0) {
    return { ok: false, error: "El código no coincide. Pídele al cliente el que ve en su app." };
  }

  await registrarHistorial({
    canjeId: canje.id,
    anterior: "aprobado",
    nuevo: "entregado",
    actorTipo: "usuario",
    actorId: sesion.id,
    actorNombre: sesion.nombre,
  });

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "canje_entregado",
    "canjes",
    canje.id,
    { premio: canje.premio_nombre, puntos: canje.costo_puntos }
  );

  revalidatePath("/interno/canjes");
  revalidatePath("/canjes");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecturas
// ─────────────────────────────────────────────────────────────────────────────

export type CanjeCliente = {
  id: string;
  premioNombre: string;
  costoPuntos: number;
  estado: EstadoCanje;
  codigoEntrega: string | null;
  solicitadoEn: Date;
  motivoCierre: string | null;
};

export async function listarMisCanjes(): Promise<CanjeCliente[]> {
  const sesion = await getSesionCliente();
  if (!sesion) return [];

  return db
    .select({
      id: canjes.id,
      premioNombre: canjes.premio_nombre,
      costoPuntos: canjes.costo_puntos,
      estado: canjes.estado,
      codigoEntrega: canjes.codigo_entrega,
      solicitadoEn: canjes.solicitado_en,
      motivoCierre: canjes.motivo_cierre,
    })
    .from(canjes)
    .where(eq(canjes.cliente_id, sesion.clienteId))
    .orderBy(desc(canjes.solicitado_en))
    .limit(50);
}

export type CanjeInterno = CanjeCliente & {
  clienteId: string;
  clienteNombre: string;
  clienteVerificado: boolean;
  stockActual: number | null;
};

export async function listarCanjesPendientes(): Promise<CanjeInterno[]> {
  const sesion = await getSesionInterna();
  if (!sesion) return [];

  const filas = await db
    .select({
      id: canjes.id,
      premioNombre: canjes.premio_nombre,
      costoPuntos: canjes.costo_puntos,
      estado: canjes.estado,
      codigoEntrega: canjes.codigo_entrega,
      solicitadoEn: canjes.solicitado_en,
      motivoCierre: canjes.motivo_cierre,
      clienteId: clientes.id,
      clienteNombre: clientes.nombres,
      clienteVerificado: clientes.verificado,
      stockActual: premios.stock,
    })
    .from(canjes)
    .innerJoin(clientes, eq(clientes.id, canjes.cliente_id))
    .innerJoin(premios, eq(premios.id, canjes.premio_id))
    .where(isNull(canjes.cerrado_en))
    .orderBy(desc(canjes.solicitado_en))
    .limit(100);

  return filas.filter((f) => f.estado === "solicitado" || f.estado === "aprobado");
}

// ─────────────────────────────────────────────────────────────────────────────
// Avisos por correo (best-effort: nunca tumban la operación)
// ─────────────────────────────────────────────────────────────────────────────

async function emailDelCliente(clienteId: string): Promise<string | null> {
  const [fila] = await db
    .select({ email: clientes.email })
    .from(clientes)
    .where(eq(clientes.id, clienteId))
    .limit(1);
  return decryptNullableField(fila?.email ?? null);
}

async function avisarCanjeSolicitado(canjeId: string, premio: string, cliente: string) {
  try {
    const destinatarios = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.activo, true), eq(users.notif_canje_solicitado, true)));

    const correos = destinatarios.map((d) => d.email).filter((e): e is string => !!e);
    if (correos.length === 0) return;

    await sendEmail({
      to: correos,
      subject: `Nuevo canje por aprobar: ${premio}`,
      html: `
        <p><strong>${cliente}</strong> solicitó <strong>${premio}</strong>.</p>
        <p>Revisa que tengas el premio en bodega antes de aprobar.</p>
        <p><a href="${getBaseUrl()}/interno/canjes">Ver la cola de canjes</a></p>
      `,
      text: `${cliente} solicitó ${premio}. Revisa la cola en ${getBaseUrl()}/interno/canjes`,
    });
  } catch (error) {
    console.error("Aviso de canje solicitado:", (error as Error)?.message, canjeId);
  }
}

async function avisarCanjeAprobado(canjeId: string) {
  try {
    const [canje] = await db.select().from(canjes).where(eq(canjes.id, canjeId)).limit(1);
    if (!canje) return;

    const email = await emailDelCliente(canje.cliente_id);
    if (!email) return;

    await sendEmail({
      to: email,
      subject: `Tu ${canje.premio_nombre} está listo`,
      html: `
        <p>Ya puedes retirar tu <strong>${canje.premio_nombre}</strong> en el taller.</p>
        <p>Muestra este código al asesor:</p>
        <p style="font-size:28px;letter-spacing:8px;font-weight:700;">${canje.codigo_entrega}</p>
      `,
      text: `Tu ${canje.premio_nombre} está listo. Código de retiro: ${canje.codigo_entrega}`,
    });
  } catch (error) {
    console.error("Aviso de canje aprobado:", (error as Error)?.message, canjeId);
  }
}

async function avisarCanjeRechazado(canjeId: string, texto: string) {
  try {
    const [canje] = await db.select().from(canjes).where(eq(canjes.id, canjeId)).limit(1);
    if (!canje) return;

    const email = await emailDelCliente(canje.cliente_id);
    if (!email) return;

    await sendEmail({
      to: email,
      subject: `Sobre tu canje de ${canje.premio_nombre}`,
      html: `
        <p>No pudimos entregarte <strong>${canje.premio_nombre}</strong>.</p>
        <p>${texto}</p>
        <p>Tus ${canje.costo_puntos} puntos ya están de vuelta en tu cuenta.</p>
      `,
      text: `${texto} Tus ${canje.costo_puntos} puntos ya están de vuelta.`,
    });
  } catch (error) {
    console.error("Aviso de canje rechazado:", (error as Error)?.message, canjeId);
  }
}
