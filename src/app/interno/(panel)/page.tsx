/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Dashboard del día. En el hito 1 solo confirma la sesión y encamina al
 * asesor; las métricas reales llegan con el ledger (hito 3) y los reportes
 * (hito 6).
 */

import Link from "next/link";
import { getSesionInterna } from "@/actions/auth-interno";
import { puedeAcreditarPuntos, puedeAprobarCanje } from "@/lib/authz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Inicio | Recompensas Taller",
};

export default async function PanelInicio() {
  // El layout ya garantiza que existe; se relee aquí para el saludo y las
  // capacidades (React `cache()` lo deduplica, no hay consulta extra).
  const sesion = await getSesionInterna();
  if (!sesion) return null;

  const accesos = [
    {
      href: "/interno/escanear",
      titulo: "Escanear cliente",
      descripcion: "Lee el código del cliente y acredita los puntos del servicio.",
      visible: puedeAcreditarPuntos(sesion),
    },
    {
      href: "/interno/canjes",
      titulo: "Canjes pendientes",
      descripcion: "Aprueba contra inventario real y entrega en el mostrador.",
      visible: true,
    },
    {
      href: "/interno/clientes",
      titulo: "Clientes",
      descripcion: "Busca por nombre o cédula cuando la cámara no coopera.",
      visible: true,
    },
  ].filter((a) => a.visible);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hola, {sesion.nombre.split(" ")[0]}</h1>
        <p className="text-muted-foreground text-sm">
          {puedeAprobarCanje(sesion)
            ? "Tienes permiso para aprobar canjes contra el inventario de marketing."
            : "Puedes acreditar puntos y entregar los canjes ya aprobados."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accesos.map((acceso) => (
          <Link key={acceso.href} href={acceso.href} className="block">
            <Card className="h-full hover:border-primary transition-colors">
              <CardHeader>
                <CardTitle className="text-base">{acceso.titulo}</CardTitle>
                <CardDescription>{acceso.descripcion}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Programa en construcción</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>Hito 1 (cimientos) completado: base de datos, sesión y panel.</p>
          <p>Siguiente: identidad del cliente por cédula y código de un solo uso.</p>
        </CardContent>
      </Card>
    </div>
  );
}
