/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Consultas de clientes para el personal del taller.
 *
 * El descifrado de PII ocurre AQUÍ, en el borde de lectura de la base: todo
 * consumidor aguas abajo recibe texto plano y no necesita saber que existe
 * cifrado. Si añades una consulta directa que esquive estos helpers, tienes que
 * descifrar explícitamente ahí también.
 */

"use server";

import { db } from "@/db";
import { clientes, puntosTransacciones, serviciosTipo } from "@/db/schema";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSesionInterna } from "./auth-interno";
import { puedeAcreditarPuntos, puedeRevertirPuntos } from "@/lib/authz";
import { aplicarMovimiento } from "@/lib/saldo";
import { logAdminAction } from "@/lib/admin-audit";
import { computeBlindIndex, decryptField, decryptNullableField } from "@/lib/pii-crypto";
import { validateCedula, validateRuc } from "@/lib/validations";

export type ClienteResumen = {
  id: string;
  nombres: string;
  identificacion: string;
  saldo: number;
  verificado: boolean;
};

/**
 * Busca por nombre (LIKE sobre la columna en claro) o por cédula exacta
 * (a través del índice ciego).
 *
 * La cédula NO se puede buscar por coincidencia parcial: está cifrada con IV
 * aleatorio y el índice ciego solo sirve para igualdad exacta. Es el precio de
 * que un volcado de la base no revele las cédulas de los clientes.
 */
export async function buscarClientes(consulta: string): Promise<ClienteResumen[]> {
  const sesion = await getSesionInterna();
  if (!sesion) return [];

  const termino = consulta.trim();
  if (termino.length < 3) return [];

  const esDocumento = validateCedula(termino) || validateRuc(termino);

  const filas = await db
    .select({
      id: clientes.id,
      nombres: clientes.nombres,
      identificacion: clientes.identificacion,
      saldo: clientes.saldo_cache,
      verificado: clientes.verificado,
    })
    .from(clientes)
    .where(
      and(
        eq(clientes.activo, true),
        isNull(clientes.anonimizado_en),
        esDocumento
          ? or(
              eq(clientes.identificacion_idx, computeBlindIndex(termino)),
              ilike(clientes.nombres, `%${termino}%`)
            )
          : ilike(clientes.nombres, `%${termino}%`)
      )
    )
    .orderBy(desc(clientes.fecha_creacion))
    .limit(10);

  return filas.map((fila) => ({
    ...fila,
    identificacion: decryptField(fila.identificacion),
  }));
}

export type ClienteDetalle = ClienteResumen & {
  email: string | null;
  telefono: string | null;
  origen: string;
  fechaCreacion: Date;
};

/**
 * Marca que un asesor cotejó la cédula física del cliente en el mostrador.
 *
 * El auto-registro prueba que el correo es suyo, NO que la cédula lo sea:
 * cualquiera podría registrarse con la cédula de otro y acumular a su nombre.
 * Esta es la única forma de cerrar ese hueco, y por eso es un acto humano
 * explícito, no algo que el sistema pueda deducir solo.
 */
export async function verificarCliente(
  clienteId: string
): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeAcreditarPuntos(sesion)) {
    return { ok: false, error: "Tu rol no permite verificar clientes." };
  }

  const filas = await db
    .update(clientes)
    .set({
      verificado: true,
      verificado_por_id: sesion.id,
      verificado_en: new Date(),
      fecha_actualizacion: new Date(),
    })
    .where(and(eq(clientes.id, clienteId), eq(clientes.verificado, false)))
    .returning({ id: clientes.id });

  if (filas.length === 0) {
    return { ok: false, error: "Ese cliente ya estaba verificado." };
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "cliente_verificado",
    "clientes",
    clienteId
  );

  revalidatePath(`/interno/clientes/${clienteId}`);
  revalidatePath("/interno/reportes");
  return { ok: true };
}

