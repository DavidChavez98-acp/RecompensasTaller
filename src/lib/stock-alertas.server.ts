/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Aviso de stock bajo, movido aquí desde `src/actions/premios.ts`.
 *
 * Ese archivo lleva "use server": TODO export es un endpoint público
 * invocable desde el navegador con cualquier argumento. `avisarStockBajo`
 * solo tenía sentido como llamada interna tras un ajuste de inventario o una
 * aprobación de canje — sin comprobación de sesión, cualquiera podía llamarla
 * directo con el id de un premio agotado y hacer que el sistema mandara un
 * correo de "stock bajo" a todo el equipo de Admin cuantas veces quisiera.
 *
 * Mismo bug, tercera vez en este proyecto (ver AGENTS.md:
 * `obtenerSecretoDispositivo`, `createPasswordSetupToken`). La corrección es
 * la misma: lo que no debe ser invocable va en un módulo `server-only`, no en
 * un archivo "use server".
 */

import "server-only";

import { db } from "@/db";
import { articulos, premios, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sendEmail, getBaseUrl } from "@/lib/mail";

/**
 * Avisa por correo al Admin cuando un merchandising baja del umbral.
 *
 * Best-effort: un fallo de correo nunca debe tumbar la operación que ya se
 * ejecutó. Mismo criterio que `logAdminAction`.
 */
export async function avisarStockBajo(premioId: string): Promise<void> {
  try {
    const [fila] = await db
      .select({
        nombre: premios.nombre,
        stock: articulos.stock_cache,
        stockMinimoAlerta: articulos.stock_minimo_alerta,
      })
      .from(premios)
      .innerJoin(articulos, eq(articulos.id, premios.articulo_id))
      .where(eq(premios.id, premioId))
      .limit(1);

    if (!fila || fila.stockMinimoAlerta === null) return;
    if (fila.stock > fila.stockMinimoAlerta) return;

    const destinatarios = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.activo, true), eq(users.notif_stock_bajo, true)));

    const correos = destinatarios.map((d) => d.email).filter((e): e is string => !!e);
    if (correos.length === 0) return;

    const agotado = fila.stock === 0;
    await sendEmail({
      to: correos,
      subject: agotado
        ? `Sin stock: ${fila.nombre}`
        : `Stock bajo: ${fila.nombre} (quedan ${fila.stock})`,
      html: `
        <p>${agotado ? "Se agotó" : "Está por agotarse"} un premio del catálogo:</p>
        <p><strong>${fila.nombre}</strong> — quedan ${fila.stock} unidad(es).</p>
        <p>Los clientes lo seguirán viendo marcado como agotado hasta que repongas.</p>
        <p><a href="${getBaseUrl()}/interno/premios">Ir al catálogo</a></p>
      `,
      text: `${fila.nombre}: quedan ${fila.stock} unidades.`,
    });
  } catch (error) {
    console.error("No se pudo avisar del stock bajo:", (error as Error)?.message);
  }
}
