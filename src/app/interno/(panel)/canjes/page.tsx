/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { redirect } from "next/navigation";
import { getSesionInterna } from "@/actions/auth-interno";
import { puedeAprobarCanje, puedeEntregarCanje } from "@/lib/authz";
import { listarCanjesPendientes } from "@/actions/canjes";
import { ColaCanjes } from "./ColaCanjes";

export const metadata = { title: "Canjes | Recompensas Taller" };

export default async function CanjesInternoPage() {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  const canjes = await listarCanjesPendientes();

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">Canjes</h1>
        <p className="text-sm text-muted-foreground">
          Aprueba solo lo que tengas en bodega. Al rechazar, los puntos vuelven al cliente
          automáticamente.
        </p>
      </div>

      <ColaCanjes
        canjes={canjes}
        puedeAprobar={puedeAprobarCanje(sesion)}
        puedeEntregar={puedeEntregarCanje(sesion)}
      />
    </div>
  );
}
