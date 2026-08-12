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

export type RolInterno =
  | "Admin"
  | "Jefe de Taller"
  | "Asesor de Servicio"
  | "Jefe de Marketing"
  | "Asesor Comercial";

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
// disperso por las Server Actions: cuando el taller quiera que el Asesor de
// Servicio también apruebe, se cambia aquí y no en quince archivos.
//
// ── Dos dominios que NO se cruzan, a propósito ──
// Taller (Jefe de Taller, Asesor de Servicio) y Marketing (Jefe de Marketing,
// Asesor Comercial) son mundos separados: decisión explícita del dueño del
// producto, porque el taller no debe poder tocar el inventario de marketing
// ni para consultarlo — "esta parte no debería estar tan dirigida a talleres
// porque la manejaría directamente marketing, que es lo que sabe lo que tiene
// físicamente". El único punto de contacto es `aprobarCanjeAtomico`, que
// descuenta el artículo por su cuenta sin que el Jefe de Taller necesite
// ningún permiso de inventario.
// ─────────────────────────────────────────────────────────────────────────────

/** Escanear el QR del cliente y acreditar puntos por un servicio. */
export function puedeAcreditarPuntos(session: AuthzSession): boolean {
  return (
    session.role === "Admin" ||
    session.role === "Jefe de Taller" ||
    session.role === "Asesor de Servicio"
  );
}

/**
 * Aprobar o rechazar un canje. Decisión del concesionario: SIEMPRE hay
 * revisión humana con criterio de inventario, y el Asesor de Servicio no la
 * tiene — él está en el mostrador, no en bodega.
 */
export function puedeAprobarCanje(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Jefe de Taller";
}

/**
 * Entregar el premio físicamente. Segregación de funciones: quien aprueba no
 * es necesariamente quien entrega, y un Asesor de Servicio solo no puede
 * cerrar el ciclo completo (aprobar + entregar) por su cuenta.
 */
export function puedeEntregarCanje(session: AuthzSession): boolean {
  return (
    session.role === "Admin" ||
    session.role === "Jefe de Taller" ||
    session.role === "Asesor de Servicio"
  );
}

/** Revertir una acreditación errónea o hacer un ajuste manual de puntos. */
export function puedeRevertirPuntos(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Jefe de Taller";
}

/**
 * Administrar el CATÁLOGO de premios: nombre, costo en puntos, visibilidad.
 * No es lo mismo que gestionar inventario (ver `puedeGestionarInventario`):
 * el catálogo es la oferta al cliente, el inventario es lo que hay en bodega.
 * Crear un premio merchandising toca las dos cosas a la vez porque nace con
 * su artículo enlazado — de ahí que comparta el mismo rol.
 */
export function puedeGestionarPremios(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Jefe de Marketing";
}

/**
 * Gestionar el inventario de marketing: alta de artículos, ingresos,
 * ajustes de conteo, umbral de alerta de stock bajo. Terreno exclusivo de
 * marketing — el taller no entra aquí ni para consultar.
 */
export function puedeGestionarInventario(session: AuthzSession): boolean {
  return session.role === "Admin" || session.role === "Jefe de Marketing";
}

/**
 * Registrar una SALIDA de inventario (entrega de vehículo, feria, evento).
 * Es el permiso angosto del Asesor Comercial: puede sacar mercadería y dejar
 * constancia de por qué, pero no dar de alta artículos ni tocar el resto del
 * inventario — eso sigue siendo de `puedeGestionarInventario`.
 */
export function puedeRegistrarSalidaInventario(session: AuthzSession): boolean {
  return (
    session.role === "Admin" ||
    session.role === "Jefe de Marketing" ||
    session.role === "Asesor Comercial"
  );
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
