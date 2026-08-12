/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * El isotipo de Grupo Palacios es un velocímetro: disco, sector rojo, aguja.
 * Esta app mide puntos, así que el instrumento mide de verdad — el avance
 * hacia el siguiente premio se dibuja, no solo se escribe.
 *
 * Anillo de progreso + aguja, animados al montar (barren de 0 a su posición).
 * `prefers-reduced-motion` desactiva la transición, no la posición final.
 *
 * El aro es el instrumento puro — nada de texto encima. La aguja gira sobre
 * el centro exacto del disco, así que cualquier texto compartiendo ese
 * espacio queda tapado en algún ángulo tarde o temprano (en 50% de avance,
 * SIEMPRE). La cifra vive abajo, fuera del disco, con la misma primitiva
 * `Dato` que usa el resto de la app.
 */

"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Dato } from "@/components/ui/dato";

const R = 46;
const CIRCUNFERENCIA = 2 * Math.PI * R;

export function Medidor({
  valor,
  meta,
  tamano = 176,
  etiqueta,
  unidad,
  className,
}: {
  valor: number;
  meta: number;
  tamano?: number;
  etiqueta?: string;
  unidad?: string;
  className?: string;
}) {
  const fraccion = meta > 0 ? Math.min(1, Math.max(0, valor / meta)) : 0;

  // Arranca en 0 y anima hasta `fraccion` tras montar: la aguja "arranca",
  // no aparece ya posicionada.
  const [avance, setAvance] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAvance(fraccion));
    return () => cancelAnimationFrame(id);
  }, [fraccion]);

  const anguloAguja = avance * 360;
  const offset = CIRCUNFERENCIA * (1 - avance);

  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <div className="relative" style={{ width: tamano, height: tamano }}>
        <svg viewBox="0 0 100 100" width={tamano} height={tamano} className="-rotate-90">
          {/* Disco de fondo, como el zócalo del isotipo. */}
          <circle cx="50" cy="50" r={R} fill="var(--card)" />
          {/* Pista: el círculo completo, apagado. */}
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="var(--border)"
            strokeWidth="7"
          />
          {/* Sector: crece con el avance, mismo rojo institucional del isotipo. */}
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={CIRCUNFERENCIA}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-[900ms] ease-out motion-reduce:transition-none"
          />
        </svg>
        {/* Aguja: disco vacío por dentro, así que puede girar completa sin
            taparle nada a nadie. */}
        <svg
          viewBox="0 0 100 100"
          width={tamano}
          height={tamano}
          className="absolute inset-0"
          aria-hidden="true"
        >
          <g
            className="origin-[50px_50px] transition-transform duration-[900ms] ease-out motion-reduce:transition-none"
            style={{ transform: `rotate(${anguloAguja}deg)` }}
          >
            <line x1="50" y1="50" x2="50" y2="14" stroke="var(--foreground)" strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <circle cx="50" cy="50" r="4" fill="var(--foreground)" />
        </svg>
      </div>

      <Dato
        etiqueta={etiqueta}
        valor={valor}
        unidad={unidad}
        tamano="xl"
        className="mt-3 flex flex-col items-center text-center"
      />
    </div>
  );
}
