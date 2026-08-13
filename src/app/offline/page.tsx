/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * `navigateFallback: "/offline"` en `next.config.ts` apunta aquí desde el
 * día 1 del plugin PWA, pero la ruta nunca existió — sin red, cualquier
 * navegación caía en un 404 silencioso. Esta página lo cierra.
 *
 * Fuera del grupo `(cliente)` a propósito: ese grupo exige sesión llamando a
 * `getSesionCliente()` en su layout, y esa llamada necesita red/DB. Esta
 * página cuelga solo del layout raíz.
 *
 * 100% estática, sin excepción: nada de `cookies()`, `headers()` ni consultas
 * a `db`. Si algo aquí la vuelve dinámica, Next deja de prerenderizarla en el
 * build y el plugin PWA no la mete bien en el precache — el
 * `navigateFallback` queda roto otra vez, en silencio, exactamente como pasó
 * una vez con el manifest (ver el comentario de cabecera en
 * `src/app/manifest.ts`).
 */

import Image from "next/image";
import { WifiOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Sin conexión | Recompensas Taller",
};

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <Image
          src="/logo-gp-horizontal.svg"
          alt="Grupo Palacios"
          width={170}
          height={16}
          className="h-6 w-auto mx-auto"
          priority
        />
        <Card>
          <CardHeader className="items-center text-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <WifiOff className="size-5" />
            </span>
            <CardTitle className="t-titulo">Sin conexión</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              No hay señal en este momento. Dos cosas que debes saber:
            </p>
            <ul className="space-y-3 text-left text-sm">
              <li>
                Tu <strong className="font-medium text-foreground">código QR</strong> sigue
                funcionando sin internet, siempre que hayas abierto la app antes: se genera en tu
                propio teléfono, no necesita red.
              </li>
              <li>
                Cualquier <strong className="font-medium text-foreground">saldo, canje o
                movimiento</strong> que veas en pantalla puede estar desactualizado hasta que
                vuelva la conexión.
              </li>
            </ul>
            {/*
              <a> a propósito, no `next/link`: sin red, una transición del
              router de cliente se queda colgada esperando un fetch que nunca
              vuelve. Un ancla fuerza una recarga completa, que es la forma
              real de comprobar si ya volvió la señal.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className={cn(buttonVariants({ variant: "default" }), "w-full")}>
              Reintentar
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
