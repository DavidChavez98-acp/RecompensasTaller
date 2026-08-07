/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Reportes y detección de anomalías.
 *
 * ── Por qué esto existe ──
 * Un programa de fidelización es un pasivo de la empresa, y el fraude que de
 * verdad importa no es un cliente listo: es un asesor acreditando puntos a un
 * cómplice con un QR legítimo. La criptografía no lo detiene, porque todo en
 * esa transacción es válido. Lo único que lo detecta es la ANALÍTICA sobre el
 * ledger — y por eso el ledger tenía que existir desde el día 1.
 *
 * ── Zona horaria ──
 * Vercel corre en UTC y Ecuador es UTC-5. Todo lo que diga "hoy" o "este mes"
 * usa `AT TIME ZONE 'America/Guayaquil'`; con `CURRENT_DATE` los reportes del
 * día se cortarían a las 19:00 hora local.
 */

"use server";

import { db } from "@/db";
import { canjes, clientes, puntosTransacciones, users } from "@/db/schema";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getSesionInterna } from "./auth-interno";
import { puedeVerReportes } from "@/lib/authz";
import { ZONA_HORARIA } from "@/lib/constants";

const TZ = sql.raw(`'${ZONA_HORARIA}'`);

export type ResumenGeneral = {
  /** Puntos vivos en manos de clientes: el pasivo del programa. */
  pasivoPuntos: number;
  clientesActivos: number;
  clientesSinVerificar: number;
  puntosEmitidosHoy: number;
  puntosEmitidosMes: number;
  acreditacionesHoy: number;
  canjesPendientes: number;
  canjesPorEntregar: number;
};

export async function getResumenGeneral(): Promise<ResumenGeneral | null> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeVerReportes(sesion)) return null;

  const [pasivo] = await db
    .select({
      total: sql<number>`coalesce(sum(${clientes.saldo_cache}), 0)::int`,
      activos: sql<number>`count(*)::int`,
      sinVerificar: sql<number>`count(*) FILTER (WHERE ${clientes.verificado} = false)::int`,
    })
    .from(clientes)
    .where(eq(clientes.activo, true));

  const [emision] = await db
    .select({
      hoy: sql<number>`coalesce(sum(${puntosTransacciones.puntos}) FILTER (
        WHERE date_trunc('day', ${puntosTransacciones.fecha_creacion} AT TIME ZONE ${TZ})
            = date_trunc('day', now() AT TIME ZONE ${TZ})
      ), 0)::int`,
      mes: sql<number>`coalesce(sum(${puntosTransacciones.puntos}) FILTER (
        WHERE date_trunc('month', ${puntosTransacciones.fecha_creacion} AT TIME ZONE ${TZ})
            = date_trunc('month', now() AT TIME ZONE ${TZ})
      ), 0)::int`,
      acreditacionesHoy: sql<number>`count(*) FILTER (
        WHERE date_trunc('day', ${puntosTransacciones.fecha_creacion} AT TIME ZONE ${TZ})
            = date_trunc('day', now() AT TIME ZONE ${TZ})
      )::int`,
    })
    .from(puntosTransacciones)
    .where(eq(puntosTransacciones.tipo, "acreditacion"));

  const [cola] = await db
    .select({
      pendientes: sql<number>`count(*) FILTER (WHERE ${canjes.estado} = 'solicitado')::int`,
      porEntregar: sql<number>`count(*) FILTER (WHERE ${canjes.estado} = 'aprobado')::int`,
    })
    .from(canjes);

  return {
    pasivoPuntos: pasivo?.total ?? 0,
    clientesActivos: pasivo?.activos ?? 0,
    clientesSinVerificar: pasivo?.sinVerificar ?? 0,
    puntosEmitidosHoy: emision?.hoy ?? 0,
    puntosEmitidosMes: emision?.mes ?? 0,
    acreditacionesHoy: emision?.acreditacionesHoy ?? 0,
    canjesPendientes: cola?.pendientes ?? 0,
    canjesPorEntregar: cola?.porEntregar ?? 0,
  };
}

