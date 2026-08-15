/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { redirect } from "next/navigation";
import { getSesionInterna } from "@/actions/auth-interno";
import { puedeGestionarUsuarios } from "@/lib/authz";
import { listarUsuarios } from "@/actions/usuarios";
import { Card, CardContent } from "@/components/ui/card";
import { UsuariosClient } from "./UsuariosClient";

export const metadata = { title: "Usuarios | Recompensas Taller" };

export default async function UsuariosPage() {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  // La navegación NO es la defensa: el enlace del menú ya está oculto para
  // quien no es Admin, pero eso es cosmético — cualquiera que escriba esta
  // URL a mano tiene que chocar con el mismo predicado aquí, antes de que la
  // página llegue a pedir un solo dato.
  if (!puedeGestionarUsuarios(sesion)) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Tu rol no permite gestionar el personal interno.
        </CardContent>
      </Card>
    );
  }

  const usuarios = await listarUsuarios();

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="t-titulo">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          Personal con acceso al panel del taller: alta por invitación, rol y estado de cuenta.
        </p>
      </div>

      <UsuariosClient usuarios={usuarios} sesionUserId={sesion.id} />
    </div>
  );
}
