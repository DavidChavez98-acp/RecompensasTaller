/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Lado servidor de la verificación del código QR.
 *
 * NO lleva "use server": si lo llevara, cada función exportada sería una Server
 * Action invocable desde el navegador con argumentos arbitrarios, y
 * `obtenerSecretoDispositivo` permitiría a cualquiera pedir el secreto de un
 * dispositivo ajeno y forjar sus códigos. `import "server-only"` hace que el
 * build falle si este módulo acaba en un bundle de cliente.
 */

import "server-only";

import { db } from "@/db";
import { clienteDispositivos, qrEscaneos } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { decryptDeviceSecret } from "./pii-crypto";
import {
  analizarToken,
  base64UrlABytes,
  construirToken,
  normalizarCodigoRespaldo,
  pasoActual,
  verificarToken,
  type ResultadoVerificacion,
} from "./qr-token";
import { QR_TOLERANCIA_PASOS } from "./constants";

type DispositivoConSecreto = { clienteId: string; secreto: Uint8Array };

async function obtenerSecretoDispositivo(dispositivoId: string): Promise<DispositivoConSecreto | null> {
  const fila = await db.query.clienteDispositivos.findFirst({
    where: and(eq(clienteDispositivos.id, dispositivoId), isNull(clienteDispositivos.revocado_en)),
  });

  if (!fila) return null;

  try {
    return { clienteId: fila.cliente_id, secreto: base64UrlABytes(decryptDeviceSecret(fila.secreto)) };
  } catch {
    // Secreto ilegible (clave rotada, dato corrupto). Fallar el escaneo es
    // mejor que verificar contra un secreto equivocado: el cliente
    // reaprovisiona su dispositivo y sigue.
    console.error("No se pudo descifrar el secreto del dispositivo", dispositivoId);
    return null;
  }
}

export type LecturaToken =
  | { ok: true; dispositivoId: string; clienteId: string; paso: number }
  | { ok: false; motivo: "formato" | "desconocido" | "firma" | "fuera_de_ventana"; desfasePasos?: number };

/** Verifica firma y ventana. NO quema el nonce todavía — eso es `registrarEscaneo`. */
export async function leerTokenQr(entrada: string): Promise<LecturaToken> {
  const analizado = analizarToken(entrada);
  if (!analizado) return { ok: false, motivo: "formato" };

  const dispositivo = await obtenerSecretoDispositivo(analizado.dispositivoId);
  if (!dispositivo) return { ok: false, motivo: "desconocido" };

  const resultado: ResultadoVerificacion = await verificarToken(entrada, dispositivo.secreto);
  if (!resultado.valido) {
    return { ok: false, motivo: resultado.motivo, desfasePasos: resultado.desfasePasos };
  }

  return {
    ok: true,
    dispositivoId: resultado.dispositivoId,
    clienteId: dispositivo.clienteId,
    paso: resultado.paso,
  };
}

/**
 * Busca a qué dispositivo pertenece un código de respaldo tecleado.
 *
 * A diferencia del QR, aquí no viene el identificador del dispositivo: hay que
 * probar los códigos vigentes. Se acota a los dispositivos de UN cliente
 * (el asesor lo eligió antes por nombre o cédula), así que son unos pocos
 * HMAC por intento, no un barrido de toda la tabla.
 */
export async function resolverCodigoRespaldo(
  clienteId: string,
  codigoTecleado: string
): Promise<{ ok: true; dispositivoId: string; paso: number } | { ok: false }> {
  const buscado = normalizarCodigoRespaldo(codigoTecleado);
  if (buscado.length !== 8) return { ok: false };

  const dispositivos = await db
    .select({ id: clienteDispositivos.id, secreto: clienteDispositivos.secreto })
    .from(clienteDispositivos)
    .where(
      and(eq(clienteDispositivos.cliente_id, clienteId), isNull(clienteDispositivos.revocado_en))
    );

  const paso = pasoActual();

  for (const dispositivo of dispositivos) {
    let secreto: Uint8Array;
    try {
      secreto = base64UrlABytes(decryptDeviceSecret(dispositivo.secreto));
    } catch {
      continue;
    }

    // Misma ventana de tolerancia que el QR: el asesor puede tardar en teclear.
    for (let desfase = -QR_TOLERANCIA_PASOS; desfase <= QR_TOLERANCIA_PASOS; desfase++) {
      const candidato = await construirToken(dispositivo.id, secreto, paso + desfase);
      if (candidato.codigoRespaldo === buscado) {
        return { ok: true, dispositivoId: dispositivo.id, paso: paso + desfase };
      }
    }
  }

  return { ok: false };
}

/**
 * Quema el nonce. EL constraint `UNIQUE (dispositivo_id, paso)` es lo que mata
 * el replay: una foto del código ajeno sirve dos minutos como mucho, y una sola
 * vez. `onConflictDoNothing` + comprobar filas devueltas convierte la carrera
 * en una decisión de la base de datos, no de la aplicación.
 */
export async function registrarEscaneo(params: {
  dispositivoId: string;
  paso: number;
  usuarioId: string;
}): Promise<{ ok: true; escaneoId: string } | { ok: false; motivo: "ya_usado" }> {
  const [creado] = await db
    .insert(qrEscaneos)
    .values({
      dispositivo_id: params.dispositivoId,
      paso: params.paso,
      usuario_id: params.usuarioId,
    })
    .onConflictDoNothing({ target: [qrEscaneos.dispositivo_id, qrEscaneos.paso] })
    .returning({ id: qrEscaneos.id });

  if (!creado) return { ok: false, motivo: "ya_usado" };

  await db
    .update(clienteDispositivos)
    .set({ ultima_actividad: new Date() })
    .where(eq(clienteDispositivos.id, params.dispositivoId));

  return { ok: true, escaneoId: creado.id };
}
