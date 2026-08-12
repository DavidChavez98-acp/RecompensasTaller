/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { getSesionCliente } from "@/actions/auth-cliente";
import { listarMisCanjes } from "@/actions/canjes";
import { explicacionCliente, textoEstado } from "@/lib/canje-estado";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatearFecha, formatearPuntos } from "@/lib/utils";
import { CancelarCanje } from "./CancelarCanje";

export const metadata = { title: "Mis canjes | Recompensas Taller" };

export default async function CanjesPage() {
  const sesion = await getSesionCliente();
  if (!sesion) return null;

  const canjes = await listarMisCanjes();

  return (
    <div className="space-y-5">
      <h1 className="t-titulo">Mis canjes</h1>

      {canjes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Todavía no has canjeado nada.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {canjes.map((canje) => (
            <Card key={canje.id}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{canje.premioNombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatearPuntos(canje.costoPuntos)} puntos ·{" "}
                      {formatearFecha(canje.solicitadoEn)}
                    </p>
                  </div>
                  <Badge
                    variant={
                      canje.estado === "aprobado"
                        ? "default"
                        : canje.estado === "entregado"
                          ? "outline"
                          : "secondary"
                    }
                  >
                    {textoEstado(canje.estado)}
                  </Badge>
                </div>

                <p className="text-sm text-muted-foreground">
                  {canje.motivoCierre ?? explicacionCliente(canje.estado)}
                </p>

                {/*
                  El código solo aparece cuando el canje está aprobado, y solo
                  aquí: es la prueba de que el cliente está presente cuando el
                  asesor lo teclea al entregar.
                */}
                {canje.estado === "aprobado" && canje.codigoEntrega && (
                  <div className="border border-border p-3 text-center">
                    <p className="text-xs text-muted-foreground">Código de retiro</p>
                    <p className="font-mono text-2xl tracking-[0.3em]">{canje.codigoEntrega}</p>
                  </div>
                )}

                {canje.estado === "solicitado" && <CancelarCanje canjeId={canje.id} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
