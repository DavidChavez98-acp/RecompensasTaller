/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Caché local del secreto que genera el QR.
 *
 * Se prueba con un `window.localStorage` mínimo instalado en el global: NO es
 * un mock del módulo bajo prueba —las funciones que se ejecutan son las reales—
 * sino el API del navegador que no existe en Node.
 *
 * Lo que de verdad importa aquí es el guardián del teléfono compartido: padre e
 * hijo con vehículos distintos usan el mismo teléfono, y el código de uno NO
 * puede generarse desde la sesión del otro.
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  borrarDispositivoLocal,
  guardarDispositivoLocal,
  leerDispositivoLocal,
  type DispositivoLocal,
} from "./qr-device.client";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const OTRO_CLIENTE = "22222222-2222-2222-2222-222222222222";

const DISPOSITIVO: DispositivoLocal = {
  clienteId: CLIENTE,
  dispositivoId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  secreto: "c2VjcmV0by1kZS1wcnVlYmE",
  algoritmo: "hmac-sha256",
};

// `globalThis.window` está declarado como obligatorio en lib.dom, así que se
// manipula a través de un índice suelto: en Node no existe y hay que poder
// ponerlo y quitarlo.
const GLOBAL = globalThis as unknown as Record<string, unknown>;

/** localStorage mínimo, con la opción de fallar como Safari en privado. */
function crearAlmacen(fallaAlEscribir = false) {
  const datos = new Map<string, string>();
  return {
    datos,
    localStorage: {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (fallaAlEscribir) throw new Error("QuotaExceededError");
        datos.set(k, v);
      },
      removeItem: (k: string) => {
        if (fallaAlEscribir) throw new Error("SecurityError");
        datos.delete(k);
      },
    },
  };
}

function conWindow<T>(almacen: ReturnType<typeof crearAlmacen>, cuerpo: () => T): T {
  const previo = GLOBAL.window;
  GLOBAL.window = { localStorage: almacen.localStorage };
  try {
    return cuerpo();
  } finally {
    if (previo === undefined) delete GLOBAL.window;
    else GLOBAL.window = previo;
  }
}

/** La clave real que usa el módulo. Si cambia, los dispositivos ya guardados se pierden. */
const CLAVE = "gp_qr_dispositivo";

// ─────────────────────────────────────────────────────────────────────────────
// Servidor: no hay localStorage y no puede reventar
// ─────────────────────────────────────────────────────────────────────────────

test("en el servidor (sin window) leer devuelve null y escribir no revienta", () => {
  // Estas funciones se importan desde componentes que también renderizan en el
  // servidor; un `window.localStorage` a pelo tumbaría el render.
  assert.equal(leerDispositivoLocal(CLIENTE), null);
  assert.doesNotThrow(() => guardarDispositivoLocal(DISPOSITIVO));
  assert.doesNotThrow(() => borrarDispositivoLocal());
});

// ─────────────────────────────────────────────────────────────────────────────
// Ida y vuelta
// ─────────────────────────────────────────────────────────────────────────────

test("guardar y leer devuelve el mismo dispositivo", () => {
  const almacen = crearAlmacen();
  conWindow(almacen, () => {
    guardarDispositivoLocal(DISPOSITIVO);
    assert.deepEqual(leerDispositivoLocal(CLIENTE), DISPOSITIVO);
  });
});

test("se guarda bajo la clave esperada (cambiarla pierde los dispositivos vivos)", () => {
  const almacen = crearAlmacen();
  conWindow(almacen, () => {
    guardarDispositivoLocal(DISPOSITIVO);
    assert.ok(almacen.datos.has(CLAVE), `esperaba la clave "${CLAVE}"`);
  });
});

