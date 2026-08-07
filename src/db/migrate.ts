/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * DIVERGENCIA DELIBERADA frente a "solicitud credito": aquel proyecto corre
 * `drizzle-kit push` dentro del script de build, lo que significa que un
 * despliegue de preview apuntando por error a la base de producción puede
 * aplicar cambios de esquema sin revisión.
 *
 * Aquí no. El ledger es evidencia contable y un `push` accidental que suelte
 * una columna es irreversible, así que las migraciones son archivos generados
 * y se aplican EXPLÍCITAMENTE con `pnpm db:migrate`. El build solo compila.
 *
 * Uso:  pnpm db:migrate
 */

import { config } from "dotenv";
import { db, cerrarPool, esConexionLocal } from "./index";

// Next.js carga `.env.local` solo; los scripts sueltos no, hay que decírselo.
// El orden importa: la primera coincidencia gana, `.env` queda de respaldo.
config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error("POSTGRES_URL no está configurado. Aborto.");
    process.exit(1);
  }

  const local = esConexionLocal(connectionString);
  console.log(`Base: ${local ? "Postgres local" : "Neon (nube)"}`);

  // El migrador tiene que ser el del mismo driver que abrió la conexión.
  const { migrate } = local
    ? await import("drizzle-orm/node-postgres/migrator")
    : ((await import("drizzle-orm/neon-serverless/migrator")) as unknown as typeof import("drizzle-orm/node-postgres/migrator"));

  console.log("Aplicando migraciones...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migraciones aplicadas.");

  await cerrarPool();
}

main().catch(async (error) => {
  console.error("Fallo al migrar:", error);
  await cerrarPool().catch(() => {});
  process.exit(1);
});
