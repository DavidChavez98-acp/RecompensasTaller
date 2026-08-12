/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import Image from "next/image";
import { redirect } from "next/navigation";
import { getSesionCliente } from "@/actions/auth-cliente";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccesoForm } from "./AccesoForm";

export const metadata = {
  title: "Ingresar | Recompensas Taller",
};

export default async function AccesoPage() {
  const sesion = await getSesionCliente();
  if (sesion) redirect("/");

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
          <CardHeader>
            <CardTitle>Recompensas Taller</CardTitle>
            <CardDescription>
              Acumula puntos por el mantenimiento de tu vehículo y canjéalos por premios.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccesoForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