test("borrar deja el almacén sin dispositivo", () => {
  const almacen = crearAlmacen();
  conWindow(almacen, () => {
    guardarDispositivoLocal(DISPOSITIVO);
    borrarDispositivoLocal();
    assert.equal(leerDispositivoLocal(CLIENTE), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Teléfono compartido: el guardián que importa
// ─────────────────────────────────────────────────────────────────────────────

test("NO devuelve el dispositivo si pertenece a otro cliente", () => {
  // Padre e hijo con el mismo teléfono: si esto fallara, el hijo generaría el
  // código QR del padre y el asesor acreditaría al cliente equivocado.
  const almacen = crearAlmacen();
  conWindow(almacen, () => {
    guardarDispositivoLocal(DISPOSITIVO);
    assert.equal(leerDispositivoLocal(OTRO_CLIENTE), null);
    assert.equal(leerDispositivoLocal(""), null);
  });
});

test("el clienteId devuelto es SIEMPRE el de la sesión que preguntó", () => {
  // El módulo reconstruye el objeto con el `clienteId` recibido, no con el
  // guardado: aunque el JSON viniera manipulado, no puede imponer otro cliente.
  const almacen = crearAlmacen();
  conWindow(almacen, () => {
    guardarDispositivoLocal(DISPOSITIVO);
    assert.equal(leerDispositivoLocal(CLIENTE)?.clienteId, CLIENTE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Es un caché, no una fuente de verdad: perderlo o corromperlo se tolera
// ─────────────────────────────────────────────────────────────────────────────

test("un JSON corrupto se trata como 'no hay dispositivo'", () => {
  const almacen = crearAlmacen();
  conWindow(almacen, () => {
    almacen.datos.set(CLAVE, "{esto no es json");
    assert.equal(leerDispositivoLocal(CLIENTE), null);
  });
});

test("un dispositivo a medias se descarta en vez de generar un QR inválido", () => {
  // Un secreto ausente produciría un HMAC sobre `undefined` y un código que el
  // servidor rechaza sin explicación útil.
  const almacen = crearAlmacen();
  const incompletos = [
    { clienteId: CLIENTE, dispositivoId: DISPOSITIVO.dispositivoId },
    { clienteId: CLIENTE, secreto: DISPOSITIVO.secreto },
    { clienteId: CLIENTE, dispositivoId: 12345, secreto: DISPOSITIVO.secreto },
    { clienteId: CLIENTE, dispositivoId: DISPOSITIVO.dispositivoId, secreto: null },
    {},
    "null",
  ];

  conWindow(almacen, () => {
    for (const parcial of incompletos) {
      almacen.datos.set(CLAVE, typeof parcial === "string" ? parcial : JSON.stringify(parcial));
      assert.equal(
        leerDispositivoLocal(CLIENTE),
        null,
        `debería descartar ${JSON.stringify(parcial)}`
      );
    }
  });
});

test("sin nada guardado devuelve null", () => {
  const almacen = crearAlmacen();
  conWindow(almacen, () => {
    assert.equal(leerDispositivoLocal(CLIENTE), null);
  });
});

test("un dispositivo viejo sin `algoritmo` asume hmac-sha256", () => {
  const almacen = crearAlmacen();
  conWindow(almacen, () => {
    almacen.datos.set(
      CLAVE,
      JSON.stringify({
        clienteId: CLIENTE,
        dispositivoId: DISPOSITIVO.dispositivoId,
        secreto: DISPOSITIVO.secreto,
      })
    );
    assert.equal(leerDispositivoLocal(CLIENTE)?.algoritmo, "hmac-sha256");
  });
});

test("si localStorage está bloqueado (Safari privado) no se rompe la vista", () => {
  // Sin almacenamiento el código sigue funcionando en esta sesión; se
  // reaprovisiona en la siguiente visita. No es motivo para tumbar la pantalla
  // del QR justo cuando el cliente está en el mostrador.
  const almacen = crearAlmacen(true);
  conWindow(almacen, () => {
    assert.doesNotThrow(() => guardarDispositivoLocal(DISPOSITIVO));
    assert.doesNotThrow(() => borrarDispositivoLocal());
    assert.equal(leerDispositivoLocal(CLIENTE), null);
  });
});
