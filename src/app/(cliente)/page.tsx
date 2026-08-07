/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Home de la PWA. Una sola lectura: el saldo viene de `clientes.saldo_cache`,
 * que ya trae la consulta de sesión. Cero consultas adicionales.
 */

import Link from "next/link";
import { QrCode } from "lucide-react";
import { getSesionCliente } from "@/actions/auth-cliente";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatearPuntos } from "@/lib/utils";

export const metadata = {
  title: "Mis puntos | Recompensas Taller",
};

export default async function ClienteHome() {
  // El layout ya garantiza que existe; React `cache()` deduplica la consulta.
  const sesion = await getSesionCliente();
  if (!sesion) return null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">Hola,</p>
        <h1 className="text-xl font-semibold">{sesion.nombres.split(" ")[0]}</h1>
      </div>

      <Card>
        <CardContent className="py-8 text-center space-y-1">
          <p className="text-sm text-muted-foreground">Tus puntos</p>
          <p className="text-5xl font-semibold tabular-nums">{formatearPuntos(sesion.saldo)}</p>
        </CardContent>
      </Card>

      {/*
        Base UI usa `render` en vez del `asChild` de Radix. `nativeButton={false}`
        es obligatorio al renderizar un <a>: sin él, Base UI aplica semántica de
        <button> nativo sobre un enlace y avisa de que rompe formularios y
        accesibilidad.
      */}
      <Button render={<Link href="/qr" />} nativeButton={false} className="w-full h-14 text-base">
        <QrCode className="h-5 w-5" />
        Mostrar mi código
      </Button>

      {!sesion.verificado && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Tu cuenta aún no ha sido verificada en el taller. En tu próxima visita muestra
            tu cédula al asesor para activarla del todo.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Cómo funciona</p>
          <p>
            Muestra tu código al asesor cuando dejes o retires tu vehículo. Él lo escanea y
            tus puntos se acreditan según el servicio y el monto.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
