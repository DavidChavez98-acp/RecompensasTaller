/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getSesionInterna } from "@/actions/auth-interno";
import { puedeVerReportes } from "@/lib/authz";
import {
  getAcreditacionesTopadas,
  getClientesSinVerificarConSaldo,
  getConcentracionAsesores,
  getCorreccionesRecientes,
  getResumenGeneral,
  getTopAsesores,
} from "@/actions/reportes";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatearFecha, formatearMonto, formatearPuntos } from "@/lib/utils";

export const metadata = { title: "Reportes | Recompensas Taller" };

/**
 * Umbral a partir del cual la concentración de un asesor merece una mirada.
 * No es una acusación: en un taller chico con clientes recurrentes puede haber
 * falsos positivos. Es una señal para que el Jefe revise.
 */
const UMBRAL_CONCENTRACION = 40;
/** Debajo de esto la muestra es tan pequeña que el porcentaje no dice nada. */
const MINIMO_ACREDITACIONES = 5;

export default async function ReportesPage() {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  if (!puedeVerReportes(sesion)) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Solo el Jefe de Taller y el Admin ven los reportes.
        </CardContent>
      </Card>
    );
  }

  const [resumen, concentracion, topadas, sinVerificar, correcciones, topAsesores] =
    await Promise.all([
      getResumenGeneral(),
      getConcentracionAsesores(),
      getAcreditacionesTopadas(),
      getClientesSinVerificarConSaldo(),
      getCorreccionesRecientes(),
      getTopAsesores(),
    ]);

  const sospechosos = concentracion.filter(
    (a) => a.acreditaciones >= MINIMO_ACREDITACIONES && a.concentracion >= UMBRAL_CONCENTRACION
  );

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="t-titulo">Reportes</h1>
        <p className="text-sm text-muted-foreground">Últimos 30 días.</p>
      </div>

      {/* ── Situación del programa ───────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          titulo="Pasivo en puntos"
          valor={formatearPuntos(resumen?.pasivoPuntos ?? 0)}
          nota="Puntos vivos en manos de clientes"
        />
        <Metrica
          titulo="Emitidos hoy"
          valor={formatearPuntos(resumen?.puntosEmitidosHoy ?? 0)}
          nota={`${resumen?.acreditacionesHoy ?? 0} acreditaciones`}
        />
        <Metrica
          titulo="Emitidos este mes"
          valor={formatearPuntos(resumen?.puntosEmitidosMes ?? 0)}
        />
        <Metrica
          titulo="Clientes"
          valor={String(resumen?.clientesActivos ?? 0)}
          nota={`${resumen?.clientesSinVerificar ?? 0} sin verificar`}
        />
      </section>

      {(resumen?.canjesPendientes ?? 0) + (resumen?.canjesPorEntregar ?? 0) > 0 && (
        <Card>
          <CardContent className="py-3 text-sm">
            <Link href="/interno/canjes" className="text-primary underline underline-offset-4">
              {resumen?.canjesPendientes ?? 0} canje(s) por aprobar y{" "}
              {resumen?.canjesPorEntregar ?? 0} por entregar
            </Link>
          </CardContent>
        </Card>
      )}

      {/* ── Antifraude ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="t-seccion text-muted-foreground">Concentración por asesor</h2>
          <p className="text-sm text-muted-foreground">
            Qué porcentaje de las acreditaciones de cada asesor va a un mismo cliente. Una
            concentración alta no prueba nada por sí sola, pero merece una mirada.
          </p>
        </div>

        {sospechosos.length > 0 && (
          <Card className="border-warning">
            <CardContent className="py-3 flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
              <span>
                {sospechosos.length} asesor(es) por encima del {UMBRAL_CONCENTRACION}% con al menos{" "}
                {MINIMO_ACREDITACIONES} acreditaciones.
              </span>
            </CardContent>
          </Card>
        )}

        {concentracion.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin acreditaciones en el periodo.</p>
        ) : (
          <div className="space-y-2">
            {/*
              Los de muestra pequeña van al final y sin porcentaje: con una sola
              acreditación la concentración es 100% por definición, y mostrarlo
              arriba en rojo convierte el panel en ruido que nadie mira.
            */}
            {[...concentracion]
              .sort((a, b) => {
                const aChica = a.acreditaciones < MINIMO_ACREDITACIONES;
                const bChica = b.acreditaciones < MINIMO_ACREDITACIONES;
                if (aChica !== bChica) return aChica ? 1 : -1;
                return b.concentracion - a.concentracion;
              })
              .map((asesor) => {
                const muestraChica = asesor.acreditaciones < MINIMO_ACREDITACIONES;
                const alerta = !muestraChica && asesor.concentracion >= UMBRAL_CONCENTRACION;

                return (
                  <Card key={asesor.usuarioId} className={alerta ? "border-warning" : undefined}>
                    <CardContent className="py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{asesor.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          {asesor.acreditaciones} acreditaciones a {asesor.clientesDistintos}{" "}
                          cliente(s) · {formatearPuntos(asesor.puntos)} pts
                        </p>
                        {!muestraChica && asesor.clienteConcentrado && (
                          <p className="text-xs text-muted-foreground">
                            Más repetido: {asesor.clienteConcentrado} ({asesor.maxAlMismoCliente}{" "}
                            veces)
                          </p>
                        )}
                      </div>

                      {muestraChica ? (
                        <span className="text-xs text-muted-foreground shrink-0">
                          muestra pequeña
                        </span>
                      ) : (
                        <Badge variant={alerta ? "destructive" : "outline"}>
                          {asesor.concentracion}%
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}
      </section>

      {/* ── Acreditaciones topadas ───────────────────────────────────────── */}
      {topadas.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="t-seccion text-muted-foreground">Acreditaciones recortadas por el tope</h2>
            <p className="text-sm text-muted-foreground">
              Casi siempre un dedazo en el monto. El tope las recortó, pero conviene revisarlas.
            </p>
          </div>

          <div className="space-y-2">
            {topadas.map((fila) => (
              <Card key={fila.id}>
                <CardContent className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm">{fila.clienteNombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {fila.asesorNombre ?? "—"} · {formatearFecha(fila.fecha)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm tabular-nums">
                      {fila.monto ? formatearMonto(fila.monto) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      +{formatearPuntos(fila.puntos)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ── Clientes sin verificar con saldo ─────────────────────────────── */}
      {sinVerificar.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="t-seccion text-muted-foreground">Sin verificar, con saldo</h2>
            <p className="text-sm text-muted-foreground">
              El auto-registro prueba el correo, no la identidad. Pídeles la cédula en su próxima
              visita.
            </p>
          </div>

          <div className="space-y-2">
            {sinVerificar.map((cliente) => (
              <Card key={cliente.id}>
                <CardContent className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/interno/clientes/${cliente.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {cliente.nombres}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Desde {formatearFecha(cliente.fechaCreacion)}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums shrink-0">
                    {formatearPuntos(cliente.saldo)} pts
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ── Actividad ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="t-seccion text-muted-foreground">Actividad del equipo</h2>
        {topAsesores.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividad en el periodo.</p>
        ) : (
          <div className="space-y-2">
            {topAsesores.map((asesor) => (
              <Card key={asesor.nombre}>
                <CardContent className="py-3 flex items-center justify-between gap-4">
                  <p className="text-sm">{asesor.nombre}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {asesor.acreditaciones} · {formatearPuntos(asesor.puntos)} pts
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Correcciones ─────────────────────────────────────────────────── */}
      {correcciones.length > 0 && (
        <section className="space-y-3">
          <h2 className="t-seccion text-muted-foreground">Reversos y ajustes</h2>
          <div className="space-y-2">
            {correcciones.map((fila) => (
              <Card key={fila.id}>
                <CardContent className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {fila.clienteNombre} ·{" "}
                      <span className="text-muted-foreground">{fila.tipo}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fila.actor ?? "—"} · {formatearFecha(fila.fecha)}
                    </p>
                    {fila.motivo && (
                      <p className="text-xs text-muted-foreground italic">{fila.motivo}</p>
                    )}
                  </div>
                  <span className="text-sm tabular-nums shrink-0">
                    {fila.puntos >= 0 ? "+" : "−"}
                    {formatearPuntos(Math.abs(fila.puntos))}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Metrica({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className="text-2xl font-semibold tabular-nums">{valor}</p>
        {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
      </CardContent>
    </Card>
  );
}
