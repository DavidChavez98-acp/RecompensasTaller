/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Matriz COMPLETA de rol × capacidad, incluidas las combinaciones prohibidas.
 *
 * Es superficie de seguridad: `src/app/interno/(panel)/layout.tsx` solo oculta
 * enlaces, así que estos predicados son la única defensa real cuando alguien
 * escribe la URL a mano. La tabla se declara entera y se comprueba que cubra
 * las 5 filas × 10 columnas: si mañana entra un rol nuevo o una capacidad
 * nueva y nadie decide qué hace, esta prueba cae.
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAccessSucursal,
  filterAccessibleBySucursal,
  hasFullScope,
  puedeAcreditarPuntos,
  puedeAprobarCanje,
  puedeEntregarCanje,
  puedeGestionarInventario,
  puedeGestionarPremios,
  puedeGestionarReglas,
  puedeGestionarUsuarios,
  puedeRegistrarSalidaInventario,
  puedeRevertirPuntos,
  puedeVerReportes,
  type AuthzSession,
  type RolInterno,
} from "./authz";

const MATRIZ = "33333333-3333-3333-3333-333333333333";
const OTRA_SUCURSAL = "44444444-4444-4444-4444-444444444444";

const ROLES: RolInterno[] = [
  "Admin",
  "Jefe de Taller",
  "Asesor de Servicio",
  "Jefe de Marketing",
  "Asesor Comercial",
];

function sesion(role: RolInterno, sucursal_id: string | null = MATRIZ): AuthzSession {
  return { role, sucursal_id };
}

// ─────────────────────────────────────────────────────────────────────────────
// La tabla. Se escribe entera a mano —incluidos los `false`— porque un hueco
// aquí es un permiso concedido por descuido.
//
// Dos dominios que NO se cruzan: taller (Jefe de Taller, Asesor de Servicio)
// y marketing (Jefe de Marketing, Asesor Comercial). Decisión del dueño del
// producto: el taller no debe poder tocar el inventario de marketing ni para
// consultarlo, y marketing no toca puntos ni canjes.
// ─────────────────────────────────────────────────────────────────────────────

type Capacidad = {
  nombre: string;
  predicado: (s: AuthzSession) => boolean;
  /** Rol → si puede. TODOS los roles, siempre. */
  esperado: Record<RolInterno, boolean>;
};

const CAPACIDADES: Capacidad[] = [
  {
    nombre: "puedeAcreditarPuntos",
    predicado: puedeAcreditarPuntos,
    esperado: {
      Admin: true,
      "Jefe de Taller": true,
      // El Asesor de Servicio es quien está en el mostrador con la cámara.
      "Asesor de Servicio": true,
      // Marketing gestiona inventario, no toca el ledger de puntos.
      "Jefe de Marketing": false,
      "Asesor Comercial": false,
    },
  },
  {
    nombre: "puedeAprobarCanje",
    predicado: puedeAprobarCanje,
    esperado: {
      Admin: true,
      "Jefe de Taller": true,
      // Aprobar exige criterio de inventario del TALLER: el Asesor no lo tiene.
      "Asesor de Servicio": false,
      "Jefe de Marketing": false,
      "Asesor Comercial": false,
    },
  },
  {
    nombre: "puedeEntregarCanje",
    predicado: puedeEntregarCanje,
    esperado: {
      Admin: true,
      "Jefe de Taller": true,
      "Asesor de Servicio": true,
      "Jefe de Marketing": false,
      "Asesor Comercial": false,
    },
  },
  {
    nombre: "puedeRevertirPuntos",
    predicado: puedeRevertirPuntos,
    esperado: {
      Admin: true,
      "Jefe de Taller": true,
      // Quien acredita no puede deshacerlo solo: es el vector de fraude.
      "Asesor de Servicio": false,
      "Jefe de Marketing": false,
      "Asesor Comercial": false,
    },
  },
  {
    nombre: "puedeGestionarPremios",
    predicado: puedeGestionarPremios,
    esperado: {
      Admin: true,
      // Ojo: el Jefe de Taller aprueba canjes pero NO edita el catálogo.
      "Jefe de Taller": false,
      "Asesor de Servicio": false,
      "Jefe de Marketing": true,
      "Asesor Comercial": false,
    },
  },
  {
    nombre: "puedeGestionarInventario",
    predicado: puedeGestionarInventario,
    esperado: {
      Admin: true,
      // El taller queda AFUERA por completo, ni para consultar.
      "Jefe de Taller": false,
      "Asesor de Servicio": false,
      "Jefe de Marketing": true,
      // El Comercial solo saca mercadería (ver puedeRegistrarSalidaInventario),
      // no da de alta artículos ni hace ingresos.
      "Asesor Comercial": false,
    },
  },
  {
    nombre: "puedeRegistrarSalidaInventario",
    predicado: puedeRegistrarSalidaInventario,
    esperado: {
      Admin: true,
      "Jefe de Taller": false,
      "Asesor de Servicio": false,
      "Jefe de Marketing": true,
      // El único permiso que tiene el Asesor Comercial en todo el sistema.
      "Asesor Comercial": true,
    },
  },
  {
    nombre: "puedeGestionarReglas",
    predicado: puedeGestionarReglas,
    esperado: {
      // Cambiar la regla cambia cuánto vale cada dólar del taller.
      Admin: true,
      "Jefe de Taller": false,
      "Asesor de Servicio": false,
      "Jefe de Marketing": false,
      "Asesor Comercial": false,
    },
  },
  {
    nombre: "puedeGestionarUsuarios",
    predicado: puedeGestionarUsuarios,
    esperado: {
      Admin: true,
      "Jefe de Taller": false,
      "Asesor de Servicio": false,
      "Jefe de Marketing": false,
      "Asesor Comercial": false,
    },
  },
  {
    nombre: "puedeVerReportes",
    predicado: puedeVerReportes,
    esperado: {
      Admin: true,
      "Jefe de Taller": true,
      // El panel de anomalías señala por asesor; no lo ve el señalado.
      "Asesor de Servicio": false,
      "Jefe de Marketing": false,
      "Asesor Comercial": false,
    },
  },
];

