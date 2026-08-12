/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * La primitiva del dato numérico.
 *
 * Antes de esto, la única forma de presentar una cifra vivía dentro de
 * `/interno/reportes` como un componente local, y el resto de la app ponía los
 * números en `text-sm font-medium` — el mismo tratamiento que el texto que los
 * rodea. El precio de un premio, que es el dato que decide la acción del
 * cliente, se leía igual que su descripción.
 *
 * Dos reglas del sistema, ambas visibles aquí:
 *  1. La UNIDAD siempre va un escalón por debajo de la cifra y en color
 *     apagado. "1.250" grande + "pts" pequeño. Poner los dos al mismo tamaño
 *     es lo que hace que un número parezca texto.
 *  2. El subrayado rojo de 2px marca la cifra protagonista de la pantalla, y
 *     solo una por pantalla. Es la única aparición del rojo fuera de marca y
 *     acción primaria, y encaja porque la cifra protagonista ES la marca
 *     hablando.
 */

import { cn } from "@/lib/utils";

export function Dato({
  etiqueta,
  valor,
  unidad,
  nota,
  tamano = "normal",
  protagonista = false,
  className,
}: {
  etiqueta?: string;
  valor: string | number;
  unidad?: string;
  nota?: string;
  tamano?: "normal" | "xl" | "hero";
  /** Subrayado rojo de 2px. Máximo uno por pantalla. */
  protagonista?: boolean;
  className?: string;
}) {
  const claseCifra =
    tamano === "hero" ? "t-dato-hero" : tamano === "xl" ? "t-dato-xl" : "t-dato";

  return (
    <div className={className}>
      {etiqueta && <p className="t-etiqueta text-muted-foreground">{etiqueta}</p>}

      <p className={cn(claseCifra, "mt-1 flex items-baseline gap-1.5")}>
        <span>{valor}</span>
        {unidad && (
          <span className="text-sm font-medium tracking-normal text-muted-foreground">
            {unidad}
          </span>
        )}
      </p>

      {protagonista && <div className="mt-2 h-0.5 w-8 bg-primary" aria-hidden="true" />}
      {nota && <p className="t-micro text-muted-foreground mt-1.5">{nota}</p>}
    </div>
  );
}
