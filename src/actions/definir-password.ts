/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Completa el alta de un usuario interno cuando sigue el enlace de la
 * invitación por correo.
 *
 * ── Por qué NO llama a getSesionInterna() ──
 * Cada función de `src/actions/usuarios.ts` empieza comprobando
 * `puedeGestionarUsuarios(await getSesionInterna())`, sin excepción — esa
 * regla es la defensa contra el bug que ya rompió este proyecto tres veces
 * (una función sensible exportada desde un "use server" invocable sin
 * sesión). Esta función es la única excepción real, y a propósito vive en un
 * archivo aparte para no diluir esa regla: quien la llama todavía NO tiene
 * sesión — está definiendo su contraseña por primera vez —, así que exigir
 * `getSesionInterna()` la dejaría inservible.
 *
 * Su guardia es otra, no una ausencia de guardia: el token firmado que
 * `createPasswordSetupToken` emitió cuando un Admin ya autenticado dio de
 * alta (o reinvitó a) este usuario. `verifyPasswordSetupToken` lo verifica
 * ANTES de tocar la base, exactamente como una sesión verificaría una cookie.
 * Sin un token de 48h válido y sin usar, esta función no hace nada.
 */

"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { verifyPasswordSetupToken } from "@/lib/password-setup.server";
import { definirPasswordSchema } from "@/lib/validations";

/** Mismo costo que `pnpm db:seed` usa para el Admin inicial. */
const BCRYPT_COST = 12;

export async function definirPasswordInicial(entrada: {
  token: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = definirPasswordSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  const payload = await verifyPasswordSetupToken(datos.token);
  if (!payload) {
    return {
      ok: false,
      error: "El enlace venció o no es válido. Pide al administrador que te reenvíe la invitación.",
    };
  }

  const [usuario] = await db
    .select({ id: users.id, activo: users.activo })
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!usuario) return { ok: false, error: "Esta cuenta ya no existe." };
  if (!usuario.activo) {
    return { ok: false, error: "Esta cuenta está desactivada. Contacta al administrador." };
  }

  const hash = await bcrypt.hash(datos.password, BCRYPT_COST);
  await db.update(users).set({ password_hash: hash }).where(eq(users.id, usuario.id));

  return { ok: true };
}
