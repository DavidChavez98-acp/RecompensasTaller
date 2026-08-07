/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { redirect } from "next/navigation";
import { getSesionInterna } from "@/actions/auth-interno";
import { puedeGestionarPremios } from "@/lib/authz";
import { listarPremiosAdmin } from "@/actions/premios";
import { Card, CardContent } from "@/components/ui/card";
import { GestionPremios } from "./GestionPremios";

export const metadata = { title: "Premios | Recompensas Taller" };

export default async function PremiosInternoPage() {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  // La comprobación va aquí, no en el menú: ocultar el enlace es cosmético.
  if (!puedeGestionarPremios(sesion)) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Tu rol no permite gestionar el catálogo.
        </CardContent>
      </Card>
    );
  }

  const premios = await listarPremiosAdmin();

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">Premios e inventario</h1>
        <p className="text-sm text-muted-foreground">
          El cliente ve los premios agotados marcados como tales, pero nunca cuántas unidades
          quedan.
        </p>
      </div>

      <GestionPremios premios={premios} />
    </div>
  );
}