test("matriz rol × capacidad: cada combinación da exactamente lo declarado", () => {
  for (const capacidad of CAPACIDADES) {
    for (const role of ROLES) {
      assert.equal(
        capacidad.predicado(sesion(role)),
        capacidad.esperado[role],
        `${capacidad.nombre}("${role}") no coincide con lo declarado`
      );
    }
  }
});

test("la tabla cubre los 5 roles en las 10 capacidades (sin huecos)", () => {
  // Un rol nuevo sin decisión explícita, o una capacidad sin fila, tiene que
  // hacer caer esta prueba antes de llegar a producción.
  assert.equal(CAPACIDADES.length, 10, "¿se añadió o quitó una capacidad?");
  for (const capacidad of CAPACIDADES) {
    assert.deepEqual(
      Object.keys(capacidad.esperado).sort(),
      [...ROLES].sort(),
      `${capacidad.nombre} no declara todos los roles`
    );
  }
});

test("Jefe de Marketing NO puede hacer absolutamente nada del flujo de puntos ni canjes", () => {
  const marketing = sesion("Jefe de Marketing");
  assert.equal(puedeAcreditarPuntos(marketing), false);
  assert.equal(puedeAprobarCanje(marketing), false);
  assert.equal(puedeEntregarCanje(marketing), false);
  assert.equal(puedeRevertirPuntos(marketing), false);
  assert.equal(puedeVerReportes(marketing), false);
});

test("el taller (Jefe de Taller y Asesor de Servicio) NO toca el inventario de marketing, ni para consultar", () => {
  for (const role of ["Jefe de Taller", "Asesor de Servicio"] as const) {
    const s = sesion(role);
    assert.equal(puedeGestionarPremios(s), false, `${role}: puedeGestionarPremios`);
    assert.equal(puedeGestionarInventario(s), false, `${role}: puedeGestionarInventario`);
    assert.equal(puedeRegistrarSalidaInventario(s), false, `${role}: puedeRegistrarSalidaInventario`);
  }
});

