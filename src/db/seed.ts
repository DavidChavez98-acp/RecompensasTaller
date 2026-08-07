/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Siembra idempotente: se puede correr las veces que haga falta sin duplicar
 * nada ni pisar cambios que el admin haya hecho desde el panel.
 *
 * Uso:  pnpm db:seed
 */

import { config } from "dotenv";
import { eq, isNull, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "./schema";
import { db, cerrarPool } from "./index";
import { SUCURSAL_MATRIZ_CODIGO } from "../lib/constants";

// Next.js carga `.env.local` solo; los scripts sueltos no, hay que decírselo.
config({ path: [".env.local", ".env"], quiet: true });

const SERVICIOS_BASE = [
  { codigo: "MANTENIMIENTO", nombre: "Mantenimiento preventivo", multiplicador: "1.000", orden: 10 },
  { codigo: "MECANICA", nombre: "Mecánica general", multiplicador: "1.000", orden: 20 },
  { codigo: "COLISION", nombre: "Colisión y latonería", multiplicador: "1.500", orden: 30 },
  { codigo: "REPUESTOS", nombre: "Repuestos", multiplicador: "0.500", orden: 40 },
  { codigo: "ACCESORIOS", nombre: "Accesorios", multiplicador: "0.500", orden: 50 },
];

const SETTINGS_BASE: Array<{ key: string; value: string }> = [
  // El catálogo muestra "Agotado" pero nunca la cantidad exacta: el inventario
  // de marketing no se le enseña al cliente.
  { key: "catalogo_mostrar_agotados", value: "true" },
  { key: "stock_alerta_email_activo", value: "true" },
  { key: "nombre_programa", value: "Recompensas Taller" },
];

async function main() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error("POSTGRES_URL no está configurado. Aborto.");
    process.exit(1);
  }

  // ── 1. Sucursal ────────────────────────────────────────────────────────────
  // v1 opera mono-sucursal. La fila existe para que encender multi-sucursal
  // después sea insertar filas, no una migración con backfill.
  await db
    .insert(schema.sucursales)
    .values({
      codigo: SUCURSAL_MATRIZ_CODIGO,
      nombre: "Matriz",
    })
    .onConflictDoNothing({ target: schema.sucursales.codigo });

  const [matriz] = await db
    .select()
    .from(schema.sucursales)
    .where(eq(schema.sucursales.codigo, SUCURSAL_MATRIZ_CODIGO))
    .limit(1);

  if (!matriz) throw new Error("No se pudo sembrar la sucursal Matriz.");
  console.log(`✓ Sucursal: ${matriz.nombre}`);

  // ── 2. Usuario Admin ───────────────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    const [existente] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, adminEmail))
      .limit(1);

    if (!existente) {
      await db.insert(schema.users).values({
        email: adminEmail,
        nombre: "Administrador",
        role: "Admin",
        sucursal_id: matriz.id,
        password_hash: await bcrypt.hash(adminPassword, 12),
      });
      console.log(`✓ Usuario Admin creado: ${adminEmail}`);
    } else {
      console.log(`· Usuario Admin ya existe: ${adminEmail} (sin cambios)`);
    }
  } else {
    console.warn("· ADMIN_EMAIL/ADMIN_PASSWORD no definidos: no se sembró usuario Admin.");
  }

  // ── 3. Tipos de servicio ───────────────────────────────────────────────────
  for (const servicio of SERVICIOS_BASE) {
    await db
      .insert(schema.serviciosTipo)
      .values(servicio)
      .onConflictDoNothing({ target: schema.serviciosTipo.codigo });
  }
  console.log(`✓ Tipos de servicio: ${SERVICIOS_BASE.length}`);

  // ── 4. Regla de puntos vigente ─────────────────────────────────────────────
  // Solo se siembra si NO hay ninguna regla abierta. Las reglas son versionadas
  // (nunca se hace UPDATE): si el admin ya creó la suya desde /interno/reglas,
  // volver a correr el seed no debe abrir una segunda regla vigente.
  const [reglaVigente] = await db
    .select()
    .from(schema.reglasPuntos)
    .where(isNull(schema.reglasPuntos.vigente_hasta))
    .limit(1);

  if (!reglaVigente) {
    await db.insert(schema.reglasPuntos).values({
      nombre: "Regla general inicial",
      monto_base: "10.00",
      puntos_por_base: 1,
      redondeo: "abajo",
      monto_minimo: "0",
      // Tope antifraude: ninguna acreditación individual puede pasar de 5.000
      // puntos. Un asesor que teclee $50.000 en vez de $500 choca contra esto.
      puntos_maximos_transaccion: 5000,
      sucursal_id: matriz.id,
    });
    console.log("✓ Regla de puntos: 1 punto por cada $10 (tope 5.000 por transacción)");
  } else {
    console.log(`· Ya hay una regla vigente: ${reglaVigente.nombre} (sin cambios)`);
  }

  // ── 5. Ajustes ─────────────────────────────────────────────────────────────
  for (const ajuste of SETTINGS_BASE) {
    await db
      .insert(schema.settings)
      .values(ajuste)
      .onConflictDoNothing({ target: schema.settings.key });
  }
  console.log(`✓ Ajustes: ${SETTINGS_BASE.length}`);

  // ── 6. Sanidad ─────────────────────────────────────────────────────────────
  // Un cliente sin sucursal asignada rompería el filtro de authz el día que se
  // encienda multi-sucursal. Se corrige aquí, no cuando ya duela.
  const huerfanos = await db
    .update(schema.clientes)
    .set({ sucursal_id: matriz.id })
    .where(and(isNull(schema.clientes.sucursal_id), isNull(schema.clientes.anonimizado_en)))
    .returning({ id: schema.clientes.id });

  if (huerfanos.length > 0) {
    console.log(`✓ ${huerfanos.length} cliente(s) sin sucursal asignados a Matriz`);
  }

  await cerrarPool();
  console.log("\nSiembra completada.");
}

main().catch(async (error) => {
  console.error("Fallo al sembrar:", error);
  await cerrarPool().catch(() => {});
  process.exit(1);
});
