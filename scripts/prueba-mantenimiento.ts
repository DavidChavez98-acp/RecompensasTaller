/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Barrido de mantenimiento contra la base REAL.
 *
 * Lo que importa probar aquí: que la poda NO borra escaneos referenciados por
 * el ledger (rompería la trazabilidad de una acreditación), que el throttle
 * global impide que corra dos veces, y que el recálculo detecta una deriva de
 * saldo introducida a mano.
 *
 * Uso:  pnpm test:mantenimiento
 */

import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { eq, sql, inArray } from "drizzle-orm";
import { db, cerrarPool } from "../src/db/index";
import {
  clienteDispositivos,
  clientes,
  otpCodigos,
  puntosTransacciones,
  qrEscaneos,
  settings,
  sucursales,
  users,
} from "../src/db/schema";
import { aplicarMovimiento } from "../src/lib/saldo";
import { ejecutarMantenimiento } from "../src/lib/log-retention";

const MARCA = "PRUEBA_MANT";
let fallos = 0;

function comprobar(condicion: boolean, descripcion: string, detalle?: string) {
  if (condicion) console.log(`  ✓ ${descripcion}`);
  else {
    fallos++;
    console.error(`  ✗ ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  }
}

function hace(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

async function limpiar(clienteIds: string[], usuarioId: string | null) {
  if (clienteIds.length > 0) {
    await db.execute(sql`ALTER TABLE puntos_transacciones DISABLE TRIGGER puntos_transacciones_append_only`);
    await db.delete(puntosTransacciones).where(inArray(puntosTransacciones.cliente_id, clienteIds));
    await db.execute(sql`ALTER TABLE puntos_transacciones ENABLE TRIGGER puntos_transacciones_append_only`);

    const dispositivos = await db
      .select({ id: clienteDispositivos.id })
      .from(clienteDispositivos)
      .where(inArray(clienteDispositivos.cliente_id, clienteIds));

    if (dispositivos.length > 0) {
      await db.delete(qrEscaneos).where(
        inArray(qrEscaneos.dispositivo_id, dispositivos.map((d) => d.id))
      );
    }
    await db.delete(clienteDispositivos).where(inArray(clienteDispositivos.cliente_id, clienteIds));
    await db.delete(otpCodigos).where(inArray(otpCodigos.cliente_id, clienteIds));
    await db.delete(clientes).where(inArray(clientes.id, clienteIds));
  }
  if (usuarioId) await db.delete(users).where(eq(users.id, usuarioId));
}

async function main() {
  const clienteIds: string[] = [];
  let usuarioId: string | null = null;

  try {
    const [sucursal] = await db.select({ id: sucursales.id }).from(sucursales).limit(1);
    if (!sucursal) throw new Error("Corre `pnpm db:seed` primero.");

    const [usuario] = await db
      .insert(users)
      .values({ nombre: `${MARCA} Asesor`, role: "Asesor de Servicio", sucursal_id: sucursal.id })
      .returning({ id: users.id });
    usuarioId = usuario!.id;

    const [cliente] = await db
      .insert(clientes)
      .values({
        identificacion: `${MARCA}_CED`,
        identificacion_idx: `${MARCA}_${Date.now()}`,
        nombres: "Cliente mantenimiento",
        saldo_cache: 0,
        sucursal_id: sucursal.id,
      })
      .returning({ id: clientes.id });
    clienteIds.push(cliente!.id);

    const [dispositivo] = await db
      .insert(clienteDispositivos)
      .values({ cliente_id: cliente!.id, secreto: "prueba" })
      .returning({ id: clienteDispositivos.id });

    // ── Datos viejos que SÍ deben podarse ───────────────────────────────────
    console.log("\n1. Poda de datos efímeros");

    const [escaneoViejoLibre] = await db
      .insert(qrEscaneos)
      .values({
        dispositivo_id: dispositivo!.id,
        paso: 1,
        usuario_id: usuarioId,
        fecha_creacion: hace(60),
      })
      .returning({ id: qrEscaneos.id });

    // ── Escaneo viejo pero REFERENCIADO por el ledger: NO debe borrarse ─────
    const [escaneoViejoUsado] = await db
      .insert(qrEscaneos)
      .values({
        dispositivo_id: dispositivo!.id,
        paso: 2,
        usuario_id: usuarioId,
        fecha_creacion: hace(60),
      })
      .returning({ id: qrEscaneos.id });

    await aplicarMovimiento({
      clienteId: cliente!.id,
      tipo: "acreditacion",
      puntos: 100,
      escaneoId: escaneoViejoUsado!.id,
      creadoPorId: usuarioId,
      creadoPorNombre: `${MARCA} Asesor`,
    });

    await db.insert(otpCodigos).values({
      identificacion_idx: `${MARCA}_otp`,
      cliente_id: cliente!.id,
      codigo_hash: "x",
      expira_en: hace(30),
      fecha_creacion: hace(30),
    });

    // Forzar que el throttle permita correr.
    await db
      .insert(settings)
      .values({ key: "mantenimiento_ultima_ejecucion", value: hace(5).toISOString() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: hace(5).toISOString() },
      });

    const primera = await ejecutarMantenimiento();
    comprobar(primera.ejecutado, "el barrido corre cuando toca");

    const [libreSigue] = await db
      .select({ id: qrEscaneos.id })
      .from(qrEscaneos)
      .where(eq(qrEscaneos.id, escaneoViejoLibre!.id));
    comprobar(!libreSigue, "un escaneo viejo sin usar se poda");

    const [usadoSigue] = await db
      .select({ id: qrEscaneos.id })
      .from(qrEscaneos)
      .where(eq(qrEscaneos.id, escaneoViejoUsado!.id));
    comprobar(
      !!usadoSigue,
      "un escaneo viejo REFERENCIADO por el ledger NO se poda (rompería la trazabilidad)"
    );

    const [otpSigue] = await db
      .select({ id: otpCodigos.id })
      .from(otpCodigos)
      .where(eq(otpCodigos.identificacion_idx, `${MARCA}_otp`));
    comprobar(!otpSigue, "los códigos OTP viejos se podan");

    // ── Throttle ────────────────────────────────────────────────────────────
    console.log("\n2. Throttle global");
    const segunda = await ejecutarMantenimiento();
    comprobar(
      !segunda.ejecutado,
      "una segunda llamada inmediata no vuelve a correr",
      segunda.ejecutado ? "corrió dos veces" : undefined
    );

    const enParalelo = await Promise.all([
      ejecutarMantenimiento(),
      ejecutarMantenimiento(),
      ejecutarMantenimiento(),
    ]);
    comprobar(
      enParalelo.every((r) => !r.ejecutado),
      "tres instancias simultáneas tampoco lo repiten"
    );

    // ── Deriva de saldo ─────────────────────────────────────────────────────
    console.log("\n3. Detección de deriva del saldo cacheado");
    // Se corrompe el caché a mano, como haría un bug de aplicación.
    await db.update(clientes).set({ saldo_cache: 999 }).where(eq(clientes.id, cliente!.id));

    await db
      .update(settings)
      .set({ value: hace(5).toISOString() })
      .where(eq(settings.key, "mantenimiento_ultima_ejecucion"));

    const tercera = await ejecutarMantenimiento();
    comprobar(tercera.ejecutado, "el barrido vuelve a correr tras vencer el intervalo");
    comprobar(
      (tercera.saldosCorregidos ?? 0) >= 1,
      "detecta y corrige la deriva",
      `corrigió ${tercera.saldosCorregidos}`
    );

    const [tras] = await db
      .select({ saldo: clientes.saldo_cache })
      .from(clientes)
      .where(eq(clientes.id, cliente!.id));
    comprobar(
      tras?.saldo === 100,
      "el saldo vuelve a coincidir con el ledger",
      `quedó en ${tras?.saldo}`
    );
  } finally {
    await limpiar(clienteIds, usuarioId);
    await cerrarPool();
  }

  console.log(
    fallos === 0 ? "\nEl mantenimiento hace su trabajo sin romper nada.\n" : `\n${fallos} fallo(s).\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("La prueba reventó:", error);
  await cerrarPool().catch(() => {});
  process.exit(1);
});
