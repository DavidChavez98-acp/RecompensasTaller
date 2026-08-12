/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Vehículos del cliente, identificados por chasis. A pedido del Jefe de
 * Taller: en el mostrador lo que importa es "qué carro es" y "qué se le ha
 * hecho", no solo la cédula de quien lo trae. El chasis NO va cifrado (a
 * diferencia de cédula/email/teléfono) — no es PII de la persona, es un dato
 * del vehículo, y protegerlo igual que la identidad del cliente no aporta
 * nada y sí complica la búsqueda exacta que el mostrador necesita.
 *
 * El historial no es una tabla nueva: reutiliza `puntos_transacciones`
 * filtrado por `vehiculo_id` (nullable, columna añadida sobre el ledger
 * existente). Lo que ya se acredita ahí — servicio, monto, fecha, puntos — es
 * lo que el Jefe de Taller pidió ver por carro.
 */

"use server";

import { db } from "@/db";
import { clientes, puntosTransacciones, serviciosTipo, vehiculos } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSesionInterna } from "./auth-interno";
import { puedeAcreditarPuntos } from "@/lib/authz";
import { logAdminAction } from "@/lib/admin-audit";
import { chasisSchema } from "@/lib/validations";

export type VehiculoResumen = {
  id: string;
  chasis: string;
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  color: string | null;
};

/** Alta de un vehículo ligado a un cliente ya existente. */
export async function crearVehiculo(entrada: {
  clienteId: string;
  chasis: string;
  placa?: string;
  marca?: string;
  modelo?: string;
  anio?: number;
  color?: string;
}): Promise<{ ok: boolean; error?: string; vehiculoId?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeAcreditarPuntos(sesion)) {
    return { ok: false, error: "Tu rol no permite registrar vehículos." };
  }

  const chasisValidado = chasisSchema.safeParse(entrada.chasis);
  if (!chasisValidado.success) {
    return { ok: false, error: chasisValidado.error.issues[0]?.message ?? "Chasis inválido." };
  }

  const [cliente] = await db
    .select({ id: clientes.id })
    .from(clientes)
    .where(and(eq(clientes.id, entrada.clienteId), eq(clientes.activo, true)))
    .limit(1);
  if (!cliente) return { ok: false, error: "Cliente no encontrado." };

  const filas = await db
    .insert(vehiculos)
    .values({
      cliente_id: entrada.clienteId,
      chasis: chasisValidado.data,
      placa: entrada.placa?.trim() || null,
      marca: entrada.marca?.trim() || null,
      modelo: entrada.modelo?.trim() || null,
      anio: entrada.anio ?? null,
      color: entrada.color?.trim() || null,
      creado_por_id: sesion.id,
    })
    .onConflictDoNothing({ target: vehiculos.chasis })
    .returning({ id: vehiculos.id });

  const vehiculo = filas[0];
  if (!vehiculo) {
    return { ok: false, error: "Ya existe un vehículo registrado con ese chasis." };
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "vehiculo_creado",
    "vehiculos",
    vehiculo.id,
    { clienteId: entrada.clienteId, chasis: chasisValidado.data }
  );

  revalidatePath(`/interno/clientes/${entrada.clienteId}`);
  return { ok: true, vehiculoId: vehiculo.id };
}

export type VehiculoConCliente = VehiculoResumen & {
  clienteId: string;
  clienteNombres: string;
};

/**
 * Busca un vehículo activo por chasis exacto. No hay coincidencia parcial a
 * propósito: el chasis se lee del vehículo o se escanea, nunca se recuerda de
 * memoria, así que una búsqueda difusa solo añadiría ruido en el mostrador.
 */
export async function buscarVehiculoPorChasis(chasis: string): Promise<VehiculoConCliente | null> {
  const sesion = await getSesionInterna();
  if (!sesion) return null;

  const chasisValidado = chasisSchema.safeParse(chasis);
  if (!chasisValidado.success) return null;

  const [fila] = await db
    .select({
      id: vehiculos.id,
      chasis: vehiculos.chasis,
      placa: vehiculos.placa,
      marca: vehiculos.marca,
      modelo: vehiculos.modelo,
      anio: vehiculos.anio,
      color: vehiculos.color,
      clienteId: clientes.id,
      clienteNombres: clientes.nombres,
    })
    .from(vehiculos)
    .innerJoin(clientes, eq(clientes.id, vehiculos.cliente_id))
    .where(
      and(
        eq(vehiculos.chasis, chasisValidado.data),
        eq(vehiculos.activo, true),
        isNull(clientes.anonimizado_en)
      )
    )
    .limit(1);

  return fila ?? null;
}

/** Vehículos activos de un cliente, para la ficha del taller. */
export async function listarVehiculosDeCliente(clienteId: string): Promise<VehiculoResumen[]> {
  const sesion = await getSesionInterna();
  if (!sesion) return [];

  return db
    .select({
      id: vehiculos.id,
      chasis: vehiculos.chasis,
      placa: vehiculos.placa,
      marca: vehiculos.marca,
      modelo: vehiculos.modelo,
      anio: vehiculos.anio,
      color: vehiculos.color,
    })
    .from(vehiculos)
    .where(and(eq(vehiculos.cliente_id, clienteId), eq(vehiculos.activo, true)))
    .orderBy(desc(vehiculos.fecha_creacion));
}

/**
 * Historial de servicios de un vehículo específico: el mismo ledger que
 * `getMovimientosCliente`, filtrado por `vehiculo_id` en vez de `cliente_id`.
 */
export async function listarHistorialVehiculo(vehiculoId: string, limite = 50) {
  const sesion = await getSesionInterna();
  if (!sesion) return [];

  return db
    .select({
      id: puntosTransacciones.id,
      tipo: puntosTransacciones.tipo,
      puntos: puntosTransacciones.puntos,
      fecha: puntosTransacciones.fecha_creacion,
      monto: puntosTransacciones.monto_gastado,
      servicio: serviciosTipo.nombre,
      documento: puntosTransacciones.documento_referencia,
      actor: puntosTransacciones.creado_por_nombre,
    })
    .from(puntosTransacciones)
    .leftJoin(serviciosTipo, eq(serviciosTipo.id, puntosTransacciones.servicio_tipo_id))
    .where(eq(puntosTransacciones.vehiculo_id, vehiculoId))
    .orderBy(desc(puntosTransacciones.fecha_creacion))
    .limit(limite);
}

export type HistorialVehiculoItem = Awaited<ReturnType<typeof listarHistorialVehiculo>>[number];
