/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Gestión del personal interno: alta por invitación, cambio de rol, baja
 * (desactivación) y reenvío de invitación. Reemplaza al placeholder de
 * `/interno/usuarios` — hasta ahora el alta se hacía a mano desde `pnpm db:seed`.
 *
 * ── El módulo más sensible del "use server" es endpoint público ──
 * Toda función exportada de aquí es invocable desde el navegador con
 * cualquier argumento — no es una regla nueva, ya rompió el proyecto tres
 * veces (`obtenerSecretoDispositivo`, `createPasswordSetupToken`,
 * `avisarStockBajo`; ver AGENTS.md). Gestionar cuentas de personal es el
 * dominio más sensible de todos: quien controla `role` y `activo` de un
 * usuario controla quién puede acreditar puntos o aprobar canjes. Por eso
 * CADA función de este archivo, sin excepción, empieza comprobando
 * `puedeGestionarUsuarios(await getSesionInterna())` y retorna un error ANTES
 * de tocar la base si no pasa.
 *
 * La única función del flujo de invitación que NO vive aquí es
 * `definirPasswordInicial` (ver `src/actions/definir-password.ts`): quien la
 * llama todavía no tiene sesión, así que no puede exigir ese mismo guard.
 * Mantenerla en un archivo aparte evita que alguien copie una función de este
 * archivo en el futuro sin fijarse en que esta es la única excepción.
 */

"use server";

import { db } from "@/db";
import { sucursales, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSesionInterna } from "./auth-interno";
import { puedeGestionarUsuarios, type RolInterno } from "@/lib/authz";
import { createPasswordSetupToken } from "@/lib/password-setup.server";
import { getBaseUrl, sendPasswordSetupInvite } from "@/lib/mail";
import { computeBlindIndex } from "@/lib/pii-crypto";
import { logAdminAction } from "@/lib/admin-audit";
import { SUCURSAL_MATRIZ_CODIGO } from "@/lib/constants";
import {
  cambiarEstadoUsuarioSchema,
  cambiarRolUsuarioSchema,
  crearUsuarioSchema,
} from "@/lib/validations";

/** SQLSTATE de Postgres para violación de restricción única. */
const UNIQUE_VIOLATION = "23505";

/**
 * Busca un SQLSTATE recorriendo la cadena de `cause`. NO se compara el texto
 * del mensaje: Drizzle envuelve el error de `pg` en un `DrizzleQueryError`
 * cuyo mensaje solo dice "Failed query: insert into…", sin rastro de
 * "duplicate key" — ver `esViolacionDeUnicidad` en `src/lib/saldo.ts` y la
 * nota de AGENTS.md sobre este bug exacto.
 */
function tieneCodigoSql(error: unknown, codigo: string): boolean {
  let actual: unknown = error;
  for (let profundidad = 0; actual && profundidad < 5; profundidad++) {
    if ((actual as { code?: string }).code === codigo) return true;
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

export type UsuarioListado = {
  id: string;
  email: string | null;
  nombre: string;
  role: RolInterno;
  activo: boolean;
  /** true si ya definió su contraseña; false = "Invitación pendiente" en la UI. */
  tieneAcceso: boolean;
  ultimoAcceso: Date | null;
};

export async function listarUsuarios(): Promise<UsuarioListado[]> {
  const sesion = await getSesionInterna();
  if (!sesion || !puedeGestionarUsuarios(sesion)) return [];

  const filas = await db
    .select({
      id: users.id,
      email: users.email,
      nombre: users.nombre,
      role: users.role,
      activo: users.activo,
      passwordHash: users.password_hash,
      ultimoAcceso: users.ultimo_acceso,
    })
    .from(users)
    .orderBy(users.nombre);

  // El hash nunca sale de esta función, ni cifrado ni en claro: solo el
  // booleano que la UI necesita para decidir si mostrar "Invitación pendiente".
  return filas.map((f) => ({
    id: f.id,
    email: f.email,
    nombre: f.nombre,
    role: f.role,
    activo: f.activo,
    tieneAcceso: f.passwordHash !== null,
    ultimoAcceso: f.ultimoAcceso,
  }));
}

async function resolverSucursalMatriz(): Promise<string | null> {
  const [matriz] = await db
    .select({ id: sucursales.id })
    .from(sucursales)
    .where(eq(sucursales.codigo, SUCURSAL_MATRIZ_CODIGO))
    .limit(1);
  return matriz?.id ?? null;
}

/** Emite el token de 48h y dispara el correo. Compartido por alta y reenvío. */
async function enviarInvitacion(
  userId: string,
  email: string,
  nombre: string
): Promise<{ ok: boolean; error?: string }> {
  const token = await createPasswordSetupToken(userId);
  const url = `${getBaseUrl()}/interno/definir-password?token=${token}`;
  const resultado = await sendPasswordSetupInvite({ to: email, nombre, url });
  return { ok: resultado.success, error: resultado.error };
}

export async function crearUsuario(entrada: {
  email: string;
  nombre: string;
  role: RolInterno;
  identificacion?: string;
}): Promise<
  | { ok: true; userId: string; correoEnviado: boolean; errorCorreo?: string }
  | { ok: false; error: string }
> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarUsuarios(sesion)) {
    return { ok: false, error: "Tu rol no permite gestionar usuarios." };
  }

  const parsed = crearUsuarioSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  // Comprobación previa para dar un mensaje legible en el caso normal — el
  // UNIQUE de `users.email` sigue siendo la defensa real contra una carrera
  // (dos altas casi simultáneas con el mismo correo), capturada más abajo.
  const [existente] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, datos.email))
    .limit(1);
  if (existente) {
    return { ok: false, error: `Ya existe una cuenta con el correo ${datos.email}.` };
  }

  const sucursalId = await resolverSucursalMatriz();

  let creado: { id: string } | undefined;
  try {
    const filas = await db
      .insert(users)
      .values({
        email: datos.email,
        nombre: datos.nombre,
        role: datos.role,
        sucursal_id: sucursalId,
        identificacion_idx: datos.identificacion ? computeBlindIndex(datos.identificacion) : null,
        // Sin contraseña hasta que use el enlace de invitación: nunca se
        // autentica sobre una cuenta recién creada en el primer login.
        password_hash: null,
      })
      .returning({ id: users.id });
    creado = filas[0];
  } catch (error) {
    if (tieneCodigoSql(error, UNIQUE_VIOLATION)) {
      return { ok: false, error: `Ya existe una cuenta con el correo ${datos.email}.` };
    }
    throw error;
  }

  if (!creado) return { ok: false, error: "No se pudo crear el usuario." };

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "usuario_creado",
    "users",
    creado.id,
    { email: datos.email, role: datos.role }
  );

  // Si el correo falla, el usuario YA quedó creado — no se revoca. El Admin
  // puede reenviar la invitación desde la UI; lo único que se pierde es el
  // primer intento de envío, no la cuenta.
  const envio = await enviarInvitacion(creado.id, datos.email, datos.nombre);

  revalidatePath("/interno/usuarios");
  return {
    ok: true,
    userId: creado.id,
    correoEnviado: envio.ok,
    errorCorreo: envio.ok ? undefined : envio.error,
  };
}

