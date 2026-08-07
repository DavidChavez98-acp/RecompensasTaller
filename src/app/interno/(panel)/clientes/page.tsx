/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { redirect } from "next/navigation";
import { getSesionInterna } from "@/actions/auth-interno";
import { BuscadorClientes } from "./BuscadorClientes";

export const metadata = { title: "Clientes | Recompensas Taller" };

export default async function ClientesPage() {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          Busca por nombre o por cédula completa. La cédula está cifrada, así que solo se puede
          buscar exacta, no por partes.
        </p>
      </div>

      <BuscadorClientes />
    </div>
  );
}
