/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Máquina de estados del canje. Función pura, sin base de datos: es la regla de
 * negocio con más aristas del sistema y tiene que poder probarse entera.
 *
 * ── Los dos momentos, y por qué son distintos ──
 *
 * PUNTOS al solicitar. Si se descontaran al entregar, un cliente con 1.000
 * puntos podría solicitar cinco premios de 1.000 y quedarían los cinco
 * "pendientes" con saldo suficiente; el taller aprobaría los cinco y el
 * problema aparecería frente al cliente. La alternativa (saldo_disponible =
 * saldo − reservado) mete una segunda cantidad derivada que hay que mantener
 * consistente con la primera: dos invariantes en vez de una.
 *
 * STOCK al aprobar. Decisión del concesionario: marketing no siempre tiene
 * gorras, así que un humano confirma contra bodega antes de comprometer la
 * unidad. El número del sistema nunca miente porque alguien lo miró.
 *
 * ── Consecuencia asumida ──
 * Si queda una gorra y dos clientes la piden, ambos pagan puntos, el Jefe
 * aprueba a uno y rechaza al otro — y al rechazado se le devuelven los puntos
 * automáticamente. Es el comportamiento correcto con aprobación humana, pero el
 * mensaje de rechazo tiene que decirlo con claridad (ver MOTIVOS_RECHAZO).
 */

import type { EstadoCanje } from "@/db/schema";
import type { AuthzSession } from "./authz";
import { puedeAprobarCanje, puedeEntregarCanje } from "./authz";

/** Quién intenta la transición. El cliente no es un usuario interno. */
export type Actor =
  | { tipo: "cliente"; clienteId: string }
  | { tipo: "usuario"; sesion: AuthzSession };

export type Transicion = {
  desde: EstadoCanje;
  hacia: EstadoCanje;
  /** Signo del movimiento de puntos que provoca. 0 = no toca el ledger. */
  puntos: 0 | 1 | -1;
  /** Signo del movimiento de stock. 0 = no toca inventario. */
  stock: 0 | 1 | -1;
  /** Al aprobar se genera el código que el cliente dicta al recibir. */
  generaCodigoEntrega: boolean;
  /** Al entregar hay que exigir ese código: prueba de presencia del cliente. */
  exigeCodigoEntrega: boolean;
};

export const ESTADOS_TERMINALES: readonly EstadoCanje[] = [
  "entregado",
  "rechazado",
  "cancelado",
] as const;

export function esTerminal(estado: EstadoCanje): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

/**
 * Tabla completa. Todo lo que no esté aquí está prohibido: no hay reglas
 * implícitas ni "si el rol es Admin entonces todo vale".
 */
const TRANSICIONES: Transicion[] = [
  // Cliente pide. Los puntos salen YA.
  { desde: "solicitado", hacia: "cancelado", puntos: 1, stock: 0, generaCodigoEntrega: false, exigeCodigoEntrega: false },
  // Jefe o Admin resuelven la cola.
  { desde: "solicitado", hacia: "aprobado", puntos: 0, stock: -1, generaCodigoEntrega: true, exigeCodigoEntrega: false },
  { desde: "solicitado", hacia: "rechazado", puntos: 1, stock: 0, generaCodigoEntrega: false, exigeCodigoEntrega: false },
  // Ya aprobado: el asesor entrega en el mostrador.
  { desde: "aprobado", hacia: "entregado", puntos: 0, stock: 0, generaCodigoEntrega: false, exigeCodigoEntrega: true },
  // Se aprobó pero al final no se pudo entregar: devuelve puntos Y stock.
  { desde: "aprobado", hacia: "cancelado", puntos: 1, stock: 1, generaCodigoEntrega: false, exigeCodigoEntrega: false },
];

export function buscarTransicion(desde: EstadoCanje, hacia: EstadoCanje): Transicion | null {
  return TRANSICIONES.find((t) => t.desde === desde && t.hacia === hacia) ?? null;
}

export type ResultadoPermiso =
  | { permitido: true; transicion: Transicion }
  | { permitido: false; motivo: string };

/**
 * ¿Puede este actor llevar el canje de un estado a otro?
 *
 * Segregación de funciones: quien aprueba no es quien entrega. El Jefe aprueba
 * mirando bodega, el Asesor entrega en el mostrador. Un Asesor solo no puede
 * cerrar el ciclo completo por su cuenta, que es el vector de fraude obvio
 * (aprobarse un premio y llevárselo).
 */
