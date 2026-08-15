/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * No intenta iniciar sesión automáticamente tras definir la contraseña: eso
 * exigiría exportar la lógica de firma de sesión de `auth-interno.ts` (que
 * lleva "use server", así que cualquier export nuevo ahí sería invocable
 * desde el navegador) o duplicarla aquí. Más simple y más seguro: redirige a
 * /interno/login y el usuario entra con el flujo normal.
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { definirPasswordInicial } from "@/actions/definir-password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DefinirPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();

  function onSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const password = String(datos.get("password") ?? "");
    const confirmacion = String(datos.get("confirmacion") ?? "");

    setError(null);

    if (password !== confirmacion) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    iniciarTransicion(async () => {
      const resultado = await definirPasswordInicial({ token, password });
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo configurar la contraseña.");
        return;
      }
      setListo(true);
      router.replace("/interno/login");
    });
  }

  if (listo) {
    return (
      <p className="text-sm text-muted-foreground">
        Contraseña configurada. Redirigiendo al acceso…
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña nueva</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
          disabled={pendiente}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmacion">Confirma la contraseña</Label>
        <Input
          id="confirmacion"
          name="confirmacion"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={pendiente}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pendiente}>
        {pendiente ? "Guardando…" : "Configurar contraseña"}
      </Button>
    </form>
  );
}
