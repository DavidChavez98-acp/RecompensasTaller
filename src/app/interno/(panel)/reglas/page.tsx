/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { redirect } from "next/navigation";
import { getSesionInterna } from "@/actions/auth-interno";
import { puedeGestionarReglas } from "@/lib/authz";
import { getReglaVigente, listarHistorialReglas, listarServicios } from "@/actions/reglas";
import { Card, CardContent } from "@/components/ui/card";
import { EditorReglas } from "./EditorReglas";

export const metadata = { title: "Reglas | Recompensas Taller" };

export default async function ReglasPage() {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  // La comprobación va aquí, no en el menú: ocultar el enlace es cosmético.
  if (!puedeGestionarReglas(sesion)) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Solo el Admin puede cambiar las reglas de puntos.
        </CardContent>
      </Card>
    );
  }

  const [reglaVigente, historial, servicios] = await Promise.all([
    getReglaVigente(),
    listarHistorialReglas(),
    listarServicios(),
  ]);

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="t-titulo">Reglas de puntos</h1>
        <p className="text-sm text-muted-foreground">
          Define cuántos puntos vale un dólar gastado en el taller.
        </p>
      </div>

      <EditorReglas reglaVigente={reglaVigente} historial={historial} servicios={servicios} />
    </div>
  );
}
