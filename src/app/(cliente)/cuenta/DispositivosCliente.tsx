/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Dispositivos que hoy pueden generar el código QR de este cliente. Revocar
 * uno cierra su acceso de inmediato: `revocarDispositivo()` ya tiene efecto
 * real (qr-token.server.ts filtra por `revocado_en IS NULL`), esto solo le
 * pone una pantalla.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revocarDispositivo, type DispositivoListado } from "@/actions/dispositivos";
import { borrarDispositivoLocal, leerDispositivoLocal } from "@/lib/qr-device.client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatearFecha } from "@/lib/utils";

export function DispositivosCliente({
  clienteId,
  dispositivos,
}: {
  clienteId: string;
  dispositivos: DispositivoListado[];
}) {
  const router = useRouter();
  const [pendienteId, setPendienteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function revocar(dispositivoId: string) {
    setError(null);
    setPendienteId(dispositivoId);
    iniciarTransicion(async () => {
      const resultado = await revocarDispositivo(dispositivoId);
      if (!resultado.success) {
        setError(resultado.error ?? "No pudimos revocar el dispositivo.");
        setPendienteId(null);
        return;
      }

      // Si el dispositivo revocado es ESTE teléfono, hay que borrar también el
      // secreto local: si no, QrIdentidad.tsx seguiría generando códigos con
      // un secreto que el servidor ya no reconoce, y el asesor los vería como
      // "código desconocido" sin que el cliente entienda por qué.
      const local = leerDispositivoLocal(clienteId);
      if (local?.dispositivoId === dispositivoId) {
        borrarDispositivoLocal();
      }

      router.refresh();
    });
  }

  if (dispositivos.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          No tienes dispositivos con tu código activo.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {dispositivos.map((dispositivo) => {
        const revocando = pendiente && pendienteId === dispositivo.id;
        return (
          <Card key={dispositivo.id}>
            <CardContent className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm">{dispositivo.etiqueta ?? "Dispositivo desconocido"}</p>
                <p className="text-xs text-muted-foreground">
                  Desde {formatearFecha(dispositivo.fechaCreacion)}
                  {dispositivo.ultimaActividad
                    ? ` · Último uso ${formatearFecha(dispositivo.ultimaActividad)}`
                    : ""}
                </p>
              </div>
              <Button
                variant="destructive"
                disabled={revocando}
                onClick={() => revocar(dispositivo.id)}
              >
                {revocando ? "…" : "Revocar"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
