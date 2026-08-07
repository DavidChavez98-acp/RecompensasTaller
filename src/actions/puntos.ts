/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * El bucle central del programa: el asesor escanea al cliente y acredita los
 * puntos del servicio.
 *
 * ── Por qué son DOS llamadas y no una ──
 * El asesor primero necesita ver a quién escaneó (para confirmar que es la
 * persona correcta) y solo después teclea el monto. Si la primera llamada
 * quemara el nonce y la segunda volviera a verificar el token, la segunda
 * fallaría siempre. Por eso `verificarQr` quema el nonce y emite un TICKET de 5
 * minutos, y `acreditarPuntos` consume ese ticket.
 *
 * El ticket va firmado y atado al asesor que escaneó: otro empleado no puede
 * robarlo del tráfico y acreditar en su lugar.
 */

"use server";

import { db } from "@/db";
import {
  clientes,
  puntosTransacciones,
  reglasPuntos,
  serviciosTipo,
  users,
} from "@/db/schema";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSesionInterna } from "./auth-interno";
import { getSesionCliente } from "./auth-cliente";
import { puedeAcreditarPuntos, puedeRevertirPuntos } from "@/lib/authz";
import { leerTokenQr, registrarEscaneo, resolverCodigoRespaldo } from "@/lib/qr-token.server";
import { aplicarMovimiento } from "@/lib/saldo";
import { calcularPuntos, explicarCalculo, reglaDesdeFila } from "@/lib/puntos-calculo";
import { acreditarPuntosSchema } from "@/lib/validations";
import { normalizeClientIp } from "@/lib/utils";
import { checkRateLimit } from "@/lib/rate-limit";
import { TICKET_ACREDITACION_MINUTOS } from "@/lib/constants";
import { logAdminAction } from "@/lib/admin-audit";
import type { TipoTransaccion } from "@/db/schema";

const TICKET_PURPOSE = "acreditacion";

let claveTicket: Uint8Array | null = null;
function getClaveTicket(): Uint8Array {
  if (claveTicket) return claveTicket;
  const secreto = process.env.ADMIN_SECRET;
  if (!secreto && process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SECRET debe estar configurado en producción.");
  }
  claveTicket = new TextEncoder().encode(secreto || "default_local_dev_key_INSECURE");
  return claveTicket;
}

export type ClienteEscaneado = {
  clienteId: string;
  nombres: string;
  saldo: number;
  verificado: boolean;
  /** Firmado, 5 minutos, atado a este asesor y a este escaneo. */
  ticket: string;
};

export type ServicioOpcion = {
  id: string;
  nombre: string;
  multiplicador: string;
};

export type ResultadoVerificacionQr =
  | { ok: true; cliente: ClienteEscaneado }
  | { ok: false; error: string; pista?: string };

