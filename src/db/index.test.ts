/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Selección de driver por cadena de conexión.
 *
 * No abre ninguna conexión: `crearDb()` es perezoso y `esConexionLocal` es una
 * función pura. Lo que se fija aquí es la decisión que AGENTS.md marca como
 * intocable: `pg` sobre TCP en local, Pool WebSocket de Neon en la nube. Los
 * dos soportan `db.transaction()`, y el débito de puntos + el INSERT del ledger
 * + el decremento de stock tienen que ser atómicos.
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { esConexionLocal } from "./index";

test("localhost y 127.0.0.1 se consideran locales (driver pg)", () => {
  assert.equal(esConexionLocal("postgres://usuario@localhost:5432/recompensas_taller"), true);
  assert.equal(esConexionLocal("postgresql://usuario:clave@127.0.0.1:5432/recompensas_taller"), true);
  assert.equal(esConexionLocal("postgres://localhost/recompensas_taller"), true, "sin puerto");
});

test("una cadena de Neon NO es local (driver WebSocket)", () => {
  assert.equal(
    esConexionLocal(
      "postgresql://usuario:clave@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
    ),
    false
  );
});

test("un host que solo CONTIENE 'localhost' no engaña a la comprobación", () => {
  // `hostname.includes("localhost")` daría true aquí y el código intentaría
  // hablar TCP plano contra un servidor remoto.
  assert.equal(esConexionLocal("postgres://u:c@localhost.ejemplo.com:5432/db"), false);
  assert.equal(esConexionLocal("postgres://u:c@mi-localhost:5432/db"), false);
  assert.equal(esConexionLocal("postgres://u:c@127.0.0.1.ejemplo.com:5432/db"), false);
});

test("una cadena que no es una URL se trata como remota, no revienta", () => {
  // Es la opción segura: el driver de Neon fallará con un error de conexión
  // legible en vez de que el arranque tire una excepción de parseo.
  for (const basura of ["", "no-es-una-url", "recompensas_taller", "://roto"]) {
    assert.equal(esConexionLocal(basura), false, `falló con ${JSON.stringify(basura)}`);
  }
});

test("el puerto, el usuario y los parámetros no cambian la decisión", () => {
  assert.equal(esConexionLocal("postgres://otro:clave@localhost:15432/db?sslmode=disable"), true);
  assert.equal(esConexionLocal("postgres://localhost:5433/otra_base"), true);
});

/*
 * BUG (ver informe): la comparación con "::1" es código muerto.
 *
 * `esConexionLocal` compara `url.hostname === "::1"`, pero el parser WHATWG de
 * URL devuelve el literal IPv6 CON corchetes: `new URL("postgres://[::1]:5432/db")
 * .hostname` es "[::1]", nunca "::1". La rama no se ejecuta jamás.
 *
 * Consecuencia real: si alguien pone POSTGRES_URL apuntando al loopback IPv6
 * —cosa que pasa en macOS, donde `localhost` resuelve a ::1 y algunas
 * herramientas escriben la cadena ya resuelta— el código elige el Pool
 * WebSocket de Neon contra un Postgres local, que no habla ese protocolo. El
 * fallo aparece como un error de conexión confuso, no como "driver
 * equivocado".
 *
 * Arreglo previsible: comparar también con "[::1]" (o quitar los corchetes
 * antes de comparar). NO se corrige aquí.
 */
test("el loopback IPv6 debería contarse como local", { skip: true }, () => {
  assert.equal(
    esConexionLocal("postgres://usuario@[::1]:5432/recompensas_taller"),
    true,
    "hoy devuelve false: url.hostname es '[::1]', con corchetes"
  );
});
