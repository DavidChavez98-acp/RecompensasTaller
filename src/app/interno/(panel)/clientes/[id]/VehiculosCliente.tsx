/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  crearVehiculo,
  listarHistorialVehiculo,
  type HistorialVehiculoItem,
  type VehiculoResumen,
} from "@/actions/vehiculos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearFecha, formatearMonto, formatearPuntos } from "@/lib/utils";

export function VehiculosCliente({
  clienteId,
  vehiculos,
}: {
  clienteId: string;
  vehiculos: VehiculoResumen[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await crearVehiculo({
        clienteId,
        chasis: String(datos.get("chasis") ?? ""),
        placa: String(datos.get("placa") ?? ""),
        marca: String(datos.get("marca") ?? ""),
        modelo: String(datos.get("modelo") ?? ""),
      });

      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo guardar el vehículo.");
        return;
      }
      setAbierto(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {vehiculos.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Este cliente todavía no tiene vehículos registrados.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {vehiculos.map((v) => (
            <VehiculoFila key={v.id} vehiculo={v} />
          ))}
        </div>
      )}

      {!abierto ? (
        <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
          + Vehículo nuevo
        </Button>
      ) : (
        <Card>
          <CardContent className="py-4">
            <form onSubmit={enviar} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label htmlFor="chasis">Chasis</Label>
                  <Input
                    id="chasis"
                    name="chasis"
                    required
                    autoFocus
                    disabled={pendiente}
                    className="font-mono uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="placa">Placa (opcional)</Label>
                  <Input id="placa" name="placa" disabled={pendiente} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="marca">Marca (opcional)</Label>
                  <Input id="marca" name="marca" disabled={pendiente} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label htmlFor="modelo">Modelo (opcional)</Label>
                  <Input id="modelo" name="modelo" disabled={pendiente} />
                </div>
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAbierto(false)}
                  disabled={pendiente}
                >
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={pendiente}>
                  {pendiente ? "Guardando…" : "Guardar vehículo"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function VehiculoFila({ vehiculo }: { vehiculo: VehiculoResumen }) {
  const [expandido, setExpandido] = useState(false);
  const [historial, setHistorial] = useState<HistorialVehiculoItem[] | null>(null);
  const [cargando, iniciarCarga] = useTransition();

  function alternar() {
    if (expandido) {
      setExpandido(false);
      return;
    }
    setExpandido(true);
    if (historial !== null) return;
    iniciarCarga(async () => {
      setHistorial(await listarHistorialVehiculo(vehiculo.id));
    });
  }

  const titulo =
    [vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ") || "Vehículo";

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <button
          type="button"
          onClick={alternar}
          className="w-full flex items-center justify-between gap-2 text-left"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{titulo}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {vehiculo.chasis}
              {vehiculo.placa ? ` · ${vehiculo.placa}` : ""}
              {vehiculo.anio ? ` · ${vehiculo.anio}` : ""}
              {vehiculo.color ? ` · ${vehiculo.color}` : ""}
            </p>
          </div>
          {expandido ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>

        {expandido && (
          <div className="border-t border-border pt-2 space-y-1">
            {cargando && <p className="text-xs text-muted-foreground">Cargando…</p>}
            {!cargando && historial?.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin servicios registrados todavía.</p>
            )}
            {historial?.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p>
                    {item.servicio ?? item.tipo}
                    {item.monto ? ` · ${formatearMonto(item.monto)}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatearFecha(item.fecha)}</p>
                </div>
                <p className="text-sm font-medium tabular-nums shrink-0">
                  {item.puntos >= 0 ? "+" : "−"}
                  {formatearPuntos(Math.abs(item.puntos))}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
