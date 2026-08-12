/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { buscarClientes, type ClienteResumen } from "@/actions/clientes";
import { buscarVehiculoPorChasis, type VehiculoConCliente } from "@/actions/vehiculos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatearPuntos } from "@/lib/utils";

export function BuscadorClientes() {
  const [resultados, setResultados] = useState<ClienteResumen[] | null>(null);
  const [vehiculo, setVehiculo] = useState<VehiculoConCliente | null>(null);
  const [buscando, iniciarBusqueda] = useTransition();

  function buscar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const consulta = String(new FormData(evento.currentTarget).get("consulta") ?? "");
    iniciarBusqueda(async () => {
      // El chasis se busca en paralelo con el nombre/cédula: el asesor teclea
      // lo que tenga a mano y no debería tener que elegir de antemano qué es.
      const [clientesResultado, vehiculoResultado] = await Promise.all([
        buscarClientes(consulta),
        buscarVehiculoPorChasis(consulta),
      ]);
      setResultados(clientesResultado);
      setVehiculo(vehiculoResultado);
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={buscar} className="flex gap-2">
        <Input name="consulta" placeholder="Nombre, cédula o chasis" autoFocus disabled={buscando} />
        <Button type="submit" disabled={buscando}>
          {buscando ? "Buscando…" : "Buscar"}
        </Button>
      </form>

      {vehiculo && (
        <Card className="border-primary">
          <CardContent className="py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Vehículo encontrado por chasis</p>
              <Link
                href={`/interno/clientes/${vehiculo.clienteId}`}
                className="text-sm font-medium hover:underline"
              >
                {[vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ") || vehiculo.chasis}
              </Link>
              <p className="text-xs text-muted-foreground">
                {vehiculo.placa ? `${vehiculo.placa} · ` : ""}
                de {vehiculo.clienteNombres}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {resultados !== null && resultados.length === 0 && !vehiculo && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Sin resultados. Escribe al menos 3 caracteres del nombre, la cédula completa, o el chasis.
          </CardContent>
        </Card>
      )}

      {resultados && resultados.length > 0 && (
        <div className="space-y-2">
          {resultados.map((cliente) => (
            <Card key={cliente.id}>
              <CardContent className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/interno/clientes/${cliente.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {cliente.nombres}
                    </Link>
                    {!cliente.verificado && <Badge variant="secondary">Sin verificar</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{cliente.identificacion}</p>
                </div>
                <span className="text-sm tabular-nums shrink-0">
                  {formatearPuntos(cliente.saldo)} pts
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
