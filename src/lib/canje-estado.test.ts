/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Matriz completa de transiciones × rol, incluidas las prohibidas.
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buscarTransicion,
  esTerminal,
  ESTADOS_TERMINALES,
  explicacionCliente,
  MOTIVOS_RECHAZO,
  puedeTransicionar,
  textoEstado,
  transicionesDisponibles,
  type Actor,
} from "./canje-estado";
import type { AuthzSession, RolInterno } from "./authz";
import type { EstadoCanje } from "@/db/schema";

const CLIENTE_ID = "11111111-1111-1111-1111-111111111111";
const OTRO_CLIENTE_ID = "22222222-2222-2222-2222-222222222222";
const SUCURSAL = "33333333-3333-3333-3333-333333333333";

function sesion(role: RolInterno): AuthzSession {
  return { role, sucursal_id: SUCURSAL };
}

function usuario(role: RolInterno): Actor {
  return { tipo: "usuario", sesion: sesion(role) };
}

const CLIENTE: Actor = { tipo: "cliente", clienteId: CLIENTE_ID };

function canje(estado: EstadoCanje) {
  return { estado, cliente_id: CLIENTE_ID };
}

const TODOS_LOS_ESTADOS: EstadoCanje[] = [
  "solicitado",
  "aprobado",
  "entregado",
  "rechazado",
  "cancelado",
];

// ─────────────────────────────────────────────────────────────────────────────
// Efectos de cada transición
// ─────────────────────────────────────────────────────────────────────────────

test("aprobar reserva stock pero NO toca puntos (ya se cobraron al solicitar)", () => {
  const t = buscarTransicion("solicitado", "aprobado");
  assert.notEqual(t, null);
  assert.equal(t!.puntos, 0, "los puntos salieron al solicitar, no al aprobar");
  assert.equal(t!.stock, -1, "aquí sí se compromete la unidad de bodega");
  assert.equal(t!.generaCodigoEntrega, true);
});

test("rechazar devuelve puntos y NO toca stock (nunca se reservó)", () => {
  const t = buscarTransicion("solicitado", "rechazado");
  assert.equal(t!.puntos, 1, "se devuelven los puntos");
  assert.equal(t!.stock, 0, "no había unidad comprometida que liberar");
});

test("cancelar antes de aprobar devuelve puntos y no toca stock", () => {
  const t = buscarTransicion("solicitado", "cancelado");
  assert.equal(t!.puntos, 1);
  assert.equal(t!.stock, 0);
});

test("cancelar DESPUÉS de aprobar devuelve puntos Y stock", () => {
  // Es la única transición que mueve las dos cosas: la unidad ya estaba
  // apartada en bodega y hay que devolverla al catálogo.
  const t = buscarTransicion("aprobado", "cancelado");
  assert.equal(t!.puntos, 1);
  assert.equal(t!.stock, 1);
});

test("entregar no mueve ni puntos ni stock, pero exige el código", () => {
  const t = buscarTransicion("aprobado", "entregado");
  assert.equal(t!.puntos, 0);
  assert.equal(t!.stock, 0, "el stock ya bajó al aprobar");
  assert.equal(t!.exigeCodigoEntrega, true, "prueba de que el cliente está presente");
});

