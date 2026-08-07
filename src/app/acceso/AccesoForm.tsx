/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { solicitarCodigoOtp } from "@/actions/auth-cliente";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * La cédula se guarda en sessionStorage, no en la URL: un parámetro de
 * consulta queda en el historial del navegador y en los logs del servidor.
 * sessionStorage vive solo en el dispositivo del propio dueño del dato y se
 * borra al cerrar la pestaña.
 */
export const CLAVE_CEDULA = "gp_cedula_en_curso";

export function AccesoForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function onSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const identificacion = String(datos.get("identificacion") ?? "").trim();

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await solicitarCodigoOtp(identificacion);

      if (resultado.success) {
        sessionStorage.setItem(CLAVE_CEDULA, identificacion);
        router.push("/acceso/codigo");
        return;
      }

      if ("requiereRegistro" in resultado) {
        sessionStorage.setItem(CLAVE_CEDULA, identificacion);
        router.push("/acceso/registro");
        return;
      }

      setError(resultado.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="identificacion">Cédula o RUC</Label>
        <Input
          id="identificacion"
          name="identificacion"
          // Teclado numérico en el teléfono sin bloquear el pegado.
          inputMode="numeric"
          autoComplete="off"
          maxLength={13}
          placeholder="1712345678"
          required
          disabled={pendiente}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Te enviaremos un código de 6 dígitos a tu correo. No necesitas contraseña.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pendiente}>
        {pendiente ? "Enviando código…" : "Continuar"}
      </Button>
    </form>
  );
}
