/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { redirect } from "next/navigation";
import { getSesionInterna } from "@/actions/auth-interno";
import { puedeGestionarInventario, puedeRegistrarSalidaInventario } from "@/lib/authz";
import {
  getConsumoPorCanal,
  getFeriasSinCerrar,
  getValorizacionInventario,
  listarArticulos,
} from "@/actions/inventario";
import { Card, CardContent } from "@/components/ui/card";
import { InventarioClient } from "./InventarioClient";
import { ResumenInventario } from "./ResumenInventario";

export const metadata = { title: "Inventario | Recompensas Taller" };

export default async function InventarioPage() {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  // La comprobación va aquí, no en el menú: ocultar el enlace es cosmético.
  const puedeGestionar = puedeGestionarInventario(sesion);
  const puedeSalida = puedeRegistrarSalidaInventario(sesion);

  if (!puedeGestionar && !puedeSalida) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Tu rol no permite ver el inventario de marketing.
        </CardContent>
      </Card>
    );
  }

  // Los reportes son de gestión, no de mostrador: el Asesor Comercial no los
  // necesita, así que se saltan la consulta si no puede gestionar inventario.
  const [articulos, valorizacion, consumo, ferias] = await Promise.all([
    listarArticulos(),
    puedeGestionar ? getValorizacionInventario() : Promise.resolve(null),
    puedeGestionar ? getConsumoPorCanal(30) : Promise.resolve([]),
    puedeGestionar ? getFeriasSinCerrar(7) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="t-titulo">Inventario</h1>
        <p className="text-sm text-muted-foreground">
          Artículos de marketing: merchandising, material de punto de venta, lo que sale en
          ferias y entregas de vehículo.
        </p>
      </div>

      {puedeGestionar && valorizacion && (
        <ResumenInventario valorizacion={valorizacion} consumo={consumo} ferias={ferias} />
      )}

      <InventarioClient
        articulos={articulos}
        puedeGestionar={puedeGestionar}
        puedeSalida={puedeSalida}
      />
    </div>
  );
}
