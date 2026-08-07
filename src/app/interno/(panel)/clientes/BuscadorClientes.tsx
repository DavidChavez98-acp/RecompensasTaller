/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { buscarClientes, type ClienteResumen } from "@/actions/clientes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatearPuntos } from "@/lib/utils";

export function BuscadorClientes() {
  const [resultados, setResultados] = useState<ClienteResumen[] | null>(null);
  const [buscando, iniciarBusqueda] = useTransition();

  function buscar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const consulta = String(new FormData(evento.currentTarget).get("consulta") ?? "");
    iniciarBusqueda(async () => {
      setResultados(await buscarClientes(consulta));
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={buscar} className="flex gap-2">
        <Input name="consulta" placeholder="Nombre o cédula" autoFocus disabled={buscando} />
        <Button type="submit" disabled={buscando}>
          {buscando ? "Buscando…" : "Buscar"}
        </Button>
      </form>

      {resultados !== null && resultados.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Sin resultados. Escribe al menos 3 caracteres del nombre, o la cédula completa.
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
