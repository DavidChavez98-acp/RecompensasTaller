/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { ajustarPuntos, verificarCliente, type MovimientoInterno } from "@/actions/clientes";
import { reversarAcreditacion } from "@/actions/puntos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearFecha, formatearMonto, formatearPuntos } from "@/lib/utils";

export function BotonVerificar({ clienteId }: { clienteId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();

  function verificar() {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await verificarCliente(clienteId);
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo verificar.");
        setConfirmando(false);
        return;
      }
      router.refresh();
    });
  }

  if (confirmando) {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          ¿Tienes la cédula física del cliente en la mano y coincide con los datos de arriba?
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirmando(false)} disabled={pendiente}>
            No
          </Button>
          <Button size="sm" onClick={verificar} disabled={pendiente}>
            {pendiente ? "Verificando…" : "Sí, verificar"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" onClick={() => setConfirmando(true)}>
        <BadgeCheck className="h-4 w-4" />
        Verificar cédula
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function AjustarPuntos({ clienteId }: { clienteId: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await ajustarPuntos({
        clienteId,
        puntos: Number(datos.get("puntos")),
        motivo: String(datos.get("motivo") ?? ""),
      });

      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo ajustar.");
        return;
      }
      setAbierto(false);
      router.refresh();
    });
  }

  if (!abierto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        Ajustar puntos
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={enviar} className="space-y-3">
          <p className="text-sm font-medium">Ajuste manual</p>
          <p className="text-xs text-muted-foreground">
            Para lo que un reverso no puede resolver: por ejemplo, el cliente ya gastó puntos que se
            le acreditaron por error. Queda en el historial con tu nombre.
          </p>

          <div className="grid grid-cols-[120px_1fr] gap-3">
            <div className="space-y-1">
              <Label htmlFor="puntos">Puntos (+ o −)</Label>
              <Input id="puntos" name="puntos" type="number" required disabled={pendiente} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="motivo">Motivo</Label>
              <Input
                id="motivo"
                name="motivo"
                minLength={10}
                placeholder="Corrección por doble cobro en OT-2026-0034"
                required
                disabled={pendiente}
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)} disabled={pendiente}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={pendiente}>
              {pendiente ? "Aplicando…" : "Aplicar ajuste"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function HistorialCliente({
  movimientos,
  puedeRevertir,
}: {
  movimientos: MovimientoInterno[];
  puedeRevertir: boolean;
}) {
  if (movimientos.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Este cliente todavía no tiene movimientos.
        </CardContent>
      </Card>
    );
  }

  // Una transacción ya revertida no puede volver a revertirse (el índice único
  // lo impide en la base); se marca aquí para no ofrecer el botón en vano.
  const revertidas = new Set(
    movimientos.map((m) => m.reversaDeId).filter((id): id is string => !!id)
  );

  return (
    <div className="space-y-2">
      {movimientos.map((movimiento) => (
        <FilaMovimiento
          key={movimiento.id}
          movimiento={movimiento}
          yaRevertida={revertidas.has(movimiento.id)}
          puedeRevertir={puedeRevertir}
        />
      ))}
    </div>
  );
}

function FilaMovimiento({
  movimiento,
  yaRevertida,
  puedeRevertir,
}: {
  movimiento: MovimientoInterno;
  yaRevertida: boolean;
  puedeRevertir: boolean;
}) {
  const router = useRouter();
  const [revirtiendo, setRevirtiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function revertir(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const motivo = String(new FormData(evento.currentTarget).get("motivo") ?? "");

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await reversarAcreditacion(movimiento.id, motivo);
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo revertir.");
        return;
      }
      setRevirtiendo(false);
      router.refresh();
    });
  }

  const esAcreditacion = movimiento.tipo === "acreditacion";

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm">
              {movimiento.servicio ?? movimiento.motivo ?? movimiento.tipo}
              {movimiento.monto ? ` · ${formatearMonto(movimiento.monto)}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatearFecha(movimiento.fecha)}
              {movimiento.actor ? ` · ${movimiento.actor}` : ""}
              {movimiento.documento ? ` · ${movimiento.documento}` : ""}
            </p>
          </div>

          <div className="text-right shrink-0">
            <p className="text-sm font-medium tabular-nums">
              {movimiento.puntos >= 0 ? "+" : "−"}
              {formatearPuntos(Math.abs(movimiento.puntos))}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              saldo {formatearPuntos(movimiento.saldoPosterior)}
            </p>
          </div>
        </div>

        {esAcreditacion && puedeRevertir && !yaRevertida && (
          revirtiendo ? (
            <form onSubmit={revertir} className="space-y-2 border-t border-border pt-2">
              <p className="text-xs text-muted-foreground">
                Se insertará una fila de reverso. La original no se modifica: el historial conserva
                que hubo un error y quién lo corrigió.
              </p>
              <Input
                name="motivo"
                placeholder="Monto mal tecleado: eran $150, no $1.500"
                minLength={5}
                required
                disabled={pendiente}
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setRevirtiendo(false)} disabled={pendiente}>
                  Cancelar
                </Button>
                <Button type="submit" variant="destructive" size="sm" disabled={pendiente}>
                  {pendiente ? "Revirtiendo…" : "Confirmar reverso"}
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setRevirtiendo(true)}>
              Revertir
            </Button>
          )
        )}

        {yaRevertida && <p className="text-xs text-muted-foreground">Ya revertida.</p>}
      </CardContent>
    </Card>
  );
}