/** Historial de puntos del cliente, para la ficha del taller. */
export async function getMovimientosCliente(clienteId: string, limite = 50) {
  const sesion = await getSesionInterna();
  if (!sesion) return [];

  return db
    .select({
      id: puntosTransacciones.id,
      tipo: puntosTransacciones.tipo,
      puntos: puntosTransacciones.puntos,
      saldoPosterior: puntosTransacciones.saldo_posterior,
      fecha: puntosTransacciones.fecha_creacion,
      monto: puntosTransacciones.monto_gastado,
      servicio: serviciosTipo.nombre,
      motivo: puntosTransacciones.motivo,
      documento: puntosTransacciones.documento_referencia,
      actor: puntosTransacciones.creado_por_nombre,
      reversaDeId: puntosTransacciones.reversa_de_id,
    })
    .from(puntosTransacciones)
    .leftJoin(serviciosTipo, eq(serviciosTipo.id, puntosTransacciones.servicio_tipo_id))
    .where(eq(puntosTransacciones.cliente_id, clienteId))
    .orderBy(desc(puntosTransacciones.fecha_creacion))
    .limit(limite);
}

export type MovimientoInterno = Awaited<ReturnType<typeof getMovimientosCliente>>[number];

/**
 * Ajuste manual de puntos, con motivo obligatorio.
 *
 * Existe para el caso que `reversarAcreditacion` no puede resolver: el cliente
 * ya gastó los puntos mal acreditados, y revertir dejaría el saldo negativo
 * (que el CHECK de la base impide, con razón). Ahí el Jefe decide qué hacer y
 * lo registra.
 */
export async function ajustarPuntos(entrada: {
  clienteId: string;
  puntos: number;
  motivo: string;
}): Promise<{ ok: boolean; error?: string; saldoNuevo?: number }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeRevertirPuntos(sesion)) {
    return { ok: false, error: "Solo el Jefe de Taller o el Admin ajustan puntos." };
  }

  if (!Number.isInteger(entrada.puntos) || entrada.puntos === 0) {
    return { ok: false, error: "El ajuste debe ser un número entero distinto de cero." };
  }
  if (Math.abs(entrada.puntos) > 100000) {
    return { ok: false, error: "Un ajuste de esa magnitud es casi seguro un error de tecleo." };
  }
  if (entrada.motivo.trim().length < 10) {
    return { ok: false, error: "Explica el motivo del ajuste (mínimo 10 caracteres)." };
  }

  const movimiento = await aplicarMovimiento({
    clienteId: entrada.clienteId,
    tipo: "ajuste",
    puntos: entrada.puntos,
    motivo: entrada.motivo.trim(),
    creadoPorId: sesion.id,
    creadoPorNombre: sesion.nombre,
    creadoPorRol: sesion.role,
    sucursalId: sesion.sucursal_id,
  });

  if (!movimiento.ok) {
    if (movimiento.motivo === "saldo_insuficiente") {
      return {
        ok: false,
        error: `El cliente solo tiene ${movimiento.saldoActual ?? 0} puntos; no se puede descontar más.`,
      };
    }
    return { ok: false, error: "No se pudo aplicar el ajuste." };
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "ajuste_puntos",
    "clientes",
    entrada.clienteId,
    { puntos: entrada.puntos, motivo: entrada.motivo }
  );

  revalidatePath(`/interno/clientes/${entrada.clienteId}`);
  revalidatePath("/interno/reportes");
  return { ok: true, saldoNuevo: movimiento.saldoPosterior };
}

export async function getClienteDetalle(clienteId: string): Promise<ClienteDetalle | null> {
  const sesion = await getSesionInterna();
  if (!sesion) return null;

  const [fila] = await db
    .select({
      id: clientes.id,
      nombres: clientes.nombres,
      identificacion: clientes.identificacion,
      email: clientes.email,
      telefono: clientes.telefono,
      saldo: clientes.saldo_cache,
      verificado: clientes.verificado,
      origen: clientes.origen,
      fechaCreacion: clientes.fecha_creacion,
    })
    .from(clientes)
    .where(eq(clientes.id, clienteId))
    .limit(1);

  if (!fila) return null;

  return {
    ...fila,
    identificacion: decryptField(fila.identificacion),
    email: decryptNullableField(fila.email),
    telefono: decryptNullableField(fila.telefono),
  };
}
