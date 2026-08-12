/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { getSesionCliente } from "@/actions/auth-cliente";
import { listarCatalogo } from "@/actions/premios";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatearPuntos } from "@/lib/utils";
import { SolicitarCanje } from "./SolicitarCanje";

export const metadata = { title: "Premios | Recompensas Taller" };

export default async function PremiosPage() {
  const sesion = await getSesionCliente();
  if (!sesion) return null;

  const catalogo = await listarCatalogo();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-titulo">Premios</h1>
        <p className="text-sm text-muted-foreground">
          Tienes {formatearPuntos(sesion.saldo)} puntos.
        </p>
      </div>

      {catalogo.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            El catálogo todavía no tiene premios. Tus puntos se siguen acumulando mientras tanto.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {catalogo.map((premio) => (
            <Card key={premio.id} className={premio.disponible ? undefined : "opacity-70"}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="t-seccion text-muted-foreground">{premio.nombre}</h2>
                      {/*
                        Un premio agotado se sigue viendo: quien esté ahorrando
                        para él necesita saber que existe. Lo que NUNCA se
                        muestra es cuántas unidades quedan.
                      */}
                      {!premio.disponible && <Badge variant="secondary">Agotado</Badge>}
                      {premio.tipo === "servicio" && <Badge variant="outline">Servicio</Badge>}
                    </div>
                    {premio.descripcion && (
                      <p className="text-sm text-muted-foreground mt-1">{premio.descripcion}</p>
                    )}
                  </div>

                  <p className="text-sm font-medium tabular-nums shrink-0">
                    {formatearPuntos(premio.costoPuntos)} pts
                  </p>
                </div>

                <SolicitarCanje
                  premioId={premio.id}
                  premioNombre={premio.nombre}
                  costoPuntos={premio.costoPuntos}
                  saldo={sesion.saldo}
                  disponible={premio.disponible}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
