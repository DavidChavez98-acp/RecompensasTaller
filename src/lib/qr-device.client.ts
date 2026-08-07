/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Almacenamiento local del secreto que genera el código QR.
 *
 * Vive en localStorage porque el código tiene que generarse SIN RED: el
 * teléfono del cliente puede estar sin datos en el mostrador del taller, y ese
 * es justo el momento en que lo necesita.
 *
 * Es un caché, no una fuente de verdad. Safari desaloja el almacenamiento tras
 * 7 días sin uso, `navigator.storage.persist()` no se honra en iOS, y borrar el
 * icono de la pantalla de inicio borra el contenedor entero. Perderlo tiene que
 * ser un inconveniente de un segundo (se aprovisiona otro dispositivo con la
 * sesión), nunca una pérdida de puntos.
 */

const CLAVE = "gp_qr_dispositivo";

export type DispositivoLocal = {
  clienteId: string;
  dispositivoId: string;
  /** base64url */
  secreto: string;
  algoritmo: string;
};

/**
 * Devuelve el dispositivo guardado solo si pertenece al cliente de la sesión
 * actual. Un teléfono compartido (padre e hijo con vehículos distintos) no debe
 * generar el código del otro.
 */
export function leerDispositivoLocal(clienteId: string): DispositivoLocal | null {
  if (typeof window === "undefined") return null;

  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) return null;

    const datos = JSON.parse(crudo) as Partial<DispositivoLocal>;
    if (
      datos.clienteId !== clienteId ||
      typeof datos.dispositivoId !== "string" ||
      typeof datos.secreto !== "string"
    ) {
      return null;
    }

    return {
      clienteId,
      dispositivoId: datos.dispositivoId,
      secreto: datos.secreto,
      algoritmo: datos.algoritmo ?? "hmac-sha256",
    };
  } catch {
    // JSON corrupto o localStorage bloqueado (Safari en navegación privada).
    return null;
  }
}

export function guardarDispositivoLocal(dispositivo: DispositivoLocal): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(dispositivo));
  } catch {
    // Sin almacenamiento el código sigue funcionando en esta sesión; se
    // reaprovisionará en la siguiente visita. No es motivo para romper la vista.
  }
}

export function borrarDispositivoLocal(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CLAVE);
  } catch {
    // sin nada que hacer
  }
}
