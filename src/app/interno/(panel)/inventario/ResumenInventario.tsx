/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Valorización, consumo por canal y ferias sin cerrar. Solo Jefe de Marketing
 * y Admin — es lectura de gestión, no de mostrador.
 */

import type {
  ConsumoCanal,
  FeriaSinCerrar,
  Valorizacion,
} from "@/actions/inventario";
import { Card, CardContent } from "@/components/ui/card";
import { Dato } from "@/components/ui/dato";
import { formatearFecha, formatearMonto } from "@/lib/utils";

const ETIQUETA_CANAL: Record<string, string> = {
  salida_canje: "Canjes",
  salida_entrega_vehiculo: "Entregas de vehículo",
  salida_evento: "Ferias / eventos",
  salida_merma: "Merma",
  salida_interna: "Uso interno",
};

export function ResumenInventario({
  valorizacion,
  consumo,
  ferias,
}: {
  valorizacion: Valorizacion;
  consumo: ConsumoCanal[];
  ferias: FeriaSinCerrar[];
}) {
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="t-seccion text-muted-foreground">Estado del inventario</h2>
        <Card>
          <CardContent className="py-5">
            <Dato
              etiqueta="Valor del inventario"
              valor={formatearMonto(valorizacion.total)}
              protagonista
              nota={
                valorizacion.sinCosto > 0
                  ? `${valorizacion.sinCosto} artículo(s) con stock no tienen costo registrado, no están incluidos`
                  : "Stock × último costo unitario conocido"
              }
            />
          </CardContent>
        </Card>
      </section>

      {consumo.length > 0 && (
        <section className="space-y-2">
          <h2 className="t-seccion text-muted-foreground">Salidas de los últimos 30 días</h2>
          <Card>
            <CardContent className="py-1 divide-y divide-border">
              {consumo.map((c) => (
                <div key={c.motivo} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{ETIQUETA_CANAL[c.motivo] ?? c.motivo}</span>
                  <span className="font-medium tabular-nums">{c.unidades}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {ferias.length > 0 && (
        <section className="space-y-2">
          <h2 className="t-seccion text-warning">Ferias sin cerrar</h2>
          <Card className="border-warning">
            <CardContent className="py-1 divide-y divide-border">
              {ferias.map((f) => (
                <div key={f.evento} className="py-2.5">
                  <p className="text-sm font-medium">{f.evento}</p>
                  <p className="t-micro text-muted-foreground">
                    Salió el {formatearFecha(f.primeraSalida)} · {f.diasAbierta} días sin registrar
                    lo que volvió
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
