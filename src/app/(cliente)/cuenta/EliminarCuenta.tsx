/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Baja LOPDP. Confirmación inline de dos pasos, mismo patrón que
 * CancelarCanje.tsx: el botón cambia a "¿Seguro?" y hay que tocar de nuevo, en
 * vez de un modal (no hay Dialog instalado en este proyecto).
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anonimizarMiCuenta } from "@/actions/lopdp";
import { Button } from "@/components/ui/button";

export function EliminarCuenta() {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function eliminar() {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await anonimizarMiCuenta();
      if (!resultado.ok) {
        // El error de "canje pendiente" ya es un mensaje claro para el
        // cliente: se muestra tal cual, sin envolverlo en uno genérico.
        setError(resultado.error ?? "No pudimos eliminar tu cuenta.");
        setConfirmando(false);
        return;
      }
      router.push("/acceso");
    });
  }

  if (!confirmando) {
    return (
      <div className="space-y-1">
        <Button variant="destructive" className="w-full" onClick={() => setConfirmando(true)}>
          Eliminar mi cuenta
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
      <p className="text-xs text-muted-foreground">
        ¿Seguro? Borramos tus datos personales y no podrás volver a entrar con esta cuenta. Tu
        historial de puntos se conserva de forma anónima por ser un registro contable.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="flex-1" onClick={() => setConfirmando(false)} disabled={pendiente}>
          No
        </Button>
        <Button variant="destructive" className="flex-1" onClick={eliminar} disabled={pendiente}>
          {pendiente ? "…" : "Sí, eliminar"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
