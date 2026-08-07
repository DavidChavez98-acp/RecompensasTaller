/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { solicitarCanje } from "@/actions/canjes";
import { Button } from "@/components/ui/button";
import { formatearPuntos } from "@/lib/utils";

export function SolicitarCanje({
  premioId,
  premioNombre,
  costoPuntos,
  saldo,
  disponible,
}: {
  premioId: string;
  premioNombre: string;
  costoPuntos: number;
  saldo: number;
  disponible: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  // Se genera UNA vez por montaje del formulario: un doble toque manda la misma
  // clave y el servidor devuelve el canje ya creado en vez de cobrar dos veces.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const alcanza = saldo >= costoPuntos;
  const faltan = costoPuntos - saldo;

  function confirmar() {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await solicitarCanje({
        premio_id: premioId,
        idempotency_key: idempotencyKey,
      });

      if (!resultado.ok) {
        setError(resultado.error);
        setConfirmando(false);
        return;
      }

      router.push("/canjes");
      router.refresh();
    });
  }

  if (!disponible) {
    return (
      <Button disabled className="w-full">
        Agotado por ahora
      </Button>
    );
  }

  if (!alcanza) {
    return (
      <div className="space-y-2">
        <Button disabled className="w-full">
          Te faltan {formatearPuntos(faltan)} puntos
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Sigue acumulando con el mantenimiento de tu vehículo.
        </p>
      </div>
    );
  }

  if (!confirmando) {
    return (
      <div className="space-y-2">
        <Button onClick={() => setConfirmando(true)} className="w-full">
          Canjear por {formatearPuntos(costoPuntos)} puntos
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 border border-border p-4">
      <p className="text-sm">
        Vas a canjear <span className="font-medium">{premioNombre}</span> por{" "}
        {formatearPuntos(costoPuntos)} puntos.
      </p>

      {/*
        La interfaz NO oculta que el cobro es al pedir, no al recibir. Es la
        regla del proyecto hermano: nada de fingir capacidades ni esconder lo
        que realmente pasa.
      */}
      <p className="text-xs text-muted-foreground">
        Se descontarán ahora mismo. Si el taller lo rechaza o tú lo cancelas, se te devuelven
        automáticamente.
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setConfirmando(false)} disabled={pendiente}>
          Ahora no
        </Button>
        <Button onClick={confirmar} className="flex-1" disabled={pendiente}>
          {pendiente ? "Solicitando…" : "Confirmar"}
        </Button>
      </div>
    </div>
  );
}
