/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { redirect } from "next/navigation";
import { getSesionInterna } from "@/actions/auth-interno";
import { puedeAcreditarPuntos } from "@/lib/authz";
import { getAcreditacionesRecientes, getResumenDelDia, getServiciosActivos } from "@/actions/puntos";
import { Card, CardContent } from "@/components/ui/card";
import { formatearFecha, formatearMonto, formatearPuntos } from "@/lib/utils";
import { AcreditarFlujo } from "./AcreditarFlujo";

export const metadata = { title: "Escanear | Recompensas Taller" };

export default async function EscanearPage() {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  // La comprobación va AQUÍ, no en el menú: ocultar el enlace es cosmético,
  // cualquiera puede escribir la URL.
  if (!puedeAcreditarPuntos(sesion)) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Tu rol no permite acreditar puntos.
        </CardContent>
      </Card>
    );
  }

  const [servicios, resumen, recientes] = await Promise.all([
    getServiciosActivos(),
    getResumenDelDia(),
    getAcreditacionesRecientes(5),
  ]);

  if (servicios.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No hay tipos de servicio configurados. Avisa al administrador antes de acreditar.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Escanear cliente</h1>
          <p className="text-sm text-muted-foreground">
            {/* "acreditación" pierde la tilde en plural: acreditaciones. */}
            Hoy llevas {resumen.acreditaciones}{" "}
            {resumen.acreditaciones === 1 ? "acreditación" : "acreditaciones"} ·{" "}
            {formatearPuntos(resumen.puntos)} puntos.
          </p>
        </div>

        <AcreditarFlujo servicios={servicios} />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Tus últimas acreditaciones</h2>

        {recientes.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground text-center">
              Todavía no has acreditado puntos.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recientes.map((fila) => (
              <Card key={fila.id}>
                <CardContent className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{fila.clienteNombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {fila.servicio ?? "Servicio"} · {formatearFecha(fila.fecha)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium tabular-nums">
                      +{formatearPuntos(fila.puntos)}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {fila.monto ? formatearMonto(fila.monto) : "—"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
