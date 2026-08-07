/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * ── Dos drivers, elegidos por la cadena de conexión ──
 *
 * Local (`localhost` / `127.0.0.1`) → `pg` sobre TCP.
 *   El driver serverless de Neon habla WebSocket contra su propio proxy; contra
 *   un Postgres instalado en la Mac no conecta sin montar ese proxy aparte.
 *
 * Nube (Neon) → Pool sobre WebSocket de `@neondatabase/serverless`.
 *   NO lo cambies a `neon-http`: el transporte HTTP no soporta transacciones
 *   interactivas, y el débito de puntos + el INSERT del ledger + el decremento
 *   de stock tienen que ser atómicos o el saldo se corrompe.
 *
 * Los dos soportan `db.transaction()` y exponen la misma API de Drizzle, así
 * que el resto del código no sabe cuál está debajo.
 *
 * La conexión se abre PEREZOSAMENTE, en la primera consulta real: crearla al
 * importar el módulo reventaría `next build` en cualquier entorno sin
 * POSTGRES_URL, y el build no necesita base de datos.
 */

import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

type DrizzleDb = NodePgDatabase<typeof schema>;

type PoolCerrable = { end: () => Promise<void> };

const globalForDb = globalThis as unknown as {
  pool: PoolCerrable | undefined;
  db: DrizzleDb | undefined;
};

/** ¿La cadena apunta a un Postgres en esta máquina? */
export function esConexionLocal(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function crearDb(): DrizzleDb {
  if (globalForDb.db) return globalForDb.db;

  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_URL no está configurado.");
  }

  let instancia: DrizzleDb;
  let pool: PoolCerrable;

  if (esConexionLocal(connectionString)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    const p = new Pool({ connectionString, max: 4 });
    pool = p;
    instancia = drizzleNode(p, { schema });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle: drizzleNeon } = require("drizzle-orm/neon-serverless") as typeof import("drizzle-orm/neon-serverless");
    // max: 1 — en serverless cada invocación es efímera y un pool grande solo
    // consume las conexiones del free tier de Neon sin dar concurrencia real.
    const p = new Pool({ connectionString, max: 1 });
    pool = p as unknown as PoolCerrable;
    instancia = drizzleNeon(p, { schema }) as unknown as DrizzleDb;
  }

  globalForDb.pool = pool;
  globalForDb.db = instancia;
  return instancia;
}

/**
 * Proxy perezoso: se comporta exactamente como el cliente de Drizzle, pero no
 * abre conexión hasta que alguien lee una propiedad de verdad.
 */
export const db = new Proxy({} as DrizzleDb, {
  get(_destino, propiedad, receptor) {
    const real = crearDb();
    const valor = Reflect.get(real as object, propiedad, receptor);
    return typeof valor === "function" ? valor.bind(real) : valor;
  },
});

/** Cierra el pool. Solo para scripts (seed, migrate); no llamar desde la app. */
export async function cerrarPool(): Promise<void> {
  if (globalForDb.pool) {
    await globalForDb.pool.end();
    globalForDb.pool = undefined;
    globalForDb.db = undefined;
  }
}