export async function reenviarInvitacion(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarUsuarios(sesion)) {
    return { ok: false, error: "Tu rol no permite gestionar usuarios." };
  }

  const [usuario] = await db
    .select({
      id: users.id,
      email: users.email,
      nombre: users.nombre,
      passwordHash: users.password_hash,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!usuario) return { ok: false, error: "Usuario no encontrado." };
  if (usuario.passwordHash !== null) {
    return {
      ok: false,
      error: "Este usuario ya configuró su contraseña; reenviar la invitación no tiene efecto.",
    };
  }
  if (!usuario.email) return { ok: false, error: "Este usuario no tiene correo configurado." };

  const envio = await enviarInvitacion(usuario.id, usuario.email, usuario.nombre);
  if (!envio.ok) {
    return { ok: false, error: envio.error ?? "No se pudo enviar el correo de invitación." };
  }

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "invitacion_reenviada",
    "users",
    usuario.id
  );

  return { ok: true };
}

export async function cambiarRolUsuario(entrada: {
  userId: string;
  role: RolInterno;
}): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarUsuarios(sesion)) {
    return { ok: false, error: "Tu rol no permite gestionar usuarios." };
  }

  const parsed = cambiarRolUsuarioSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  // Guardia: un Admin solitario que se quita su propio rol de Admin se
  // autobloquea del panel entero, sin nadie que pueda revertirlo.
  if (datos.userId === sesion.id && datos.role !== "Admin") {
    return {
      ok: false,
      error: "No puedes quitarte tu propio rol de Admin — pide a otro Admin que lo haga.",
    };
  }

  const filas = await db
    .update(users)
    .set({ role: datos.role })
    .where(eq(users.id, datos.userId))
    .returning({ id: users.id });

  if (!filas[0]) return { ok: false, error: "Usuario no encontrado." };

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    "usuario_rol_cambiado",
    "users",
    datos.userId,
    { role: datos.role }
  );

  revalidatePath("/interno/usuarios");
  return { ok: true };
}

export async function cambiarEstadoUsuario(entrada: {
  userId: string;
  activo: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const sesion = await getSesionInterna();
  if (!sesion) return { ok: false, error: "Tu sesión venció." };
  if (!puedeGestionarUsuarios(sesion)) {
    return { ok: false, error: "Tu rol no permite gestionar usuarios." };
  }

  const parsed = cambiarEstadoUsuarioSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const datos = parsed.data;

  // Misma guardia que el cambio de rol: un Admin no puede desactivarse a sí
  // mismo. `getSesionInterna()` ya revoca sesiones vivas al desactivar a
  // OTRO usuario (se relee `activo` en cada request), así que sin esta
  // guardia un Admin solitario podría cerrarse la puerta del panel él mismo.
  if (datos.userId === sesion.id && !datos.activo) {
    return {
      ok: false,
      error: "No puedes desactivar tu propia cuenta — pide a otro Admin que lo haga.",
    };
  }

  const filas = await db
    .update(users)
    .set({ activo: datos.activo })
    .where(eq(users.id, datos.userId))
    .returning({ id: users.id });

  if (!filas[0]) return { ok: false, error: "Usuario no encontrado." };

  await logAdminAction(
    { id: sesion.id, email: sesion.email, nombre: sesion.nombre },
    datos.activo ? "usuario_activado" : "usuario_desactivado",
    "users",
    datos.userId
  );

  revalidatePath("/interno/usuarios");
  return { ok: true };
}
