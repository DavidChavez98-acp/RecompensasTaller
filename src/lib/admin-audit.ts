/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Solicitud Credito
 */

import { db } from "@/db";
import { adminAuditLog } from "@/db/schema";

type AuditActor = {
  id: string;
  email: string | null;
  nombre: string;
};

// Best-effort: un fallo al registrar auditoría nunca debe tumbar la acción
// administrativa que ya se ejecutó con éxito. Solo corre contra BD real;
// en desarrollo local sin Postgres no hay tabla que escribir.
export async function logAdminAction(
  actor: AuditActor,
  accion: string,
  entidad: string,
  entidadId: string | null,
  detalle?: Record<string, unknown>
): Promise<void> {
  if (!process.env.POSTGRES_URL) return;

  try {
    await db.insert(adminAuditLog).values({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_nombre: actor.nombre,
      accion,
      entidad,
      entidad_id: entidadId,
      detalle: detalle ?? null,
    });
  } catch (error) {
    console.error("No se pudo registrar auditoría de acción admin:", error);
  }
}
