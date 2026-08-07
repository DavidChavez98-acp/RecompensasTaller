/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Lo que hace falta hoy: cerrar sesión. Exportar datos, eliminar la cuenta y
 * gestionar dispositivos llegan en el hito 7 (LOPDP).
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { cerrarSesionCliente, getSesionCliente } from "@/actions/auth-cliente";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Mi cuenta | Recompensas Taller",
};

export default async function CuentaPage() {
  const sesion = await getSesionCliente();
  if (!sesion) return null;

  async function salir() {
    "use server";
    await cerrarSesionCliente();
    redirect("/acceso");
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Mi cuenta</h1>

      <Card>
        <CardContent className="py-4 space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Nombre</p>
            <p>{sesion.nombres}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Estado</p>
            <p>{sesion.verificado ? "Verificada en el taller" : "Pendiente de verificar en el taller"}</p>
          </div>
        </CardContent>
      </Card>

      <Link
        href="/politica-privacidad"
        className="block text-sm text-primary underline underline-offset-4"
      >
        Política de tratamiento de datos
      </Link>

      <form action={salir}>
        <Button type="submit" variant="outline" className="w-full">
          Cerrar sesión
        </Button>
      </form>
    </div>
  );
}
