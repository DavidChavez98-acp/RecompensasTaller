/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { solicitarCodigoOtp, verificarCodigoOtp } from "@/actions/auth-cliente";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CLAVE_CEDULA } from "../AccesoForm";

export function CodigoOtpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();
  const [reenviando, iniciarReenvio] = useTransition();

  function onSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const codigo = String(datos.get("codigo") ?? "").trim();

    setError(null);
    setAviso(null);
    iniciarTransicion(async () => {
      const resultado = await verificarCodigoOtp(codigo);
      if (!resultado.success) {
        setError(resultado.error ?? "No pudimos validar el código.");
        return;
      }
      sessionStorage.removeItem(CLAVE_CEDULA);
      router.replace("/");
      router.refresh();
    });
  }

  function reenviar() {
    const cedula = sessionStorage.getItem(CLAVE_CEDULA);
    if (!cedula) {
      router.push("/acceso");
      return;
    }

    setError(null);
    setAviso(null);
    iniciarReenvio(async () => {
      const resultado = await solicitarCodigoOtp(cedula);
      if (resultado.success) {
        setAviso("Te enviamos un código nuevo. El anterior ya no sirve.");
        return;
      }
      setError("error" in resultado ? resultado.error : "No pudimos reenviar el código.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="codigo">Código de 6 dígitos</Label>
        <Input
          id="codigo"
          name="codigo"
          inputMode="numeric"
          // Deja que iOS y Android ofrezcan el autorrelleno del código del correo.
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className="text-center text-2xl tracking-[0.5em] font-mono"
          required
          disabled={pendiente}
          autoFocus
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}

      <Button type="submit" className="w-full" disabled={pendiente}>
        {pendiente ? "Verificando…" : "Entrar"}
      </Button>

      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={reenviar}
        disabled={reenviando || pendiente}
      >
        {reenviando ? "Reenviando…" : "No me llegó, reenviar código"}
      </Button>
    </form>
  );
}
