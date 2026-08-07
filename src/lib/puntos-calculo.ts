/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Cuántos puntos vale un servicio. Función pura a propósito: es la regla de
 * negocio que más se va a tocar y la que más caro sale equivocar, así que tiene
 * que poder probarse sin base de datos.
 */

export type ReglaCalculo = {
  /** La "$Y" de "X puntos por cada $Y". */
  montoBase: number;
  /** La "X". */
  puntosPorBase: number;
  redondeo: "abajo" | "cercano";
  /** Por debajo de esto no se acredita nada. */
  montoMinimo: number;
  /** Tope antifraude por transacción. null = sin tope. */
  puntosMaximosTransaccion: number | null;
};

export type ResultadoCalculo = {
  puntos: number;
  /** Puntos antes de aplicar el tope. Si difiere, hubo recorte. */
  puntosSinTope: number;
  topeAplicado: boolean;
  motivoCero?: "monto_minimo" | "monto_invalido";
};

/**
 * `multiplicador` viene del tipo de servicio (Colisión 1.5, Repuestos 0.5…).
 * Se pasa por separado, y no dentro de la regla, porque la regla es una sola y
 * los multiplicadores son muchos: mezclarlos obligaría a versionar una regla
 * por cada servicio.
 */
export function calcularPuntos(
  monto: number,
  regla: ReglaCalculo,
  multiplicador: number = 1
): ResultadoCalculo {
  if (!Number.isFinite(monto) || monto <= 0) {
    return { puntos: 0, puntosSinTope: 0, topeAplicado: false, motivoCero: "monto_invalido" };
  }

  if (monto < regla.montoMinimo) {
    return { puntos: 0, puntosSinTope: 0, topeAplicado: false, motivoCero: "monto_minimo" };
  }

  if (regla.montoBase <= 0 || regla.puntosPorBase <= 0) {
    return { puntos: 0, puntosSinTope: 0, topeAplicado: false, motivoCero: "monto_invalido" };
  }

  const bruto = (monto / regla.montoBase) * regla.puntosPorBase * multiplicador;

  // El redondeo se aplica UNA vez, al final. Redondear el cociente antes de
  // multiplicar produce resultados distintos y peores: $99 con regla de $10
  // daría 9 puntos y con multiplicador 1.5 daría 13, en vez de 14.
  const puntosSinTope =
    regla.redondeo === "cercano" ? Math.round(bruto) : Math.floor(bruto);

  if (puntosSinTope <= 0) {
    return { puntos: 0, puntosSinTope: 0, topeAplicado: false };
  }

  const tope = regla.puntosMaximosTransaccion;
  if (tope !== null && puntosSinTope > tope) {
    // Un asesor que teclee $50.000 en vez de $500 choca contra esto.
    return { puntos: tope, puntosSinTope, topeAplicado: true };
  }

  return { puntos: puntosSinTope, puntosSinTope, topeAplicado: false };
}

/** Convierte las columnas `numeric` de Postgres (que Drizzle entrega como texto). */
export function reglaDesdeFila(fila: {
  monto_base: string;
  puntos_por_base: number;
  redondeo: string;
  monto_minimo: string;
  puntos_maximos_transaccion: number | null;
}): ReglaCalculo {
  return {
    montoBase: Number(fila.monto_base),
    puntosPorBase: fila.puntos_por_base,
    redondeo: fila.redondeo === "cercano" ? "cercano" : "abajo",
    montoMinimo: Number(fila.monto_minimo),
    puntosMaximosTransaccion: fila.puntos_maximos_transaccion,
  };
}

/** Explicación en una línea para mostrarle al asesor antes de confirmar. */
export function explicarCalculo(
  monto: number,
  regla: ReglaCalculo,
  multiplicador: number,
  resultado: ResultadoCalculo
): string {
  if (resultado.motivoCero === "monto_minimo") {
    return `El monto mínimo para acumular es $${regla.montoMinimo.toFixed(2)}.`;
  }
  if (resultado.motivoCero === "monto_invalido") {
    return "El monto no es válido.";
  }

  const base = `${regla.puntosPorBase} punto${regla.puntosPorBase === 1 ? "" : "s"} por cada $${regla.montoBase.toFixed(2)}`;
  const conMultiplicador = multiplicador === 1 ? base : `${base}, por ${multiplicador} del servicio`;

  if (resultado.topeAplicado) {
    return `${conMultiplicador}. Serían ${resultado.puntosSinTope}, recortados al tope de ${resultado.puntos}.`;
  }
  return `${conMultiplicador}.`;
}
