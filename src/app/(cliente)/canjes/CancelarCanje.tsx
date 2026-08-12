/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelarCanje } from "@/actions/canjes";
import { Button } from "@/components/ui/button";

export function CancelarCanje({ canjeId }: { canjeId: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function cancelar() {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await cancelarCanje(canjeId);
      if (!resultado.ok) {
        setError(resultado.error ?? "No pudimos cancelarlo.");
        setConfirmando(false);
        return;
      }
      router.refresh();
    });
  }

  if (!confirmando) {
    return (
      <div className="space-y-1">
        <Button variant="ghost" onClick={() => setConfirmando(true)}>
          Cancelar solicitud
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">¿Seguro? Te devolvemos los puntos.</p>
      {/* Sin size="sm": es una acción irreversible, no una fila densa de tabla. */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setConfirmando(false)} disabled={pendiente}>
          No
        </Button>
        <Button variant="destructive" onClick={cancelar} disabled={pendiente}>
          {pendiente ? "…" : "Sí, cancelar"}
        </Button>
      </div>
    </div>
  );
}
