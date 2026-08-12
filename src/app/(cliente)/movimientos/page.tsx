/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * El ledger del cliente, en su idioma. Cada línea explica de dónde salieron o
 * a dónde se fueron los puntos: es lo que evita el reclamo en mostrador.
 */

import { getSesionCliente } from "@/actions/auth-cliente";
import { listarMisMovimientos, type MovimientoCliente } from "@/actions/puntos";
import { Card, CardContent } from "@/components/ui/card";
import { formatearFecha, formatearMonto, formatearPuntos } from "@/lib/utils";

export const metadata = { title: "Mis puntos | Recompensas Taller" };

function describir(movimiento: MovimientoCliente): string {
  switch (movimiento.tipo) {
    case "acreditacion":
      return movimiento.servicio
        ? `${movimiento.servicio}${movimiento.monto ? ` · ${formatearMonto(movimiento.monto)}` : ""}`
        : "Servicio en el taller";
    case "canje":
      return movimiento.motivo ?? "Canje de premio";
    case "reverso":
      return movimiento.motivo ?? "Devolución de puntos";
    case "ajuste":
      return movimiento.motivo ?? "Ajuste del taller";
    case "expiracion":
      return "Puntos vencidos";
  }
}

export default async function MovimientosPage() {
  const sesion = await getSesionCliente();
  if (!sesion) return null;

  const movimientos = await listarMisMovimientos();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-titulo">Mis puntos</h1>
        <p className="text-sm text-muted-foreground">
          Saldo actual: {formatearPuntos(sesion.saldo)} puntos.
        </p>
      </div>

      {movimientos.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Todavía no tienes movimientos. En tu próxima visita al taller, muestra tu código.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {movimientos.map((movimiento) => (
            <Card key={movimiento.id}>
              <CardContent className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">{describir(movimiento)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatearFecha(movimiento.fecha)}
                    {movimiento.documento ? ` · ${movimiento.documento}` : ""}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p
                    className={`text-sm font-medium tabular-nums ${
                      movimiento.puntos >= 0 ? "text-success" : "text-foreground"
                    }`}
                  >
                    {movimiento.puntos >= 0 ? "+" : "−"}
                    {formatearPuntos(Math.abs(movimiento.puntos))}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    saldo {formatearPuntos(movimiento.saldoPosterior)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
