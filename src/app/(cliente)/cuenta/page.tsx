/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Cuenta del cliente: perfil, dispositivos con el código QR activo, y las dos
 * acciones LOPDP de autoservicio — exportar datos y eliminar la cuenta.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { cerrarSesionCliente, getSesionCliente } from "@/actions/auth-cliente";
import { listarDispositivos } from "@/actions/dispositivos";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DispositivosCliente } from "./DispositivosCliente";
import { ExportarDatos } from "./ExportarDatos";
import { EliminarCuenta } from "./EliminarCuenta";

export const metadata = {
  title: "Mi cuenta | Recompensas Taller",
};

export default async function CuentaPage() {
  const sesion = await getSesionCliente();
  if (!sesion) return null;

  const dispositivos = await listarDispositivos();

  async function salir() {
    "use server";
    await cerrarSesionCliente();
    redirect("/acceso");
  }

  return (
    <div className="space-y-5">
      <h1 className="t-titulo">Mi cuenta</h1>

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

      <div className="space-y-2">
        <h2 className="t-seccion text-muted-foreground">Dispositivos con tu código</h2>
        <DispositivosCliente clienteId={sesion.clienteId} dispositivos={dispositivos} />
      </div>

      <div className="space-y-2">
        <h2 className="t-seccion text-muted-foreground">Tus datos</h2>
        <ExportarDatos />
        <Link
          href="/politica-privacidad"
          className="block text-sm text-primary underline underline-offset-4"
        >
          Política de tratamiento de datos
        </Link>
      </div>

      <form action={salir}>
        <Button type="submit" variant="outline" className="w-full">
          Cerrar sesión
        </Button>
      </form>

      <div className="space-y-2 pt-2 border-t border-border">
        <h2 className="t-seccion text-muted-foreground">Eliminar cuenta</h2>
        <EliminarCuenta />
      </div>
    </div>
  );
}
