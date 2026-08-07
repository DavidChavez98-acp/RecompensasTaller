/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Autorización del personal interno por rol y sucursal.
 *
 * En v1 el concesionario opera con una sola sucursal ("Matriz") y todos los
 * usuarios la tienen asignada, así que el filtro por sucursal es un no-op.
 * La lógica está escrita completa a propósito: encender multi-sucursal es
 * insertar filas en `sucursales` y asignar `sucursal_id`, sin tocar código.
 *
 * Regla heredada del proyecto hermano: un registro fuera de alcance se trata
 * como INEXISTENTE, no como "prohibido" — devolver 403 en vez de 404 filtra
 * la existencia del registro (IDOR).
 */

export type RolInterno = "Admin" | "Jefe de Taller" | "Asesor" | "Marketing";

export type AuthzSession = {
  role: RolInterno;
  sucursal_id: string | null;
};

/** ¿La sesión ve datos de todas las sucursales? */
export function hasFullScope(session: AuthzSession): boolean {
  return session.role === "Admin";
}

/** ¿La sesión puede acceder a un registro de una sucursal dada? */
export function canAccessSucursal(
  session: AuthzSession,
  sucursalId: string | null | undefined
): boolean {
  if (hasFullScope(session)) return true;
  if (!sucursalId) return false; // sucursal desconocida → denegar para usuarios acotados
  return session.sucursal_id === sucursalId;
}

/** Filtra una lista dejando solo los registros accesibles por la sesión. */
export function filterAccessibleBySucursal<T extends { sucursal_id?: string | null }>(
  session: AuthzSession,
  rows: T[]
): T[] {
  if (hasFullScope(session)) return rows;
  return rows.filter((row) => canAccessSucursal(session, row.sucursal_id ?? null));
}

// ─────────────────────────────────────────────────────────────────────────────
// Capacidades por rol
//
// Se declaran como predicados con nombre en vez de comparar `role === "..."`
// disperso por las Server Actions: cuando entre el rol Marketing de verdad, o
// cuando el taller quiera que el Asesor también apruebe, se cambia aquí y no
// en quince archivos.
// ─────────────────────────────────────────────────────────────────────────────

/** Escanear el QR del cliente y acreditar puntos por un servicio. */
export function puedeAcreditarPuntos(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Jefe de Taller" || session.role === "Asesor";
}

/**
 * Aprobar o rechazar un canje. Decisión del concesionario: SIEMPRE hay
 * revisión humana con criterio de inventario, y el Asesor no la tiene — él
 * está en el mostrador, no en bodega.
 */
export function puedeAprobarCanje(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Jefe de Taller";
}

/**
 * Entregar el premio físicamente. Segregación de funciones: quien aprueba no
 * es necesariamente quien entrega, y un Asesor solo no puede cerrar el ciclo
 * completo (aprobar + entregar) por su cuenta.
 */
export function puedeEntregarCanje(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Jefe de Taller" || session.role === "Asesor";
}

/** Revertir una acreditación errónea o hacer un ajuste manual de puntos. */
export function puedeRevertirPuntos(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Jefe de Taller";
}

/** Administrar el catálogo de premios y el inventario de marketing. */
export function puedeGestionarPremios(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Marketing";
}

/** Cambiar las reglas de puntos y los multiplicadores por servicio. */
export function puedeGestionarReglas(session: AuthzSession): boolean {
  return session.role === "Admin";
}

/** Alta, baja y cambio de rol del personal interno. */
export function puedeGestionarUsuarios(session: AuthzSession): boolean {
  return session.role === "Admin";
}

/** Ver reportes y el panel de detección de anomalías. */
export function puedeVerReportes(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Jefe de Taller";
}