test("no existe transición directa de solicitado a entregado", () => {
  // Saltarse la aprobación dejaría el inventario sin revisar, que es justo lo
  // que el concesionario pidió evitar.
  assert.equal(buscarTransicion("solicitado", "entregado"), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Permisos por rol
// ─────────────────────────────────────────────────────────────────────────────

test("Jefe de Taller y Admin aprueban; Asesor y Marketing no", () => {
  assert.equal(puedeTransicionar(usuario("Jefe de Taller"), canje("solicitado"), "aprobado").permitido, true);
  assert.equal(puedeTransicionar(usuario("Admin"), canje("solicitado"), "aprobado").permitido, true);
  assert.equal(puedeTransicionar(usuario("Asesor de Servicio"), canje("solicitado"), "aprobado").permitido, false);
  assert.equal(puedeTransicionar(usuario("Jefe de Marketing"), canje("solicitado"), "aprobado").permitido, false);
});

test("el Asesor SÍ entrega: está en el mostrador con el cliente", () => {
  assert.equal(puedeTransicionar(usuario("Asesor de Servicio"), canje("aprobado"), "entregado").permitido, true);
  assert.equal(puedeTransicionar(usuario("Jefe de Taller"), canje("aprobado"), "entregado").permitido, true);
  assert.equal(puedeTransicionar(usuario("Jefe de Marketing"), canje("aprobado"), "entregado").permitido, false);
});

test("segregación de funciones: un Asesor solo no cierra el ciclo", () => {
  // Este es el vector de fraude obvio: aprobarse un premio y llevárselo.
  const asesor = usuario("Asesor de Servicio");
  assert.equal(puedeTransicionar(asesor, canje("solicitado"), "aprobado").permitido, false);
  assert.equal(puedeTransicionar(asesor, canje("aprobado"), "entregado").permitido, true);
  assert.equal(
    transicionesDisponibles(asesor, canje("solicitado")).length,
    0,
    "sobre un canje recién solicitado, el Asesor no puede hacer nada"
  );
});

test("Marketing gestiona catálogo pero no toca la cola de canjes", () => {
  const marketing = usuario("Jefe de Marketing");
  for (const estado of ["solicitado", "aprobado"] as EstadoCanje[]) {
    assert.deepEqual(
      transicionesDisponibles(marketing, canje(estado)),
      [],
      `Marketing no debería poder mover un canje ${estado}`
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// El cliente
// ─────────────────────────────────────────────────────────────────────────────

test("el cliente solo puede cancelar, y solo antes de que se apruebe", () => {
  assert.equal(puedeTransicionar(CLIENTE, canje("solicitado"), "cancelado").permitido, true);
  assert.equal(
    puedeTransicionar(CLIENTE, canje("aprobado"), "cancelado").permitido,
    false,
    "ya hay una unidad apartada en bodega; que la libere el taller"
  );
  assert.equal(puedeTransicionar(CLIENTE, canje("solicitado"), "aprobado").permitido, false);
  assert.equal(puedeTransicionar(CLIENTE, canje("aprobado"), "entregado").permitido, false);
});

test("el canje de otro cliente se trata como INEXISTENTE, no como prohibido", () => {
  const ajeno = { estado: "solicitado" as EstadoCanje, cliente_id: OTRO_CLIENTE_ID };
  const resultado = puedeTransicionar(CLIENTE, ajeno, "cancelado");

  assert.equal(resultado.permitido, false);
  if (!resultado.permitido) {
    // "No tienes permiso" confirmaría que ese identificador existe (IDOR).
    assert.match(resultado.motivo, /no existe/i);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Estados terminales
// ─────────────────────────────────────────────────────────────────────────────

test("de un estado terminal no sale nadie, con ningún rol", () => {
  const actores: Actor[] = [
    CLIENTE,
    usuario("Admin"),
    usuario("Jefe de Taller"),
    usuario("Asesor de Servicio"),
    usuario("Jefe de Marketing"),
  ];

  for (const estado of ESTADOS_TERMINALES) {
    for (const actor of actores) {
      assert.deepEqual(
        transicionesDisponibles(actor, canje(estado)),
        [],
        `alguien pudo mover un canje ${estado}`
      );
    }
  }
});

test("entregado es terminal: ni el Admin puede revertirlo por aquí", () => {
  // Deshacer una entrega es un ajuste manual de puntos con motivo, no un
  // cambio de estado silencioso.
  assert.equal(esTerminal("entregado"), true);
  assert.equal(puedeTransicionar(usuario("Admin"), canje("entregado"), "cancelado").permitido, false);
});

/**
 * "cancelado" tiene dos filas en la tabla: solicitado→cancelado (el cliente)
 * y aprobado→cancelado (el taller deshace una reserva). Un actor "usuario"
 * NO puede usar la primera aunque `buscarTransicion` encuentre una fila —
 * `cancelarCanjeAprobado` aplica el reverso de puntos ANTES del UPDATE de
 * estado, así que si esto no se filtrara por `canje.estado`, un canje que
 * sigue 'solicitado' se quedaría con los puntos devueltos y la solicitud
 * intacta en la cola, lista para aprobarse igual: puntos de vuelta Y premio.
 */
test("un usuario NO puede cancelar un canje que todavía está 'solicitado'", () => {
  for (const rol of ["Admin", "Jefe de Taller"] as const) {
    const resultado = puedeTransicionar(usuario(rol), canje("solicitado"), "cancelado");
    assert.equal(resultado.permitido, false, `${rol} pudo cancelar un canje solicitado`);
  }
  // El cliente sí puede, y sigue siendo la única vía para ese estado.
  assert.equal(puedeTransicionar(CLIENTE, canje("solicitado"), "cancelado").permitido, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Matriz completa: nada fuera de la tabla está permitido
// ─────────────────────────────────────────────────────────────────────────────

test("matriz completa: solo las 5 transiciones declaradas son posibles", () => {
  const esperadas = new Set([
    "solicitado→aprobado",
    "solicitado→rechazado",
    "solicitado→cancelado",
    "aprobado→entregado",
    "aprobado→cancelado",
  ]);

  let encontradas = 0;
  for (const desde of TODOS_LOS_ESTADOS) {
    for (const hacia of TODOS_LOS_ESTADOS) {
      const existe = buscarTransicion(desde, hacia) !== null;
      const clave = `${desde}→${hacia}`;
      assert.equal(existe, esperadas.has(clave), `${clave} no coincide con lo declarado`);
      if (existe) encontradas++;
    }
  }
  assert.equal(encontradas, esperadas.size);
});

test("ninguna transición se queda en el mismo estado", () => {
  for (const estado of TODOS_LOS_ESTADOS) {
    assert.equal(buscarTransicion(estado, estado), null, `${estado} → ${estado} no debería existir`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Textos que ve el cliente
// ─────────────────────────────────────────────────────────────────────────────

test("todos los estados tienen texto y explicación en español", () => {
  for (const estado of TODOS_LOS_ESTADOS) {
    assert.ok(textoEstado(estado).length > 0, `falta texto para ${estado}`);
    assert.ok(explicacionCliente(estado).length > 0, `falta explicación para ${estado}`);
  }
});

test("el motivo de stock agotado dice explícitamente que se devolvieron los puntos", () => {
  // El cliente ya pagó. Un error genérico aquí genera un reclamo en mostrador.
  for (const motivo of Object.values(MOTIVOS_RECHAZO)) {
    assert.match(motivo, /devolvimos tus puntos/i);
  }
});

test("la explicación de 'solicitado' avisa que los puntos YA se descontaron", () => {
  // La interfaz no puede ocultar que el cobro es al pedir, no al recibir.
  assert.match(explicacionCliente("solicitado"), /descontados/i);
  assert.match(explicacionCliente("solicitado"), /se te devuelven/i);
});