async function emitirTicket(params: {
  escaneoId: string;
  clienteId: string;
  asesorId: string;
}): Promise<string> {
  return new SignJWT({ ...params, purpose: TICKET_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TICKET_ACREDITACION_MINUTOS}m`)
    .sign(getClaveTicket());
}

async function leerTicket(
  ticket: string
): Promise<{ escaneoId: string; clienteId: string; asesorId: string } | null> {
  try {
    const { payload } = await jwtVerify(ticket, getClaveTicket(), { algorithms: ["HS256"] });
    if (
      payload.purpose !== TICKET_PURPOSE ||
      typeof payload.escaneoId !== "string" ||
      typeof payload.clienteId !== "string" ||
      typeof payload.asesorId !== "string"
    ) {
      return null;
    }
    return {
      escaneoId: payload.escaneoId,
      clienteId: payload.clienteId,
      asesorId: payload.asesorId,
    };
  } catch {
    return null;
  }
}

async function cargarClienteParaEscaneo(clienteId: string, escaneoId: string, asesorId: string) {
  const [cliente] = await db
    .select({
      id: clientes.id,
      nombres: clientes.nombres,
      saldo: clientes.saldo_cache,
      verificado: clientes.verificado,
      activo: clientes.activo,
      anonimizado: clientes.anonimizado_en,
    })
    .from(clientes)
    .where(eq(clientes.id, clienteId))
    .limit(1);

  if (!cliente || !cliente.activo || cliente.anonimizado) return null;

  return {
    clienteId: cliente.id,
    nombres: cliente.nombres,
    saldo: cliente.saldo,
    verificado: cliente.verificado,
    ticket: await emitirTicket({ escaneoId, clienteId, asesorId }),
  } satisfies ClienteEscaneado;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — escanear
// ─────────────────────────────────────────────────────────────────────────────

export async function verificarQr(token: string): Promise<ResultadoVerificacionQr> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció. Vuelve a entrar." };
  if (!puedeAcreditarPuntos(sesion)) {
    return { ok: false, error: "Tu rol no permite acreditar puntos." };
  }

  const lectura = await leerTokenQr(token);

  if (!lectura.ok) {
    switch (lectura.motivo) {
      case "formato":
        return { ok: false, error: "Ese código no es de Recompensas Taller." };
      case "desconocido":
        return { ok: false, error: "Este código ya no es válido. Pídele al cliente que abra su app de nuevo." };
      case "firma":
        return { ok: false, error: "Código inválido." };
      case "fuera_de_ventana": {
        // Distinguir el reloj desfasado de un código inválido le da al asesor
        // algo accionable en vez de un error genérico.
        const pista =
          lectura.desfasePasos !== undefined && Math.abs(lectura.desfasePasos) > 5
            ? "El reloj del teléfono del cliente está desfasado. Pídele que active la hora automática."
            : "El código ya venció. Pídele que muestre el nuevo.";
        return { ok: false, error: "Código vencido.", pista };
      }
    }
  }

  // Quemar el nonce. A partir de aquí, este código no sirve para nadie más.
  const escaneo = await registrarEscaneo({
    dispositivoId: lectura.dispositivoId,
    paso: lectura.paso,
    usuarioId: sesion.id,
  });

  if (!escaneo.ok) {
    return {
      ok: false,
      error: "Este código ya fue usado.",
      pista: "Pídele al cliente que muestre el código nuevo de su pantalla.",
    };
  }

  const cliente = await cargarClienteParaEscaneo(lectura.clienteId, escaneo.escaneoId, sesion.id);
  if (!cliente) return { ok: false, error: "La cuenta de este cliente no está disponible." };

  return { ok: true, cliente };
}

/**
 * Camino alterno cuando la cámara no coopera: el asesor ya eligió al cliente
 * por nombre o cédula y teclea los 8 caracteres que este ve bajo su QR.
 */
export async function verificarCodigoTecleado(
  clienteId: string,
  codigo: string
): Promise<ResultadoVerificacionQr> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció. Vuelve a entrar." };
  if (!puedeAcreditarPuntos(sesion)) {
    return { ok: false, error: "Tu rol no permite acreditar puntos." };
  }

  // 40 bits de código tecleado necesitan rate limit propio: sin él, un empleado
  // podría probar combinaciones contra un cliente concreto.
  try {
    const h = await headers();
    const ip = normalizeClientIp(h.get("x-forwarded-for"));
    const limite = checkRateLimit(`codigo-tecleado:${ip}`, { limit: 15, windowMs: 5 * 60 * 1000 });
    if (limite.limited) {
      return { ok: false, error: `Demasiados intentos. Espera ${limite.resetSeconds} segundos.` };
    }
  } catch {
    // continuar
  }

  const resuelto = await resolverCodigoRespaldo(clienteId, codigo);
  if (!resuelto.ok) {
    return { ok: false, error: "Ese código no coincide.", pista: "Verifica que sea el que aparece bajo el QR del cliente." };
  }

  const escaneo = await registrarEscaneo({
    dispositivoId: resuelto.dispositivoId,
    paso: resuelto.paso,
    usuarioId: sesion.id,
  });

  if (!escaneo.ok) return { ok: false, error: "Este código ya fue usado." };

  const cliente = await cargarClienteParaEscaneo(clienteId, escaneo.escaneoId, sesion.id);
  if (!cliente) return { ok: false, error: "La cuenta de este cliente no está disponible." };

  return { ok: true, cliente };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — acreditar
// ─────────────────────────────────────────────────────────────────────────────

export async function getServiciosActivos(): Promise<ServicioOpcion[]> {
  return db
    .select({
      id: serviciosTipo.id,
      nombre: serviciosTipo.nombre,
      multiplicador: serviciosTipo.multiplicador,
    })
    .from(serviciosTipo)
    .where(eq(serviciosTipo.activo, true))
    .orderBy(serviciosTipo.orden);
}

async function getReglaVigente(sucursalId: string | null) {
  const [regla] = await db
    .select()
    .from(reglasPuntos)
    .where(
      and(
        isNull(reglasPuntos.vigente_hasta),
        sucursalId
          ? or(eq(reglasPuntos.sucursal_id, sucursalId), isNull(reglasPuntos.sucursal_id))
          : undefined
      )
    )
    // Ante varias vigentes, gana la más reciente. No debería pasar (editar una
    // regla cierra la anterior), pero el ledger no puede quedar sin regla.
    .orderBy(desc(reglasPuntos.vigente_desde))
    .limit(1);

  return regla ?? null;
}

export type ResultadoAcreditacion =
  | {
      ok: true;
      puntosAcreditados: number;
      saldoAnterior: number;
      saldoNuevo: number;
      explicacion: string;
      topeAplicado: boolean;
    }
  | { ok: false; error: string };

export async function acreditarPuntos(entrada: {
  ticket: string;
  monto: number;
  servicio_tipo_id: string;
  documento_referencia?: string;
}): Promise<ResultadoAcreditacion> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció. Vuelve a entrar." };
  if (!puedeAcreditarPuntos(sesion)) {
    return { ok: false, error: "Tu rol no permite acreditar puntos." };
  }

  const parsed = acreditarPuntosSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  const ticket = await leerTicket(datos.ticket);
  if (!ticket) {
    return { ok: false, error: "El escaneo venció. Vuelve a escanear al cliente." };
  }

  // El ticket está atado al asesor que escaneó: otro empleado no puede
  // interceptarlo y acreditar en su nombre.
  if (ticket.asesorId !== sesion.id) {
    return { ok: false, error: "Este escaneo pertenece a otro usuario." };
  }

  const [servicio] = await db
    .select()
    .from(serviciosTipo)
    .where(and(eq(serviciosTipo.id, datos.servicio_tipo_id), eq(serviciosTipo.activo, true)))
    .limit(1);

  if (!servicio) return { ok: false, error: "Ese tipo de servicio ya no está disponible." };

  const reglaFila = await getReglaVigente(sesion.sucursal_id);
  if (!reglaFila) {
    return { ok: false, error: "No hay una regla de puntos vigente. Avisa al administrador." };
  }

  // ── Antifraude: el asesor no puede acreditarse a sí mismo ──
  // Se compara por índice ciego, sin descifrar ninguna cédula.
  const [empleado] = await db
    .select({ idx: users.identificacion_idx })
    .from(users)
    .where(eq(users.id, sesion.id))
    .limit(1);

  if (empleado?.idx) {
    const [cliente] = await db
      .select({ idx: clientes.identificacion_idx })
      .from(clientes)
      .where(eq(clientes.id, ticket.clienteId))
      .limit(1);

    if (cliente?.idx === empleado.idx) {
      return { ok: false, error: "No puedes acreditarte puntos a ti mismo." };
    }
  }

  const regla = reglaDesdeFila(reglaFila);
  const multiplicador = Number(servicio.multiplicador);
  const calculo = calcularPuntos(datos.monto, regla, multiplicador);

  if (calculo.puntos <= 0) {
    return { ok: false, error: explicarCalculo(datos.monto, regla, multiplicador, calculo) };
  }

  const [saldoPrevio] = await db
    .select({ saldo: clientes.saldo_cache })
    .from(clientes)
    .where(eq(clientes.id, ticket.clienteId))
    .limit(1);

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = normalizeClientIp(h.get("x-forwarded-for"));
    userAgent = h.get("user-agent");
  } catch {
    // se guarda null
  }

  const movimiento = await aplicarMovimiento({
    clienteId: ticket.clienteId,
    tipo: "acreditacion",
    puntos: calculo.puntos,
    montoGastado: datos.monto.toFixed(2),
    servicioTipoId: servicio.id,
    multiplicadorAplicado: servicio.multiplicador,
    reglaId: reglaFila.id,
    // El UNIQUE parcial sobre escaneo_id es lo que impide que un doble clic o
    // un reintento de red acredite dos veces. No es lógica de aplicación.
    escaneoId: ticket.escaneoId,
    documentoReferencia: datos.documento_referencia || null,
    creadoPorId: sesion.id,
    creadoPorNombre: sesion.nombre,
    creadoPorRol: sesion.role,
    sucursalId: sesion.sucursal_id,
    ip,
    userAgent,
  });

  if (!movimiento.ok) {
    if (movimiento.motivo === "duplicado") {
      return { ok: false, error: "Este escaneo ya tiene puntos acreditados." };
    }
    return { ok: false, error: "No pudimos acreditar los puntos. Inténtalo de nuevo." };
  }

  if (calculo.topeAplicado) {
    // Un recorte por tope casi siempre es un dedazo en el monto. Queda en
    // auditoría para que el Jefe pueda revisarlo después.
    await logAdminAction(
      { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
      "acreditacion_topada",
      "puntos_transacciones",
      movimiento.transaccionId,
      { monto: datos.monto, puntosSinTope: calculo.puntosSinTope, puntosAcreditados: calculo.puntos }
    );
  }

  revalidatePath("/interno");

  return {
    ok: true,
    puntosAcreditados: calculo.puntos,
    saldoAnterior: saldoPrevio?.saldo ?? 0,
    saldoNuevo: movimiento.saldoPosterior,
    explicacion: explicarCalculo(datos.monto, regla, multiplicador, calculo),
    topeAplicado: calculo.topeAplicado,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reverso
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Corregir un error NO es modificar la fila original: el ledger es append-only
 * y un trigger de Postgres lo impide. Se inserta una fila de signo contrario, y
 * queda constancia de que hubo un error, de quién lo cometió y de quién lo
 * corrigió.
 */
export async function reversarAcreditacion(
  transaccionId: string,
  motivo: string
): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeRevertirPuntos(sesion)) {
    return { ok: false, error: "Solo el Jefe de Taller o el Admin pueden revertir." };
  }
  if (motivo.trim().length < 5) {
    return { ok: false, error: "Explica el motivo del reverso." };
  }

  const [original] = await db
    .select()
    .from(puntosTransacciones)
    .where(eq(puntosTransacciones.id, transaccionId))
    .limit(1);

  if (!original) return { ok: false, error: "Esa transacción no existe." };
  if (original.tipo === "reverso") return { ok: false, error: "No se puede revertir un reverso." };

  const movimiento = await aplicarMovimiento({
    clienteId: original.cliente_id,
    tipo: "reverso",
    puntos: -original.puntos,
    reversaDeId: original.id,
    motivo: motivo.trim(),
    creadoPorId: sesion.id,
    creadoPorNombre: sesion.nombre,
    creadoPorRol: sesion.role,
    sucursalId: sesion.sucursal_id,
  });

  if (!movimiento.ok) {
    if (movimiento.motivo === "duplicado") {
      return { ok: false, error: "Esta transacción ya fue revertida." };
    }
    if (movimiento.motivo === "saldo_insuficiente") {
      // El cliente ya gastó los puntos mal acreditados. Revertir dejaría el
      // saldo negativo, y el CHECK de la base lo impide. Es una decisión de
      // negocio, no un bug: el Jefe tiene que ajustar a mano.
      return {
        ok: false,
        error: "El cliente ya usó esos puntos. Registra un ajuste manual en su lugar.",
      };
    }
    return { ok: false, error: "No pudimos revertir la transacción." };
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "reverso_puntos",
    "puntos_transacciones",
    original.id,
    { puntos: -original.puntos, motivo }
  );

  revalidatePath("/interno");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Historial del cliente
// ─────────────────────────────────────────────────────────────────────────────

export type MovimientoCliente = {
  id: string;
  tipo: TipoTransaccion;
  puntos: number;
  saldoPosterior: number;
  fecha: Date;
  servicio: string | null;
  monto: string | null;
  motivo: string | null;
  documento: string | null;
};

/**
 * El ledger del cliente, tal cual. Es lo que responde "¿por qué tengo estos
 * puntos?" sin que tenga que llamar al taller — y lo que hace auditable el
 * programa desde el lado del cliente, no solo desde el nuestro.
 */
export async function listarMisMovimientos(limite = 50): Promise<MovimientoCliente[]> {
  const sesion = await getSesionCliente();
  if (!sesion) return [];

  return db
    .select({
      id: puntosTransacciones.id,
      tipo: puntosTransacciones.tipo,
      puntos: puntosTransacciones.puntos,
      saldoPosterior: puntosTransacciones.saldo_posterior,
      fecha: puntosTransacciones.fecha_creacion,
      servicio: serviciosTipo.nombre,
      monto: puntosTransacciones.monto_gastado,
      motivo: puntosTransacciones.motivo,
      documento: puntosTransacciones.documento_referencia,
    })
    .from(puntosTransacciones)
    .leftJoin(serviciosTipo, eq(serviciosTipo.id, puntosTransacciones.servicio_tipo_id))
    .where(eq(puntosTransacciones.cliente_id, sesion.clienteId))
    .orderBy(desc(puntosTransacciones.fecha_creacion))
    .limit(limite);
}

/** Últimas acreditaciones del asesor, para el resumen de su jornada. */
export async function getAcreditacionesRecientes(limite = 10) {
  const sesion = await getSesionInterna();
  if (!sesion) return [];

  return db
    .select({
      id: puntosTransacciones.id,
      puntos: puntosTransacciones.puntos,
      monto: puntosTransacciones.monto_gastado,
      fecha: puntosTransacciones.fecha_creacion,
      clienteNombre: clientes.nombres,
      servicio: serviciosTipo.nombre,
    })
    .from(puntosTransacciones)
    .innerJoin(clientes, eq(clientes.id, puntosTransacciones.cliente_id))
    .leftJoin(serviciosTipo, eq(serviciosTipo.id, puntosTransacciones.servicio_tipo_id))
    .where(
      and(
        eq(puntosTransacciones.creado_por_id, sesion.id),
        eq(puntosTransacciones.tipo, "acreditacion")
      )
    )
    .orderBy(desc(puntosTransacciones.fecha_creacion))
    .limit(limite);
}

/** Conteo del día del asesor, en hora de Ecuador (Vercel corre en UTC). */
export async function getResumenDelDia(): Promise<{ acreditaciones: number; puntos: number }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { acreditaciones: 0, puntos: 0 };

  const [fila] = await db
    .select({
      acreditaciones: sql<number>`count(*)::int`,
      puntos: sql<number>`coalesce(sum(${puntosTransacciones.puntos}), 0)::int`,
    })
    .from(puntosTransacciones)
    .where(
      and(
        eq(puntosTransacciones.creado_por_id, sesion.id),
        eq(puntosTransacciones.tipo, "acreditacion"),
        sql`date_trunc('day', ${puntosTransacciones.fecha_creacion} AT TIME ZONE 'America/Guayaquil')
            = date_trunc('day', now() AT TIME ZONE 'America/Guayaquil')`
      )
    );

  return { acreditaciones: fila?.acreditaciones ?? 0, puntos: fila?.puntos ?? 0 };
}
