/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Limitador en memoria. IMPORTANTE para leer estas pruebas: en serverless cada
 * instancia tiene su propio Map, así que este limitador amortigua ráfagas desde
 * una misma instancia pero NO es el límite que manda para el OTP — ese se
 * cuenta en SQL sobre `otp_codigos` (ver OTP_MAX_SOLICITUDES en constants.ts).
 *
 * El almacén es global al módulo, así que cada prueba usa su propia clave.
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as dormir } from "node:timers/promises";
import { checkRateLimit, type RateLimitConfig } from "./rate-limit";

const VENTANA_LARGA: RateLimitConfig = { limit: 3, windowMs: 60_000 };

let contadorClaves = 0;
/** Clave nueva en cada llamada: el almacén vive en el módulo y no se reinicia. */
function clave(nombre: string): string {
  contadorClaves++;
  return `prueba:${nombre}:${contadorClaves}`;
}

test("deja pasar exactamente `limit` peticiones y bloquea la siguiente", () => {
  const k = clave("limite");

  for (let i = 1; i <= VENTANA_LARGA.limit; i++) {
    const resultado = checkRateLimit(k, VENTANA_LARGA);
    assert.equal(resultado.limited, false, `la petición ${i} no debería bloquearse`);
  }

  const cuarta = checkRateLimit(k, VENTANA_LARGA);
  assert.equal(cuarta.limited, true, "la cuarta sí");
  assert.equal(cuarta.remaining, 0);
});

test("`remaining` va bajando hasta cero", () => {
  const k = clave("restantes");
  assert.equal(checkRateLimit(k, VENTANA_LARGA).remaining, 2);
  assert.equal(checkRateLimit(k, VENTANA_LARGA).remaining, 1);
  assert.equal(checkRateLimit(k, VENTANA_LARGA).remaining, 0, "la última permitida deja 0");
  assert.equal(checkRateLimit(k, VENTANA_LARGA).remaining, 0, "y la bloqueada sigue en 0");
});

test("una vez bloqueado, `resetSeconds` dice cuánto falta", () => {
  const k = clave("reset");
  for (let i = 0; i < VENTANA_LARGA.limit; i++) checkRateLimit(k, VENTANA_LARGA);

  const bloqueado = checkRateLimit(k, VENTANA_LARGA);
  assert.equal(bloqueado.limited, true);
  assert.ok(bloqueado.resetSeconds > 0, "sin esto la UI no puede decir 'inténtalo en N segundos'");
  assert.ok(
    bloqueado.resetSeconds <= VENTANA_LARGA.windowMs / 1000,
    `no puede pedir esperar más que la ventana entera (${bloqueado.resetSeconds}s)`
  );
});

test("seguir insistiendo mientras está bloqueado NO alarga el castigo", () => {
  // Si la petición rechazada se apuntara en la ventana, un cliente impaciente
  // se auto-bloquearía indefinidamente pulsando "reenviar código".
  const k = clave("insistir");
  const config: RateLimitConfig = { limit: 2, windowMs: 400 };

  checkRateLimit(k, config);
  checkRateLimit(k, config);

  const primerRechazo = checkRateLimit(k, config).resetSeconds;
  for (let i = 0; i < 20; i++) checkRateLimit(k, config);
  const ultimoRechazo = checkRateLimit(k, config).resetSeconds;

  assert.ok(
    ultimoRechazo <= primerRechazo,
    `insistir alargó la espera: ${primerRechazo}s → ${ultimoRechazo}s`
  );
});

test("la ventana se desliza: pasado el tiempo vuelve a dejar pasar", async () => {
  const k = clave("ventana");
  const config: RateLimitConfig = { limit: 2, windowMs: 150 };

  assert.equal(checkRateLimit(k, config).limited, false);
  assert.equal(checkRateLimit(k, config).limited, false);
  assert.equal(checkRateLimit(k, config).limited, true, "consumida la cuota");

  await dormir(220);

  assert.equal(
    checkRateLimit(k, config).limited,
    false,
    "vencida la ventana, las marcas viejas se descartan"
  );
});

test("cada clave lleva su propia cuenta (una IP no bloquea a otra)", () => {
  const config: RateLimitConfig = { limit: 1, windowMs: 60_000 };
  const unaIp = clave("ip-a");
  const otraIp = clave("ip-b");

  assert.equal(checkRateLimit(unaIp, config).limited, false);
  assert.equal(checkRateLimit(unaIp, config).limited, true);
  assert.equal(
    checkRateLimit(otraIp, config).limited,
    false,
    "el bloqueo de una IP no puede alcanzar a otra"
  );
});

test("la misma IP en rutas distintas no comparte cuota", () => {
  // La clave que arma quien llama es "ip:ruta": pedir un OTP no debe gastar la
  // cuota de iniciar sesión.
  const config: RateLimitConfig = { limit: 1, windowMs: 60_000 };
  const base = clave("mismo-cliente");

  assert.equal(checkRateLimit(`${base}:/acceso`, config).limited, false);
  assert.equal(checkRateLimit(`${base}:/acceso/codigo`, config).limited, false);
});

test("DISABLE_RATE_LIMIT desactiva el limitador (solo para pruebas locales)", () => {
  const previo = process.env.DISABLE_RATE_LIMIT;
  const k = clave("desactivado");
  const config: RateLimitConfig = { limit: 1, windowMs: 60_000 };

  try {
    process.env.DISABLE_RATE_LIMIT = "true";
    for (let i = 0; i < 10; i++) {
      const resultado = checkRateLimit(k, config);
      assert.equal(resultado.limited, false, `bloqueó en la petición ${i + 1}`);
      assert.equal(resultado.remaining, config.limit);
      assert.equal(resultado.resetSeconds, 0);
    }
  } finally {
    if (previo === undefined) delete process.env.DISABLE_RATE_LIMIT;
    else process.env.DISABLE_RATE_LIMIT = previo;
  }
});

test("solo el valor exacto 'true' desactiva el limitador", () => {
  // Un `DISABLE_RATE_LIMIT=1` o `=false` en producción no puede abrir la puerta
  // por una comparación laxa.
  const previo = process.env.DISABLE_RATE_LIMIT;

  try {
    for (const valor of ["false", "1", "TRUE", "sí"]) {
      process.env.DISABLE_RATE_LIMIT = valor;
      const k = clave(`valor-${valor}`);
      const config: RateLimitConfig = { limit: 1, windowMs: 60_000 };
      checkRateLimit(k, config);
      assert.equal(
        checkRateLimit(k, config).limited,
        true,
        `DISABLE_RATE_LIMIT="${valor}" no debería desactivar nada`
      );
    }
  } finally {
    if (previo === undefined) delete process.env.DISABLE_RATE_LIMIT;
    else process.env.DISABLE_RATE_LIMIT = previo;
  }
});
