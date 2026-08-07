/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  actualizarServicio,
  publicarRegla,
  type ReglaHistorica,
  type ReglaVigente,
  type ServicioAdmin,
} from "@/actions/reglas";
import { calcularPuntos, type ReglaCalculo } from "@/lib/puntos-calculo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearFecha, formatearMonto, formatearPuntos } from "@/lib/utils";

/** Montos típicos de un taller, para que el admin vea el efecto real. */
const MONTOS_MUESTRA = [50, 150, 400, 1200];

export function EditorReglas({
  reglaVigente,
  historial,
  servicios,
}: {
  reglaVigente: ReglaVigente | null;
  historial: ReglaHistorica[];
  servicios: ServicioAdmin[];
}) {
  return (
    <div className="space-y-8">
      <FormularioRegla reglaVigente={reglaVigente} servicios={servicios} />
      <Multiplicadores servicios={servicios} />
      <Historial historial={historial} />
    </div>
  );
}

function FormularioRegla({
  reglaVigente,
  servicios,
}: {
  reglaVigente: ReglaVigente | null;
  servicios: ServicioAdmin[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  // Estado local solo para el simulador: así el admin ve el efecto ANTES de
  // publicar, no después de que el primer cliente reclame.
  const [montoBase, setMontoBase] = useState(reglaVigente?.montoBase ?? "10.00");
  const [puntosPorBase, setPuntosPorBase] = useState(String(reglaVigente?.puntosPorBase ?? 1));
  const [redondeo, setRedondeo] = useState(reglaVigente?.redondeo ?? "abajo");
  const [montoMinimo, setMontoMinimo] = useState(reglaVigente?.montoMinimo ?? "0");
  const [tope, setTope] = useState(
    reglaVigente?.puntosMaximosTransaccion != null
      ? String(reglaVigente.puntosMaximosTransaccion)
      : ""
  );

  const simulada: ReglaCalculo = useMemo(
    () => ({
      montoBase: Number(montoBase) || 0,
      puntosPorBase: Number(puntosPorBase) || 0,
      redondeo: redondeo === "cercano" ? "cercano" : "abajo",
      montoMinimo: Number(montoMinimo) || 0,
      puntosMaximosTransaccion: tope.trim() === "" ? null : Number(tope),
    }),
    [montoBase, puntosPorBase, redondeo, montoMinimo, tope]
  );

  const multiplicadorMuestra = Number(servicios[0]?.multiplicador ?? 1) || 1;

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await publicarRegla({
        nombre: String(datos.get("nombre") ?? ""),
        monto_base: Number(montoBase),
        puntos_por_base: Number(puntosPorBase),
        redondeo: redondeo as "abajo" | "cercano",
        monto_minimo: Number(montoMinimo),
        puntos_maximos_transaccion: tope.trim() === "" ? null : Number(tope),
      });

      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo publicar.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">Regla vigente</h2>
        {reglaVigente ? (
          <p className="text-sm text-muted-foreground">
            {reglaVigente.puntosPorBase} punto{reglaVigente.puntosPorBase === 1 ? "" : "s"} por cada{" "}
            {formatearMonto(reglaVigente.montoBase)} · desde{" "}
            {formatearFecha(reglaVigente.vigenteDesde)}
            {reglaVigente.creadoPor ? ` · ${reglaVigente.creadoPor}` : ""}
          </p>
        ) : (
          <p className="text-sm text-destructive">
            No hay ninguna regla vigente. Sin ella, el taller no puede acreditar puntos.
          </p>
        )}
      </div>

      <Card>
        <CardContent className="py-4">
          <form onSubmit={enviar} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="nombre">Nombre de la regla</Label>
              <Input
                id="nombre"
                name="nombre"
                defaultValue={`Regla ${new Date().getFullYear()}`}
                required
                disabled={pendiente}
              />
              <p className="text-xs text-muted-foreground">
                Para reconocerla en el historial. Ej: &ldquo;Promoción fin de año&rdquo;.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="puntos_por_base">Puntos</Label>
                <Input
                  id="puntos_por_base"
                  type="number"
                  min={1}
                  value={puntosPorBase}
                  onChange={(e) => setPuntosPorBase(e.target.value)}
                  required
                  disabled={pendiente}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="monto_base">Por cada ($)</Label>
                <Input
                  id="monto_base"
                  type="number"
                  step="0.01"
                  min={0.01}
                  value={montoBase}
                  onChange={(e) => setMontoBase(e.target.value)}
                  required
                  disabled={pendiente}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="monto_minimo">Monto mínimo ($)</Label>
                <Input
                  id="monto_minimo"
                  type="number"
                  step="0.01"
                  min={0}
                  value={montoMinimo}
                  onChange={(e) => setMontoMinimo(e.target.value)}
                  disabled={pendiente}
                />
                <p className="text-xs text-muted-foreground">Por debajo, no se acredita nada.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="tope">Tope por transacción</Label>
                <Input
                  id="tope"
                  type="number"
                  min={1}
                  value={tope}
                  onChange={(e) => setTope(e.target.value)}
                  placeholder="sin tope"
                  disabled={pendiente}
                />
                <p className="text-xs text-muted-foreground">
                  Frena un dedazo del asesor en el monto.
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="redondeo">Redondeo</Label>
              <select
                id="redondeo"
                value={redondeo}
                onChange={(e) => setRedondeo(e.target.value)}
                disabled={pendiente}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm"
              >
                <option value="abajo">Hacia abajo (no regala puntos)</option>
                <option value="cercano">Al más cercano</option>
              </select>
            </div>

            {/* Simulador: el efecto de la regla ANTES de publicarla. */}
            <div className="border border-border p-3 space-y-2">
              <p className="text-xs font-medium">Con esta regla, un servicio de:</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {MONTOS_MUESTRA.map((monto) => {
                  const resultado = calcularPuntos(monto, simulada, multiplicadorMuestra);
                  return (
                    <p key={monto} className="text-sm tabular-nums">
                      {formatearMonto(monto)} →{" "}
                      <span className="font-medium">
                        {formatearPuntos(resultado.puntos)} pts
                      </span>
                      {resultado.topeAplicado && (
                        <span className="text-xs text-warning"> (topado)</span>
                      )}
                    </p>
                  );
                })}
              </div>
              {servicios[0] && Number(servicios[0].multiplicador) !== 1 && (
                <p className="text-xs text-muted-foreground">
                  Calculado con {servicios[0].nombre} (×{Number(servicios[0].multiplicador)}).
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Publicar crea una regla nueva y cierra la anterior. Las acreditaciones ya hechas
              conservan la regla con la que se calcularon.
            </p>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={pendiente}>
              {pendiente ? "Publicando…" : "Publicar regla nueva"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

function Multiplicadores({ servicios }: { servicios: ServicioAdmin[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">Multiplicadores por servicio</h2>
        <p className="text-sm text-muted-foreground">
          Cuánto pesa cada tipo de trabajo sobre la regla base.
        </p>
      </div>

      <div className="space-y-2">
        {servicios.map((servicio) => (
          <FilaServicio key={servicio.id} servicio={servicio} />
        ))}
      </div>
    </section>
  );
}

function FilaServicio({ servicio }: { servicio: ServicioAdmin }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function guardar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await actualizarServicio({
        id: servicio.id,
        nombre: String(datos.get("nombre") ?? ""),
        multiplicador: Number(datos.get("multiplicador")),
        activo: datos.get("activo") === "on",
      });

      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo guardar.");
        return;
      }
      setEditando(false);
      router.refresh();
    });
  }

  if (!editando) {
    return (
      <Card>
        <CardContent className="py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{servicio.nombre}</p>
              {!servicio.activo && <Badge variant="secondary">Inactivo</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">{servicio.codigo}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm tabular-nums">×{Number(servicio.multiplicador)}</span>
            <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
              Editar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-3">
        <form onSubmit={guardar} className="space-y-3">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="space-y-1">
              <Label htmlFor={`nombre-${servicio.id}`}>Nombre</Label>
              <Input
                id={`nombre-${servicio.id}`}
                name="nombre"
                defaultValue={servicio.nombre}
                required
                disabled={pendiente}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`mult-${servicio.id}`}>Multiplicador</Label>
              <Input
                id={`mult-${servicio.id}`}
                name="multiplicador"
                type="number"
                step="0.001"
                min={0.001}
                max={10}
                defaultValue={Number(servicio.multiplicador)}
                required
                disabled={pendiente}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="activo"
              defaultChecked={servicio.activo}
              disabled={pendiente}
            />
            Disponible para el asesor al acreditar
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(false)} disabled={pendiente}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={pendiente}>
              {pendiente ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Historial({ historial }: { historial: ReglaHistorica[] }) {
  if (historial.length <= 1) return null;

  return (
    <section className="space-y-3">
      <h2 className="font-medium">Historial de reglas</h2>
      <p className="text-sm text-muted-foreground">
        Las acreditaciones antiguas siguen apuntando a la regla con la que se calcularon.
      </p>

      <div className="space-y-2">
        {historial.map((regla) => (
          <Card key={regla.id}>
            <CardContent className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{regla.nombre}</p>
                  {regla.vigenteHasta === null && <Badge>Vigente</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {regla.puntosPorBase} pts por {formatearMonto(regla.montoBase)} ·{" "}
                  {formatearFecha(regla.vigenteDesde)}
                  {regla.vigenteHasta ? ` — ${formatearFecha(regla.vigenteHasta)}` : ""}
                </p>
              </div>
              {regla.creadoPor && (
                <span className="text-xs text-muted-foreground shrink-0">{regla.creadoPor}</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
