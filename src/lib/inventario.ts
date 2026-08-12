/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * El único lugar donde se escribe en el ledger de inventario.
 *
 * Es el gemelo de `saldo.ts` y lo es a propósito: si el programa de puntos es
 * un PASIVO de la empresa, el inventario de marketing es un ACTIVO, y las dos
 * cosas necesitan exactamente las mismas garantías. Concentrar aquí el
 * movimiento de stock permite auditar la corrección leyendo un archivo en vez
 * de recorrer las Server Actions que lo llaman.
 *
 * Vive en un módulo normal con `import "server-only"` y NO en un archivo
 * "use server" por dos motivos, ambos escritos en AGENTS.md:
 *  1. Toda exportación de un "use server" es un endpoint público.
 *  2. Las pruebas de concurrencia tienen que llamar a ESTA función, la misma
 *     que llama producción. Una Server Action necesita cookies y no se puede
 *     invocar desde un script.
 */

import "server-only";

import { db } from "@/db";
import { articulos, errorLog, movimientosInventario } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { MotivoInventario } from "@/db/schema";

/**
 * Cualquier cosa con la API de `db`: el cliente normal, o el `tx` que entrega
 * `db.transaction()`. Permite que este movimiento se ejecute SOLO o ANIDADO
 * dentro de la transacción de otra operación (p. ej. aprobar un canje, donde
 * el cambio de estado y el descuento de stock tienen que ser todo o nada).
 */
type Ejecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MovimientoInventarioEntrada = {
  articuloId: string;
  motivo: MotivoInventario;
  /** CON SIGNO. Positivo entra, negativo sale. */
  cantidad: number;

  /** Origen de la salida. Excluyentes en la práctica, todos opcionales. */
  canjeId?: string | null;
  vehiculoId?: string | null;
  /** Nombre de la feria o activación. Enlaza la salida con su devolución. */
  evento?: string | null;

  /** Obligatorio en `ajuste_conteo` y `salida_merma`. */
  motivoTexto?: string | null;
  documentoReferencia?: string | null;
  costoUnitario?: string | null;

  creadoPorId?: string | null;
  creadoPorNombre?: string | null;
  creadoPorRol?: string | null;
  sucursalId?: string | null;
};

export type ResultadoInventario =
  | { ok: true; movimientoId: string; stockPosterior: number }
  | {
      ok: false;
      motivo: "stock_insuficiente" | "articulo_inexistente" | "duplicado" | "invalido";
      stockActual?: number;
      detalle?: string;
    };

/** SQLSTATE de Postgres para violación de restricción única. */
const UNIQUE_VIOLATION = "23505";
/** SQLSTATE para violación de CHECK. */
const CHECK_VIOLATION = "23514";

/**
 * Busca un SQLSTATE recorriendo la cadena de `cause`.
 *
 * NO se compara el texto del mensaje: Drizzle envuelve el error de `pg` en un
 * `DrizzleQueryError` cuyo mensaje solo dice "Failed query: insert into…".
 * Este proyecto ya tuvo ese bug exacto en `saldo.ts` — ver AGENTS.md.
 */
