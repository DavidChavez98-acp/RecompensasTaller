/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getSesionInterna } from "@/actions/auth-interno";
import { puedeRevertirPuntos } from "@/lib/authz";
import { getClienteDetalle, getMovimientosCliente } from "@/actions/clientes";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatearFecha, formatearPuntos } from "@/lib/utils";
import { AjustarPuntos, BotonVerificar, HistorialCliente } from "./AccionesCliente";

export const metadata = { title: "Cliente | Recompensas Taller" };

export default async function ClienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  const { id } = await params;
  const [cliente, movimientos] = await Promise.all([
    getClienteDetalle(id),
    getMovimientosCliente(id),
  ]);

  if (!cliente) notFound();

  return (
    <div className="space-y-6 max-w-2xl">
      <Link
        href="/interno/clientes"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Clientes
      </Link>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">{cliente.nombres}</h1>
          {cliente.verificado ? (
            <Badge variant="outline">Verificado</Badge>
          ) : (
            <Badge variant="secondary">Sin verificar</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {cliente.identificacion}
          {cliente.email ? ` · ${cliente.email}` : ""}
          {cliente.telefono ? ` · ${cliente.telefono}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          Cliente desde {formatearFecha(cliente.fechaCreacion)} · origen {cliente.origen}
        </p>
      </div>

      <Card>
        <CardContent className="py-6 text-center">
          <p className="text-xs text-muted-foreground">Saldo</p>
          <p className="text-3xl font-semibold tabular-nums">
            {formatearPuntos(cliente.saldo)}
          </p>
        </CardContent>
      </Card>

      {!cliente.verificado && (
        <Card className="border-warning">
          <CardContent className="py-4 space-y-3">
            <p className="flex items-start gap-2 text-sm">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
              Esta cuenta se creó por auto-registro. Eso prueba que el correo es suyo, no que la
              cédula lo sea.
            </p>
            <BotonVerificar clienteId={cliente.id} />
          </CardContent>
        </Card>
      )}

      {puedeRevertirPuntos(sesion) && (
        <div>
          <AjustarPuntos clienteId={cliente.id} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">Historial de puntos</h2>
        <HistorialCliente
          movimientos={movimientos}
          puedeRevertir={puedeRevertirPuntos(sesion)}
        />
      </section>
    </div>
  );
}