export type ActividadAsesor = {
  usuarioId: string;
  nombre: string;
  acreditaciones: number;
  puntos: number;
  clientesDistintos: number;
  /** Acreditaciones al cliente que más repite. */
  maxAlMismoCliente: number;
  /** Porcentaje que representa ese cliente sobre el total del asesor. */
  concentracion: number;
  clienteConcentrado: string | null;
};

/**
 * EL indicador antifraude.
 *
 * Un asesor honesto reparte sus acreditaciones entre muchos clientes. Uno que
 * acredita a un cómplice concentra: si el 40% de sus acreditaciones van a la
 * misma persona, hay algo que revisar aunque cada transacción por separado sea
 * perfectamente válida.
 *
 * No decide nada por sí solo — un taller pequeño con clientes recurrentes puede
 * dar falsos positivos. Es una señal para que el Jefe mire, no una acusación.
 */
export async function getConcentracionAsesores(dias = 30): Promise<ActividadAsesor[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeVerReportes(sesion)) return [];

  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const filas = await db
    .select({
      usuarioId: puntosTransacciones.creado_por_id,
      nombre: puntosTransacciones.creado_por_nombre,
      clienteId: puntosTransacciones.cliente_id,
      clienteNombre: clientes.nombres,
      veces: sql<number>`count(*)::int`,
      puntos: sql<number>`coalesce(sum(${puntosTransacciones.puntos}), 0)::int`,
    })
    .from(puntosTransacciones)
    .innerJoin(clientes, eq(clientes.id, puntosTransacciones.cliente_id))
    .where(
      and(
        eq(puntosTransacciones.tipo, "acreditacion"),
        gt(puntosTransacciones.fecha_creacion, desde)
      )
    )
    .groupBy(
      puntosTransacciones.creado_por_id,
      puntosTransacciones.creado_por_nombre,
      puntosTransacciones.cliente_id,
      clientes.nombres
    );

  // La agregación por asesor se hace en memoria a propósito: son decenas de
  // filas, no miles, y una consulta con window functions sería más difícil de
  // leer y de cambiar cuando el Jefe pida otro corte.
  const porAsesor = new Map<string, ActividadAsesor & { _clientes: Set<string> }>();

  for (const fila of filas) {
    if (!fila.usuarioId) continue;

    let acumulado = porAsesor.get(fila.usuarioId);
    if (!acumulado) {
      acumulado = {
        usuarioId: fila.usuarioId,
        nombre: fila.nombre ?? "Desconocido",
        acreditaciones: 0,
        puntos: 0,
        clientesDistintos: 0,
        maxAlMismoCliente: 0,
        concentracion: 0,
        clienteConcentrado: null,
        _clientes: new Set(),
      };
      porAsesor.set(fila.usuarioId, acumulado);
    }

    acumulado.acreditaciones += fila.veces;
    acumulado.puntos += fila.puntos;
    acumulado._clientes.add(fila.clienteId);

    if (fila.veces > acumulado.maxAlMismoCliente) {
      acumulado.maxAlMismoCliente = fila.veces;
      acumulado.clienteConcentrado = fila.clienteNombre;
    }
  }

  return Array.from(porAsesor.values())
    .map(({ _clientes, ...asesor }) => ({
      ...asesor,
      clientesDistintos: _clientes.size,
      concentracion:
        asesor.acreditaciones > 0
          ? Math.round((asesor.maxAlMismoCliente / asesor.acreditaciones) * 100)
          : 0,
    }))
    .sort((a, b) => b.concentracion - a.concentracion);
}

export type AcreditacionTopada = {
  id: string;
  fecha: Date;
  clienteNombre: string;
  asesorNombre: string | null;
  monto: string | null;
  puntos: number;
};

/**
 * Acreditaciones que chocaron con el tope por transacción. Casi siempre son un
 * dedazo en el monto ($15.000 en vez de $150), y el tope las recortó — pero el
 * cliente igual se llevó el máximo, así que conviene revisarlas.
 */