export function puedeTransicionar(
  actor: Actor,
  canje: { estado: EstadoCanje; cliente_id: string },
  hacia: EstadoCanje
): ResultadoPermiso {
  if (esTerminal(canje.estado)) {
    return { permitido: false, motivo: `Este canje ya está ${canje.estado} y no se puede cambiar.` };
  }

  const transicion = buscarTransicion(canje.estado, hacia);
  if (!transicion) {
    return { permitido: false, motivo: `No se puede pasar de ${canje.estado} a ${hacia}.` };
  }

  if (actor.tipo === "cliente") {
    if (actor.clienteId !== canje.cliente_id) {
      // Tratar el canje ajeno como inexistente, no como prohibido: un 403
      // confirmaría que ese identificador existe.
      return { permitido: false, motivo: "Ese canje no existe." };
    }
    // Lo único que el cliente puede hacer es arrepentirse, y solo antes de que
    // el taller comprometa una unidad de inventario.
    if (hacia !== "cancelado" || canje.estado !== "solicitado") {
      return { permitido: false, motivo: "Solo puedes cancelar un canje que aún no ha sido aprobado." };
    }
    return { permitido: true, transicion };
  }

  const { sesion } = actor;

  if (hacia === "aprobado" || hacia === "rechazado") {
    if (!puedeAprobarCanje(sesion)) {
      return { permitido: false, motivo: "Solo el Jefe de Taller o el Admin aprueban canjes." };
    }
    return { permitido: true, transicion };
  }

  if (hacia === "entregado") {
    if (!puedeEntregarCanje(sesion)) {
      return { permitido: false, motivo: "Tu rol no permite entregar premios." };
    }
    return { permitido: true, transicion };
  }

  if (hacia === "cancelado") {
    // "cancelado" tiene DOS filas válidas en la tabla: solicitado→cancelado
    // (el cliente se arrepiente antes de que el taller reserve nada) y
    // aprobado→cancelado (el taller deshace una reserva ya hecha). Un actor
    // "usuario" solo puede la segunda — la primera es del cliente, más arriba.
    // Sin este chequeo por `canje.estado`, `cancelarCanjeAprobado` podía
    // devolver los puntos de un canje que seguía 'solicitado' (el reverso ya
    // se aplica antes del UPDATE de estado) y dejarlo abierto para que luego
    // se apruebe normalmente: el cliente se queda con los puntos Y el premio.
    if (canje.estado !== "aprobado") {
      return {
        permitido: false,
        motivo: "Solo el cliente puede cancelar un canje que todavía no fue aprobado.",
      };
    }
    if (!puedeAprobarCanje(sesion)) {
      return { permitido: false, motivo: "Solo el Jefe de Taller o el Admin cancelan un canje aprobado." };
    }
    return { permitido: true, transicion };
  }

  return { permitido: false, motivo: "Transición no permitida." };
}

/** Estados a los que un actor puede llevar el canje ahora mismo. */
export function transicionesDisponibles(
  actor: Actor,
  canje: { estado: EstadoCanje; cliente_id: string }
): EstadoCanje[] {
  const posibles: EstadoCanje[] = ["aprobado", "rechazado", "entregado", "cancelado"];
  return posibles.filter((hacia) => puedeTransicionar(actor, canje, hacia).permitido);
}

/**
 * Motivos de rechazo predefinidos. El de stock agotado es el importante: el
 * cliente ya pagó los puntos, y el mensaje tiene que explicar que se le
 * devolvieron, no soltar un error genérico.
 */
export const MOTIVOS_RECHAZO = {
  sin_stock: "Ya no tenemos ese premio disponible. Te devolvimos tus puntos.",
  premio_retirado: "Ese premio salió del catálogo. Te devolvimos tus puntos.",
  cliente_no_verificado: "Necesitamos verificar tu cédula en el taller antes de entregar premios. Te devolvimos tus puntos.",
  otro: "Te devolvimos tus puntos.",
} as const;

export type MotivoRechazo = keyof typeof MOTIVOS_RECHAZO;

/**
 * Motivos de cancelación de un canje YA aprobado (stock ya apartado). El
 * mensaje también avisa que el stock vuelve a bodega, no solo los puntos.
 */
export const MOTIVOS_CANCELACION_APROBADO = {
  cliente_no_retiro: "El cliente nunca retiró el premio. Te devolvimos tus puntos.",
  producto_dañado: "El producto se dañó en bodega antes de la entrega. Te devolvimos tus puntos.",
  otro: "Te devolvimos tus puntos.",
} as const;

export type MotivoCancelacionAprobado = keyof typeof MOTIVOS_CANCELACION_APROBADO;

export function textoEstado(estado: EstadoCanje): string {
  switch (estado) {
    case "solicitado":
      return "En revisión";
    case "aprobado":
      return "Listo para retirar";
    case "entregado":
      return "Entregado";
    case "rechazado":
      return "Rechazado";
    case "cancelado":
      return "Cancelado";
  }
}

/** Qué debe leer el cliente en su app según el estado. */
export function explicacionCliente(estado: EstadoCanje): string {
  switch (estado) {
    case "solicitado":
      return "Estamos revisando que tengamos el premio disponible. Tus puntos ya fueron descontados; si lo rechazamos o lo cancelas, se te devuelven automáticamente.";
    case "aprobado":
      return "Acércate al taller con este código y te lo entregamos.";
    case "entregado":
      return "Ya lo recibiste. ¡Gracias!";
    case "rechazado":
      return "No pudimos entregarte este premio y te devolvimos los puntos.";
    case "cancelado":
      return "Se canceló y te devolvimos los puntos.";
  }
}
