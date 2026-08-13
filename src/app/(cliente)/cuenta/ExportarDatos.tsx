/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Derecho de acceso LOPDP: descarga de todos los datos del cliente en un solo
 * JSON. Primer patrón de descarga del repo — sin Route Handler, sin
 * dependencias nuevas: un Blob armado en el navegador y un enlace efímero.
 */

"use client";

import { useState, useTransition } from "react";
import { exportarMisDatos } from "@/actions/lopdp";
import { Button } from "@/components/ui/button";

export function ExportarDatos() {
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function exportar() {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await exportarMisDatos();
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      const blob = new Blob([JSON.stringify(resultado.datos, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const fecha = new Date().toISOString().slice(0, 10);

      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `mis-datos-recompensas-taller-${fecha}.json`;
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="space-y-1">
      <Button variant="outline" className="w-full" disabled={pendiente} onClick={exportar}>
        {pendiente ? "Preparando…" : "Descargar mis datos"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