export async function getAcreditacionesTopadas(dias = 30): Promise<AcreditacionTopada[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeVerReportes(sesion)) return [];

  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  // Se identifican por el registro de auditoría que deja `acreditarPuntos`
  // cuando aplica el tope, no recalculando: la regla pudo haber cambiado desde
  // entonces y el recálculo daría otro número.
  const filas = await db
    .select({
      id: puntosTransacciones.id,
      fecha: puntosTransacciones.fecha_creacion,
      clienteNombre: clientes.nombres,
      asesorNombre: puntosTransacciones.creado_por_nombre,
      monto: puntosTransacciones.monto_gastado,
      puntos: puntosTransacciones.puntos,
    })
    .from(puntosTransacciones)
    .innerJoin(clientes, eq(clientes.id, puntosTransacciones.cliente_id))
    .where(
      and(
        eq(puntosTransacciones.tipo, "acreditacion"),
        gt(puntosTransacciones.fecha_creacion, desde),
        sql`EXISTS (
          SELECT 1 FROM admin_audit_log a
          WHERE a.accion = 'acreditacion_topada'
            AND a.entidad_id = ${puntosTransacciones.id}::text
        )`
      )
    )
    .orderBy(desc(puntosTransacciones.fecha_creacion))
    .limit(50);

  return filas;
}

export type ClienteRiesgo = {
  id: string;
  nombres: string;
  saldo: number;
  fechaCreacion: Date;
};

/**
 * Clientes con saldo relevante que nunca pasaron por el mostrador a mostrar su
 * cédula. El auto-registro prueba el correo, no la identidad: alguien podría
 * registrarse con la cédula de otro y acumular a su nombre.
 */
export async function getClientesSinVerificarConSaldo(minimo = 100): Promise<ClienteRiesgo[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeVerReportes(sesion)) return [];

  return db
    .select({
      id: clientes.id,
      nombres: clientes.nombres,
      saldo: clientes.saldo_cache,
      fechaCreacion: clientes.fecha_creacion,
    })
    .from(clientes)
    .where(
      and(
        eq(clientes.activo, true),
        eq(clientes.verificado, false),
        gt(clientes.saldo_cache, minimo)
      )
    )
    .orderBy(desc(clientes.saldo_cache))
    .limit(25);
}

export type MovimientoReciente = {
  id: string;
  fecha: Date;
  tipo: string;
  puntos: number;
  clienteNombre: string;
  actor: string | null;
  motivo: string | null;
};

/** Reversos y ajustes recientes: lo que un Jefe querría revisar semanalmente. */
export async function getCorreccionesRecientes(limite = 20): Promise<MovimientoReciente[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeVerReportes(sesion)) return [];

  return db
    .select({
      id: puntosTransacciones.id,
      fecha: puntosTransacciones.fecha_creacion,
      tipo: puntosTransacciones.tipo,
      puntos: puntosTransacciones.puntos,
      clienteNombre: clientes.nombres,
      actor: puntosTransacciones.creado_por_nombre,
      motivo: puntosTransacciones.motivo,
    })
    .from(puntosTransacciones)
    .innerJoin(clientes, eq(clientes.id, puntosTransacciones.cliente_id))
    .where(sql`${puntosTransacciones.tipo} IN ('reverso', 'ajuste')`)
    .orderBy(desc(puntosTransacciones.fecha_creacion))
    .limit(limite);
}

export type TopAsesor = { nombre: string; acreditaciones: number; puntos: number };

export async function getTopAsesores(dias = 30): Promise<TopAsesor[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeVerReportes(sesion)) return [];

  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  return db
    .select({
      nombre: sql<string>`coalesce(${puntosTransacciones.creado_por_nombre}, 'Desconocido')`,
      acreditaciones: sql<number>`count(*)::int`,
      puntos: sql<number>`coalesce(sum(${puntosTransacciones.puntos}), 0)::int`,
    })
    .from(puntosTransacciones)
    .where(
      and(
        eq(puntosTransacciones.tipo, "acreditacion"),
        gt(puntosTransacciones.fecha_creacion, desde)
      )
    )
    .groupBy(puntosTransacciones.creado_por_nombre)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
}

/** Usuarios internos activos, para el reporte de cobertura del equipo. */
export async function contarPersonalActivo(): Promise<number> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeVerReportes(sesion)) return 0;

  const [fila] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.activo, true));

  return fila?.n ?? 0;
}
