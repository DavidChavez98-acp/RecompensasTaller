/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Ciclo completo del código QR contra la base de datos REAL.
 *
 * Las pruebas unitarias de `qr-token.test.ts` verifican el HMAC con un secreto
 * en memoria. Esto verifica el camino de verdad: secreto cifrado con
 * AES-256-GCM en Postgres, descifrado al escanear, y el token generado en el
 * "teléfono" validando contra él.
 *
 * Uso:  pnpm test:ciclo-qr
 */

import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, cerrarPool } from "../src/db/index";
import {
  clienteDispositivos,
  clientes,
  puntosTransacciones,
  qrEscaneos,
  sucursales,
  users,
} from "../src/db/schema";
import { encryptField } from "../src/lib/pii-crypto";
import { bytesABase64Url, base64UrlABytes, construirToken, pasoActual } from "../src/lib/qr-token";
import { leerTokenQr, registrarEscaneo, resolverCodigoRespaldo } from "../src/lib/qr-token.server";
import { aplicarMovimiento } from "../src/lib/saldo";
import { calcularPuntos } from "../src/lib/puntos-calculo";
import { QR_PASO_SEGUNDOS } from "../src/lib/constants";

const MARCA = "PRUEBA_CICLO_QR";
let fallos = 0;

function comprobar(condicion: boolean, descripcion: string, detalle?: string) {
  if (condicion) console.log(`  ✓ ${descripcion}`);
  else {
    fallos++;
    console.error(`  ✗ ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  }
}

async function limpiar(clienteId: string | null, usuarioId: string | null) {
  if (clienteId) {
    await db.execute(sql`ALTER TABLE puntos_transacciones DISABLE TRIGGER puntos_transacciones_append_only`);
    await db.delete(puntosTransacciones).where(eq(puntosTransacciones.cliente_id, clienteId));
    await db.execute(sql`ALTER TABLE puntos_transacciones ENABLE TRIGGER puntos_transacciones_append_only`);

    const dispositivos = await db
      .select({ id: clienteDispositivos.id })
      .from(clienteDispositivos)
      .where(eq(clienteDispositivos.cliente_id, clienteId));

    for (const dispositivo of dispositivos) {
      await db.delete(qrEscaneos).where(eq(qrEscaneos.dispositivo_id, dispositivo.id));
    }
    await db.delete(clienteDispositivos).where(eq(clienteDispositivos.cliente_id, clienteId));
    await db.delete(clientes).where(eq(clientes.id, clienteId));
  }
  if (usuarioId) await db.delete(users).where(eq(users.id, usuarioId));
}

async function main() {
  let clienteId: string | null = null;
  let usuarioId: string | null = null;

  try {
    const [sucursal] = await db.select({ id: sucursales.id }).from(sucursales).limit(1);
    if (!sucursal) throw new Error("Corre `pnpm db:seed` primero.");

    const [cliente] = await db
      .insert(clientes)
      .values({
        identificacion: encryptField("1710034065"),
        identificacion_idx: `${MARCA}_${Date.now()}`,
        nombres: "Cliente ciclo QR",
        saldo_cache: 0,
        sucursal_id: sucursal.id,
      })
      .returning({ id: clientes.id });
    clienteId = cliente!.id;

    const [usuario] = await db
      .insert(users)
      .values({ nombre: `${MARCA} Asesor`, role: "Asesor de Servicio", sucursal_id: sucursal.id })
      .returning({ id: users.id });
    usuarioId = usuario!.id;

    // ── Aprovisionamiento: como lo hace `aprovisionarDispositivo` ─────────────
    console.log("\n1. Aprovisionamiento del dispositivo");
    const secretoBytes = new Uint8Array(crypto.randomBytes(32));
    const secreto = bytesABase64Url(secretoBytes);

    const [dispositivo] = await db
      .insert(clienteDispositivos)
      .values({ cliente_id: clienteId, secreto: encryptField(secreto) })
      .returning({ id: clienteDispositivos.id });
    const dispositivoId = dispositivo!.id;

    const [guardado] = await db
      .select({ secreto: clienteDispositivos.secreto })
      .from(clienteDispositivos)
      .where(eq(clienteDispositivos.id, dispositivoId));

    comprobar(
      guardado!.secreto.startsWith("v1:") && !guardado!.secreto.includes(secreto),
      "el secreto queda cifrado en la base, no en claro"
    );

    // ── El "teléfono" genera el token, sin tocar la base ─────────────────────
    console.log("\n2. Generación en el dispositivo y verificación en el servidor");
    const { token, codigoRespaldo } = await construirToken(
      dispositivoId,
      base64UrlABytes(secreto)
    );

    comprobar(token.length <= 60, `el token mide ${token.length} caracteres`);

    const lectura = await leerTokenQr(token);
    comprobar(lectura.ok, "el servidor descifra el secreto y valida la firma");
    if (lectura.ok) {
      comprobar(lectura.clienteId === clienteId, "resuelve al cliente correcto");
    }

    // ── Token de otro secreto: debe rechazarse ───────────────────────────────
    console.log("\n3. Token forjado");
    const secretoFalso = new Uint8Array(crypto.randomBytes(32));
    const { token: tokenFalso } = await construirToken(dispositivoId, secretoFalso);
    const lecturaFalsa = await leerTokenQr(tokenFalso);
    comprobar(
      !lecturaFalsa.ok && lecturaFalsa.motivo === "firma",
      "un token firmado con otro secreto se rechaza por firma",
      lecturaFalsa.ok ? "fue aceptado" : `motivo ${lecturaFalsa.motivo}`
    );

    // ── Token viejo: fuera de ventana ────────────────────────────────────────
    console.log("\n4. Token vencido");
    const pasoViejo = pasoActual() - 10;
    const { token: tokenViejo } = await construirToken(
      dispositivoId,
      base64UrlABytes(secreto),
      pasoViejo
    );
    const lecturaVieja = await leerTokenQr(tokenViejo);
    comprobar(
      !lecturaVieja.ok && lecturaVieja.motivo === "fuera_de_ventana",
      `un token de hace ${(10 * QR_PASO_SEGUNDOS) / 60} minutos se rechaza por ventana`,
      lecturaVieja.ok ? "fue aceptado" : `motivo ${lecturaVieja.motivo}`
    );

    // ── Acreditación ─────────────────────────────────────────────────────────
    console.log("\n5. Acreditación completa");
    if (!lectura.ok) throw new Error("no se pudo leer el token válido");

    const escaneo = await registrarEscaneo({
      dispositivoId,
      paso: lectura.paso,
      usuarioId: usuarioId!,
    });
    comprobar(escaneo.ok, "el escaneo se registra");

    const calculo = calcularPuntos(150, {
      montoBase: 10,
      puntosPorBase: 1,
      redondeo: "abajo",
      montoMinimo: 0,
      puntosMaximosTransaccion: 5000,
    });
    comprobar(calculo.puntos === 15, "$150 con regla de 1 por $10 son 15 puntos", `dio ${calculo.puntos}`);

    if (escaneo.ok) {
      const movimiento = await aplicarMovimiento({
        clienteId,
        tipo: "acreditacion",
        puntos: calculo.puntos,
        montoGastado: "150.00",
        escaneoId: escaneo.escaneoId,
        creadoPorId: usuarioId,
      });
      comprobar(movimiento.ok, "los puntos se acreditan");
      if (movimiento.ok) {
        comprobar(movimiento.saldoPosterior === 15, "el saldo queda en 15");
      }
    }

    // ── Replay del mismo token ───────────────────────────────────────────────
    console.log("\n6. Replay: el mismo código, otra vez");
    const relectura = await leerTokenQr(token);
    comprobar(relectura.ok, "la firma sigue siendo válida (el token no cambió)");

    const reescaneo = await registrarEscaneo({
      dispositivoId,
      paso: lectura.paso,
      usuarioId: usuarioId!,
    });
    comprobar(
      !reescaneo.ok,
      "pero el escaneo se rechaza: el nonce ya está quemado",
      reescaneo.ok ? "se registró de nuevo" : undefined
    );

    // ── Código de respaldo tecleado ──────────────────────────────────────────
    console.log("\n7. Código tecleado cuando la cámara falla");
    const resuelto = await resolverCodigoRespaldo(clienteId, codigoRespaldo);
    comprobar(resuelto.ok, "el código de 8 caracteres resuelve al dispositivo correcto");
    if (resuelto.ok) {
      comprobar(resuelto.dispositivoId === dispositivoId, "es el mismo dispositivo");
    }

    const resueltoMalEscrito = await resolverCodigoRespaldo(
      clienteId,
      codigoRespaldo.toLowerCase().replace(/0/g, "O")
    );
    comprobar(
      resueltoMalEscrito.ok,
      "tolera minúsculas y la confusión clásica entre O y 0"
    );

    const resueltoFalso = await resolverCodigoRespaldo(clienteId, "ZZZZZZZZ");
    comprobar(!resueltoFalso.ok, "un código inventado no resuelve nada");

    // ── Dispositivo revocado ─────────────────────────────────────────────────
    console.log("\n8. Dispositivo revocado");
    await db
      .update(clienteDispositivos)
      .set({ revocado_en: new Date() })
      .where(eq(clienteDispositivos.id, dispositivoId));

    const trasRevocar = await leerTokenQr(token);
    comprobar(
      !trasRevocar.ok && trasRevocar.motivo === "desconocido",
      "revocar el dispositivo invalida sus códigos de inmediato",
      trasRevocar.ok ? "siguió siendo válido" : `motivo ${trasRevocar.motivo}`
    );
  } finally {
    await limpiar(clienteId, usuarioId);
    await cerrarPool();
  }

  console.log(
    fallos === 0 ? "\nEl ciclo del QR funciona de extremo a extremo.\n" : `\n${fallos} fallo(s).\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("La prueba reventó:", error);
  await cerrarPool().catch(() => {});
  process.exit(1);
});
