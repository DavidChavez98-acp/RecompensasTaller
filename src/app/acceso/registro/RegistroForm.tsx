/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registrarCliente } from "@/actions/auth-cliente";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CLAVE_CEDULA } from "../AccesoForm";

/**
 * sessionStorage no cambia mientras esta pantalla está viva, así que no hace
 * falta suscribirse a nada: basta con una función de baja que no hace nada.
 */
const sinSuscripcion = () => () => {};
const leerCedulaGuardada = () => sessionStorage.getItem(CLAVE_CEDULA) ?? "";
// El servidor no tiene sessionStorage. Devolver "" aquí evita el desajuste de
// hidratación sin recurrir a un setState dentro de un efecto.
const cedulaEnServidor = () => "";

export function RegistroForm() {
  const router = useRouter();
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  // La cédula viene de la pantalla anterior por sessionStorage, no por la URL:
  // un parámetro de consulta con la cédula queda en el historial y en los logs.
  const cedulaGuardada = useSyncExternalStore(sinSuscripcion, leerCedulaGuardada, cedulaEnServidor);
  // Si alguien entra de frente a /acceso/registro, o corrige lo que escribió
  // antes, su edición manda sobre lo guardado.
  const [cedulaEditada, setCedulaEditada] = useState<string | null>(null);
  const cedula = cedulaEditada ?? cedulaGuardada;

  function onSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await registrarCliente({
        identificacion: String(datos.get("identificacion") ?? "").trim(),
        nombres: String(datos.get("nombres") ?? "").trim(),
        email: String(datos.get("email") ?? "").trim(),
        telefono: String(datos.get("telefono") ?? "").trim(),
        consentimiento: acepta as true,
      });

      if (!resultado.success) {
        setError(resultado.error ?? "No pudimos crear tu cuenta.");
        return;
      }

      router.push("/acceso/codigo");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="identificacion">Cédula o RUC</Label>
        <Input
          id="identificacion"
          name="identificacion"
          inputMode="numeric"
          maxLength={13}
          value={cedula}
          onChange={(e) => setCedulaEditada(e.target.value)}
          required
          disabled={pendiente}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nombres">Nombres y apellidos</Label>
        <Input
          id="nombres"
          name="nombres"
          autoComplete="name"
          maxLength={120}
          required
          disabled={pendiente}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pendiente}
        />
        <p className="text-xs text-muted-foreground">
          Aquí te llegará el código para entrar cada vez.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="telefono">Celular (opcional)</Label>
        <Input
          id="telefono"
          name="telefono"
          inputMode="tel"
          autoComplete="tel"
          maxLength={12}
          placeholder="0987654321"
          disabled={pendiente}
        />
      </div>

      <div className="flex items-start gap-3 pt-2">
        <Checkbox
          id="consentimiento"
          checked={acepta}
          onCheckedChange={(valor) => setAcepta(valor === true)}
          disabled={pendiente}
        />
        {/*
          `block` anula el `flex` que trae Label de shadcn: en un consentimiento
          el texto y su enlace tienen que fluir como un párrafo, no repartirse
          en columnas flex.
        */}
        <Label htmlFor="consentimiento" className="block text-xs font-normal leading-relaxed">
          Autorizo a Grupo Palacios a tratar mis datos personales para administrar el
          programa de recompensas, conforme a la{" "}
          <Link href="/politica-privacidad" className="text-primary underline underline-offset-2">
            política de tratamiento de datos
          </Link>
          .
        </Label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pendiente || !acepta}>
        {pendiente ? "Creando cuenta…" : "Crear mi cuenta"}
      </Button>
    </form>
  );
}