function tieneCodigoSql(error: unknown, codigo: string): boolean {
  let actual: unknown = error;
  for (let profundidad = 0; actual && profundidad < 5; profundidad++) {
    if ((actual as { code?: string }).code === codigo) return true;
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * El signo tiene que coincidir con el prefijo del motivo.
 *
 * La base lo garantiza con un CHECK, pero comprobarlo aquí convierte un error
 * 23514 sin contexto en un mensaje que el asesor puede entender. La defensa de
 * la base se queda igual: esta es la capa amable, no la capa de seguridad.
 */
export function signoValido(motivo: MotivoInventario, cantidad: number): boolean {
  if (cantidad === 0) return false;
  if (motivo === "ajuste_conteo") return true;
  if (motivo.startsWith("ingreso_")) return cantidad > 0;
  if (motivo.startsWith("salida_")) return cantidad < 0;
  return false;
}

/** `ajuste_conteo` y `salida_merma` exigen explicación. */
export function exigeMotivoTexto(motivo: MotivoInventario): boolean {
  return motivo === "ajuste_conteo" || motivo === "salida_merma";
}

function validarEntradaInventario(mov: MovimientoInventarioEntrada): ResultadoInventario | null {
  if (!Number.isInteger(mov.cantidad)) {
    return { ok: false, motivo: "invalido", detalle: "La cantidad debe ser un número entero." };
  }
  if (!signoValido(mov.motivo, mov.cantidad)) {
    return {
      ok: false,
      motivo: "invalido",
      detalle: `El motivo "${mov.motivo}" no admite una cantidad de ${mov.cantidad}.`,
    };
  }
  if (exigeMotivoTexto(mov.motivo) && (mov.motivoTexto ?? "").trim().length < 5) {
    return {
      ok: false,
      motivo: "invalido",
      detalle: "Un ajuste o una merma necesitan una explicación de al menos 5 caracteres.",
    };
  }
  return null;
}

/**
 * El núcleo del movimiento, SIN abrir transacción propia. Existe para que
 * `aprobarCanjeAtomico` (en `canje-operaciones.ts`) pueda descontar el
 * artículo DENTRO de la misma transacción que cambia el estado del canje: las
 * dos escrituras tienen que ser todo o nada, y Postgres no da esa garantía
 * anidando un `db.transaction()` dentro de otro sin SAVEPOINT explícito.
 *
 * ── Por qué un UPDATE condicional y no SELECT + comprobar + INSERT ──
 * Mismo razonamiento que en `saldo.ts`, y ahora importa más: hay varios canales
 * descontando del mismo artículo a la vez (un canje aprobándose mientras un
 * asesor registra una entrega de vehículo). El enfoque ingenuo NO es seguro en
 * READ COMMITTED — las dos transacciones leen el mismo snapshot y las dos
 * pasan la comprobación. Un CTE de una sola sentencia tampoco lo arregla.
 *
 * Este UPDATE sí es seguro por EvalPlanQual: al desbloquearse tras el commit de
 * la otra transacción, Postgres REEVALÚA el WHERE contra la versión nueva de la
 * fila. La segunda ve el stock ya descontado y devuelve 0 filas.
 *
 * `stock_posterior` sale del RETURNING, así que es correcto bajo concurrencia:
 * no se calcula en JavaScript.
 */
export async function aplicarMovimientoInventarioEnTx(
  tx: Ejecutor,
  mov: MovimientoInventarioEntrada
): Promise<ResultadoInventario> {
  const invalido = validarEntradaInventario(mov);
  if (invalido) return invalido;

  // Para una salida (cantidad < 0) la condición exige existencias. Para un
  // ingreso no hay nada que comprobar, pero se usa el mismo UPDATE para
  // obtener el stock resultante del RETURNING.
  const salida = mov.cantidad < 0;

  const filas = await tx
    .update(articulos)
    .set({
      stock_cache: sql`${articulos.stock_cache} + ${mov.cantidad}`,
      stock_cache_actualizado: new Date(),
    })
    .where(
      salida
        ? sql`${articulos.id} = ${mov.articuloId} AND ${articulos.stock_cache} >= ${-mov.cantidad}`
        : eq(articulos.id, mov.articuloId)
    )
    .returning({ stock: articulos.stock_cache });

  const fila = filas[0];
  if (!fila) {
    // 0 filas puede ser "no existe" o "stock insuficiente". Se distingue con
    // una lectura, solo en el camino de error.
    const [existe] = await tx
      .select({ stock: articulos.stock_cache })
      .from(articulos)
      .where(eq(articulos.id, mov.articuloId))
      .limit(1);

    if (!existe) return { ok: false as const, motivo: "articulo_inexistente" as const };
    return {
      ok: false as const,
      motivo: "stock_insuficiente" as const,
      stockActual: existe.stock,
    };
  }

  const [movimiento] = await tx
    .insert(movimientosInventario)
    .values({
      articulo_id: mov.articuloId,
      motivo: mov.motivo,
      cantidad: mov.cantidad,
      stock_posterior: fila.stock,
      canje_id: mov.canjeId ?? null,
      vehiculo_id: mov.vehiculoId ?? null,
      evento: mov.evento?.trim() || null,
      motivo_texto: mov.motivoTexto?.trim() || null,
      documento_referencia: mov.documentoReferencia?.trim() || null,
      costo_unitario: mov.costoUnitario ?? null,
      creado_por_id: mov.creadoPorId ?? null,
      creado_por_nombre: mov.creadoPorNombre ?? null,
      creado_por_rol: mov.creadoPorRol ?? null,
      sucursal_id: mov.sucursalId ?? null,
    })
    .returning({ id: movimientosInventario.id });

  if (!movimiento) throw new Error("No se pudo escribir en el ledger de inventario.");

  // Un ingreso actualiza el costo unitario vigente del artículo. El costo
  // histórico de cada compra queda en su fila del ledger, así que valorar
  // el inventario de hace seis meses sigue siendo posible.
  if (mov.cantidad > 0 && mov.costoUnitario) {
    await tx
      .update(articulos)
      .set({ costo_unitario: mov.costoUnitario, fecha_actualizacion: new Date() })
      .where(eq(articulos.id, mov.articuloId));
  }

  return { ok: true as const, movimientoId: movimiento.id, stockPosterior: fila.stock };
}

/**
 * Aplica un movimiento de inventario en su PROPIA transacción. Lo que usa
 * cualquier llamador que no necesita compartir atomicidad con otra escritura:
 * ingreso de mercadería, salida por feria, ajuste de conteo.
 */
export async function aplicarMovimientoInventario(
  mov: MovimientoInventarioEntrada
): Promise<ResultadoInventario> {
  const invalido = validarEntradaInventario(mov);
  if (invalido) return invalido;

  try {
    return await db.transaction((tx) => aplicarMovimientoInventarioEnTx(tx, mov));
  } catch (error) {
    // El UNIQUE parcial sobre canje_id rechaza el segundo descuento del mismo
    // canje. Llegar aquí no es un fallo: es el constraint haciendo su trabajo,
    // y la transacción entera (incluido el descuento del stock) quedó revertida.
    if (tieneCodigoSql(error, UNIQUE_VIOLATION)) {
      return { ok: false, motivo: "duplicado" };
    }
    // Los CHECK de signo y de motivo_texto ya se comprobaron arriba. Si aun así
    // salta uno, es que alguien encontró un camino que las validaciones de esta
    // función no cubren — vale la pena devolverlo como inválido en vez de como
    // excepción sin controlar, pero NO se silencia: queda en el log.
    if (tieneCodigoSql(error, CHECK_VIOLATION)) {
      console.error("[INVENTARIO] CHECK violado pese a la validación previa:", error);
      return { ok: false, motivo: "invalido", detalle: "El movimiento no cumple las reglas del inventario." };
    }
    throw error;
  }
}

/**
 * Recalcula el stock real sumando el ledger y corrige el caché si difiere.
 *
 * Gemelo de `recalcularSaldo`. Se ejecuta desde el botón del admin y en el
 * barrido de mantenimiento.
 */
export async function recalcularStock(
  articuloId: string
): Promise<{ stockReal: number; stockCache: number; corregido: boolean; anomalia?: string }> {
  const [suma] = await db
    .select({ total: sql<number>`coalesce(sum(${movimientosInventario.cantidad}), 0)::int` })
    .from(movimientosInventario)
    .where(eq(movimientosInventario.articulo_id, articuloId));

  const stockReal = suma?.total ?? 0;

  const [articulo] = await db
    .select({ stock: articulos.stock_cache })
    .from(articulos)
    .where(eq(articulos.id, articuloId))
    .limit(1);

  const stockCache = articulo?.stock ?? 0;

  if (stockReal === stockCache) {
    return { stockReal, stockCache, corregido: false };
  }

  /*
   * Un ledger que suma negativo significa salidas sin su ingreso: datos
   * corruptos, no una simple deriva del caché. Escribirlo haría saltar el CHECK
   * `stock_cache >= 0` y esta función reventaría justo en el barrido de
   * mantenimiento, que es cuando menos se mira. Mismo criterio que en
   * `recalcularSaldo`: se reporta y se deja el caché como está.
   */
  if (stockReal < 0) {
    const anomalia = `El ledger del artículo suma ${stockReal}, que es imposible. Revisión manual necesaria.`;
    console.error(`[INVENTARIO] ${anomalia} articulo=${articuloId}`);

    try {
      await db.insert(errorLog).values({
        contexto: "recalcularStock",
        mensaje: anomalia,
        detalle: { articuloId, stockReal, stockCache },
      });
    } catch {
      // El registro del error nunca debe tumbar el barrido.
    }

    return { stockReal, stockCache, corregido: false, anomalia };
  }

  await db
    .update(articulos)
    .set({ stock_cache: stockReal, stock_cache_actualizado: new Date() })
    .where(eq(articulos.id, articuloId));

  return { stockReal, stockCache, corregido: true };
}