test("el Asesor Comercial SOLO puede registrar salidas de inventario, nada más", () => {
  const comercial = sesion("Asesor Comercial");
  assert.equal(puedeRegistrarSalidaInventario(comercial), true);
  // Todo lo demás, incluida la gestión completa de inventario, es NO.
  assert.equal(puedeGestionarInventario(comercial), false);
  assert.equal(puedeGestionarPremios(comercial), false);
  assert.equal(puedeAcreditarPuntos(comercial), false);
  assert.equal(puedeAprobarCanje(comercial), false);
  assert.equal(puedeEntregarCanje(comercial), false);
  assert.equal(puedeRevertirPuntos(comercial), false);
  assert.equal(puedeVerReportes(comercial), false);
  assert.equal(puedeGestionarReglas(comercial), false);
  assert.equal(puedeGestionarUsuarios(comercial), false);
});

test("el Asesor de Servicio no puede cerrar el ciclo de un canje por su cuenta", () => {
  // Aprobar + entregar en la misma persona es "regálate una gorra".
  const asesor = sesion("Asesor de Servicio");
  assert.equal(puedeAprobarCanje(asesor), false);
  assert.equal(puedeEntregarCanje(asesor), true);
});

test("solo el Admin toca la configuración que afecta al dinero y a las cuentas", () => {
  for (const role of ROLES) {
    const esAdmin = role === "Admin";
    assert.equal(puedeGestionarReglas(sesion(role)), esAdmin, `reglas / ${role}`);
    assert.equal(puedeGestionarUsuarios(sesion(role)), esAdmin, `usuarios / ${role}`);
  }
});

test("ningún rol distinto de Admin tiene alcance completo", () => {
  assert.equal(hasFullScope(sesion("Admin")), true);
  for (const role of ROLES.filter((r) => r !== "Admin")) {
    assert.equal(hasFullScope(sesion(role)), false, role);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Alcance por sucursal (no-op en v1, pero la lógica está escrita)
// ─────────────────────────────────────────────────────────────────────────────

test("canAccessSucursal deja pasar al Admin siempre, incluso sin sucursal conocida", () => {
  const admin = sesion("Admin", null);
  assert.equal(canAccessSucursal(admin, MATRIZ), true);
  assert.equal(canAccessSucursal(admin, OTRA_SUCURSAL), true);
  assert.equal(canAccessSucursal(admin, null), true);
  assert.equal(canAccessSucursal(admin, undefined), true);
});

test("un rol acotado solo accede a SU sucursal", () => {
  const jefe = sesion("Jefe de Taller", MATRIZ);
  assert.equal(canAccessSucursal(jefe, MATRIZ), true);
  assert.equal(canAccessSucursal(jefe, OTRA_SUCURSAL), false);
});

test("sucursal desconocida se DENIEGA al rol acotado (no se asume la propia)", () => {
  // Un registro sin sucursal_id no puede colarse por defecto: sería un agujero
  // silencioso el día que se encienda multi-sucursal.
  const asesor = sesion("Asesor de Servicio", MATRIZ);
  assert.equal(canAccessSucursal(asesor, null), false);
  assert.equal(canAccessSucursal(asesor, undefined), false);
  assert.equal(canAccessSucursal(asesor, ""), false, "cadena vacía es tan desconocida como null");
});

test("una sesión acotada SIN sucursal asignada no ve nada ajeno", () => {
  const huerfano = sesion("Asesor de Servicio", null);
  assert.equal(canAccessSucursal(huerfano, MATRIZ), false);
  assert.equal(canAccessSucursal(huerfano, null), false);
});

test("filterAccessibleBySucursal deja la lista intacta para el Admin", () => {
  const filas = [
    { id: "a", sucursal_id: MATRIZ },
    { id: "b", sucursal_id: OTRA_SUCURSAL },
    { id: "c", sucursal_id: null },
  ];
  assert.deepEqual(filterAccessibleBySucursal(sesion("Admin"), filas), filas);
});

test("filterAccessibleBySucursal recorta lo ajeno y lo huérfano", () => {
  const filas = [
    { id: "a", sucursal_id: MATRIZ },
    { id: "b", sucursal_id: OTRA_SUCURSAL },
    { id: "c", sucursal_id: null },
    { id: "d" },
  ];
  const visibles = filterAccessibleBySucursal(sesion("Jefe de Taller", MATRIZ), filas);
  assert.deepEqual(
    visibles.map((f) => f.id),
    ["a"],
    "solo la fila de su propia sucursal"
  );
});

test("filterAccessibleBySucursal con lista vacía devuelve lista vacía", () => {
  assert.deepEqual(filterAccessibleBySucursal(sesion("Asesor de Servicio"), []), []);
});
