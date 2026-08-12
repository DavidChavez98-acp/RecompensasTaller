/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageX, ShieldAlert } from "lucide-react";
import {
  aprobarCanje,
  cancelarCanjeAprobado,
  entregarCanje,
  rechazarCanje,
  type CanjeInterno,
} from "@/actions/canjes";
import {
  MOTIVOS_CANCELACION_APROBADO,
  MOTIVOS_RECHAZO,
  type MotivoCancelacionAprobado,
  type MotivoRechazo,
} from "@/lib/canje-estado";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatearFecha, formatearPuntos } from "@/lib/utils";

export function ColaCanjes({
  canjes,
  puedeAprobar,
  puedeEntregar,
}: {
  canjes: CanjeInterno[];
  puedeAprobar: boolean;
  puedeEntregar: boolean;
}) {
  if (canjes.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No hay canjes pendientes.
        </CardContent>
      </Card>
    );
  }

  const solicitados = canjes.filter((c) => c.estado === "solicitado");
  const aprobados = canjes.filter((c) => c.estado === "aprobado");

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="t-seccion text-muted-foreground">
          Por aprobar ({solicitados.length})
        </h2>
        {solicitados.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada por revisar.</p>
        ) : (
          solicitados.map((canje) => (
            <FilaPorAprobar key={canje.id} canje={canje} puedeAprobar={puedeAprobar} />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="t-seccion text-muted-foreground">
          Listos para entregar ({aprobados.length})
        </h2>
        {aprobados.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada por entregar.</p>
        ) : (
          aprobados.map((canje) => (
            <FilaPorEntregar
              key={canje.id}
              canje={canje}
              puedeEntregar={puedeEntregar}
              puedeAprobar={puedeAprobar}
            />
          ))
        )}
      </section>
    </div>
  );
}

function Cabecera({ canje, mostrarStock }: { canje: CanjeInterno; mostrarStock: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">{canje.premioNombre}</p>
        <p className="text-sm text-muted-foreground truncate">
          {canje.clienteNombre} · {formatearPuntos(canje.costoPuntos)} pts
        </p>
        <p className="text-xs text-muted-foreground">{formatearFecha(canje.solicitadoEn)}</p>
      </div>

      {/*
        El stock SÍ se muestra al personal (al cliente nunca), pero SOLO en la
        cola de aprobación: es ahí donde decide. En un canje ya aprobado, la
        unidad está apartada para ESE cliente, y mostrar "Sin stock" haría creer
        al asesor que no puede entregarla.
      */}
      {mostrarStock && canje.stockActual !== null && (
        <Badge variant={canje.stockActual > 0 ? "outline" : "destructive"}>
          {canje.stockActual > 0 ? `${canje.stockActual} en bodega` : "Sin stock"}
        </Badge>
      )}
    </div>
  );
}

function FilaPorAprobar({ canje, puedeAprobar }: { canje: CanjeInterno; puedeAprobar: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();

  function aprobar() {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await aprobarCanje(canje.id);
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo aprobar.");
        return;
      }
      router.refresh();
    });
  }

  function rechazar(motivo: MotivoRechazo) {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await rechazarCanje(canje.id, motivo);
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo rechazar.");
        return;
      }
      router.refresh();
    });
  }

  const sinStock = canje.stockActual !== null && canje.stockActual <= 0;

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <Cabecera canje={canje} mostrarStock />

        {!canje.clienteVerificado && (
          <p className="flex items-start gap-2 text-sm text-warning">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            Cliente sin verificar en el taller. Pide su cédula antes de entregar.
          </p>
        )}

        {sinStock && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <PackageX className="h-4 w-4 shrink-0 mt-0.5" />
            No queda inventario. Recházalo para devolverle los puntos al cliente.
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!puedeAprobar ? (
          <p className="text-xs text-muted-foreground">
            Solo el Jefe de Taller o el Admin aprueban canjes.
          </p>
        ) : rechazando ? (
          <div className="space-y-2">
            <p className="text-sm">¿Por qué se rechaza?</p>
            {(Object.keys(MOTIVOS_RECHAZO) as MotivoRechazo[]).map((motivo) => (
              <Button
                key={motivo}
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={pendiente}
                onClick={() => rechazar(motivo)}
              >
                {etiquetaMotivo(motivo)}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setRechazando(false)} disabled={pendiente}>
              Volver
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRechazando(true)} disabled={pendiente}>
              Rechazar
            </Button>
            <Button onClick={aprobar} className="flex-1" disabled={pendiente || sinStock}>
              {pendiente ? "Aprobando…" : "Aprobar y apartar"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function etiquetaMotivo(motivo: MotivoRechazo): string {
  switch (motivo) {
    case "sin_stock":
      return "No tenemos el premio";
    case "premio_retirado":
      return "El premio salió del catálogo";
    case "cliente_no_verificado":
      return "Falta verificar la cédula del cliente";
    case "otro":
      return "Otro motivo";
  }
}

function FilaPorEntregar({
  canje,
  puedeEntregar,
  puedeAprobar,
}: {
  canje: CanjeInterno;
  puedeEntregar: boolean;
  puedeAprobar: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();

  function entregar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const codigo = String(new FormData(evento.currentTarget).get("codigo_entrega") ?? "");

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await entregarCanje({ canje_id: canje.id, codigo_entrega: codigo });
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo entregar.");
        return;
      }
      router.refresh();
    });
  }

  function cancelar(motivo: MotivoCancelacionAprobado) {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await cancelarCanjeAprobado(canje.id, motivo);
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo cancelar.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <Cabecera canje={canje} mostrarStock={false} />

        {!puedeEntregar ? (
          <p className="text-xs text-muted-foreground">Tu rol no permite entregar premios.</p>
        ) : (
          <form onSubmit={entregar} className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Pídele al cliente el código de retiro que ve en su app.
            </p>
            <div className="flex gap-2">
              <Input
                name="codigo_entrega"
                placeholder="A1B2C3"
                maxLength={6}
                required
                disabled={pendiente}
                className="text-center tracking-[0.3em] font-mono uppercase"
              />
              <Button type="submit" disabled={pendiente}>
                {pendiente ? "…" : "Entregar"}
              </Button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {puedeAprobar &&
          (cancelando ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm">¿Por qué se cancela este canje ya aprobado?</p>
              <p className="text-xs text-muted-foreground">
                Se devuelven los puntos al cliente y la unidad a bodega.
              </p>
              {(Object.keys(MOTIVOS_CANCELACION_APROBADO) as MotivoCancelacionAprobado[]).map(
                (motivo) => (
                  <Button
                    key={motivo}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    disabled={pendiente}
                    onClick={() => cancelar(motivo)}
                  >
                    {etiquetaMotivoCancelacion(motivo)}
                  </Button>
                )
              )}
              <Button variant="ghost" size="sm" onClick={() => setCancelando(false)} disabled={pendiente}>
                Volver
              </Button>
            </div>
          ) : (
            <div className="border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCancelando(true)}
                disabled={pendiente}
              >
                Cancelar canje
              </Button>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function etiquetaMotivoCancelacion(motivo: MotivoCancelacionAprobado): string {
  switch (motivo) {
    case "cliente_no_retiro":
      return "El cliente nunca retiró el premio";
    case "producto_dañado":
      return "El producto se dañó en bodega";
    case "otro":
      return "Otro motivo";
  }
}
