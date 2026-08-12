/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { getSesionCliente } from "@/actions/auth-cliente";
import { QrIdentidad } from "@/components/QrIdentidad";

export const metadata = { title: "Mi código | Recompensas Taller" };

export default async function QrPage() {
  const sesion = await getSesionCliente();
  if (!sesion) return null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-titulo">Mi código</h1>
        <p className="text-sm text-muted-foreground">
          Muéstraselo al asesor para que acredite tus puntos.
        </p>
      </div>

      <QrIdentidad clienteId={sesion.clienteId} />
    </div>
  );
}
