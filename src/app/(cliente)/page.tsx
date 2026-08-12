/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Home de la PWA.
 *
 * Antes era un único número dentro de una tarjeta. El problema no era estético:
 * el saldo solo cambia cuando el cliente lleva el carro al taller, o sea unas
 * tres veces al año, así que entre visitas la pantalla era IDÉNTICA cada vez
 * que se abría. No había nada que mirar.
 *
 * Ahora responde tres preguntas que sí cambian: cuánto me falta para el
 * siguiente premio, qué fue lo último que pasó con mis puntos, y cuándo fue mi
 * última visita.
 *
 * Cuidado con el N+1: son tres lecturas en una sola tanda, no una por fila.
 */

import Link from "next/link";
import { QrCode } from "lucide-react";
import { getSesionCliente } from "@/actions/auth-cliente";
import { listarCatalogo } from "@/actions/premios";
import { listarMisMovimientos } from "@/actions/puntos";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dato } from "@/components/ui/dato";
import { Medidor } from "@/components/ui/medidor";
import { formatearFecha, formatearPuntos } from "@/lib/utils";

export const metadata = {
  title: "Mis puntos | Recompensas Taller",
};

export default async function ClienteHome() {
  // El layout ya garantiza que existe; React `cache()` deduplica la consulta.
  const sesion = await getSesionCliente();
  if (!sesion) return null;

  const [catalogo, movimientos] = await Promise.all([
    listarCatalogo(),
    listarMisMovimientos(3),
  ]);

  /*
   * El premio alcanzable más caro, o —si no alcanza ninguno— el más barato de
   * los que faltan. Las dos respuestas son útiles y son distintas: "ya puedes
   * pedir esto" motiva de forma distinta a "te faltan 120 puntos".
   */
  const disponibles = catalogo.filter((p) => p.disponible);
  const yaAlcanza = disponibles
    .filter((p) => p.costoPuntos <= sesion.saldo)
    .sort((a, b) => b.costoPuntos - a.costoPuntos)[0];
  const siguiente = disponibles
    .filter((p) => p.costoPuntos > sesion.saldo)
    .sort((a, b) => a.costoPuntos - b.costoPuntos)[0];

  const ultimo = movimientos[0];
  const ultimaAcreditacion = movimientos.find((m) => m.tipo === "acreditacion");

  // El isotipo de Grupo Palacios es un velocímetro: mide algo. Con un premio
  // en el catálogo, el saldo se dibuja como avance hacia él, no solo se
  // escribe. Sin catálogo no hay contra qué medir, y se cae al número plano.
  const metaMedidor = siguiente?.costoPuntos ?? yaAlcanza?.costoPuntos ?? null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">Hola,</p>
        <h1 className="t-titulo">{sesion.nombres.split(" ")[0]}</h1>
      </div>

      <Card>
        <CardContent className="py-8 flex flex-col items-center text-center">
          {metaMedidor ? (
            <Medidor
              valor={sesion.saldo}
              meta={metaMedidor}
              etiqueta="Tus puntos"
              unidad="pts"
            />
          ) : (
            <Dato
              etiqueta="Tus puntos"
              valor={formatearPuntos(sesion.saldo)}
              tamano="hero"
              protagonista
              className="flex flex-col items-center"
            />
          )}
          {ultimaAcreditacion && (
            <p className="t-micro text-muted-foreground mt-3">
              Última visita: {formatearFecha(ultimaAcreditacion.fecha)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Lo que se puede hacer con esos puntos, ahora mismo ── */}
      {yaAlcanza ? (
        <Card className="border-success">
          <CardContent className="py-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="t-etiqueta text-muted-foreground">Ya puedes pedir</p>
              <p className="text-sm font-medium truncate">{yaAlcanza.nombre}</p>
              <p className="t-micro text-muted-foreground">
                {formatearPuntos(yaAlcanza.costoPuntos)} puntos
              </p>
            </div>
            <Button
              render={<Link href="/premios" />}
              nativeButton={false}
              variant="outline"
              className="shrink-0"
            >
              Ver premios
            </Button>
          </CardContent>
        </Card>
      ) : siguiente ? (
        <Card>
          <CardContent className="py-4 space-y-2">
            <p className="t-etiqueta text-muted-foreground">Tu próximo premio</p>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium truncate">{siguiente.nombre}</p>
              <p className="text-sm tabular-nums shrink-0">
                te faltan{" "}
                <span className="font-semibold">
                  {formatearPuntos(siguiente.costoPuntos - sesion.saldo)}
                </span>
              </p>
            </div>
            {/* Barra de avance: el mismo dato, pero posicional en vez de plano. */}
            <div
              className="h-1.5 w-full bg-secondary"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={siguiente.costoPuntos}
              aria-valuenow={sesion.saldo}
              aria-label={`Avance hacia ${siguiente.nombre}`}
            >
              <div
                className="h-full bg-primary"
                style={{
                  width: `${Math.min(100, Math.round((sesion.saldo / siguiente.costoPuntos) * 100))}%`,
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/*
        Base UI usa `render` en vez del `asChild` de Radix. `nativeButton={false}`
        es obligatorio al renderizar un <a>: sin él, Base UI aplica semántica de
        <button> nativo sobre un enlace y avisa de que rompe formularios y
        accesibilidad.
      */}
      <Button render={<Link href="/qr" />} nativeButton={false} className="w-full h-14 text-base">
        <QrCode className="h-5 w-5" />
        Mostrar mi código
      </Button>

      {!sesion.verificado && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Tu cuenta aún no ha sido verificada en el taller. En tu próxima visita muestra
            tu cédula al asesor para activarla del todo.
          </CardContent>
        </Card>
      )}

      {/* ── Lo último que pasó: la app cambia entre visitas ── */}
      {ultimo && (
        <section className="space-y-2">
          <h2 className="t-seccion text-muted-foreground">Último movimiento</h2>
          <Card>
            <CardContent className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm truncate">
                  {ultimo.servicio ?? ultimo.motivo ?? "Movimiento"}
                </p>
                <p className="t-micro text-muted-foreground">{formatearFecha(ultimo.fecha)}</p>
              </div>
              <span
                className={`text-sm font-medium tabular-nums shrink-0 ${
                  ultimo.puntos >= 0 ? "text-success" : "text-foreground"
                }`}
              >
                {ultimo.puntos >= 0 ? "+" : "−"}
                {formatearPuntos(Math.abs(ultimo.puntos))}
              </span>
            </CardContent>
          </Card>
          <Link
            href="/movimientos"
            className="t-micro text-muted-foreground hover:underline inline-block"
          >
            Ver todo mi historial
          </Link>
        </section>
      )}

      {/* Solo para quien todavía no tiene nada que mirar. */}
      {!ultimo && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Cómo funciona</p>
            <p>
              Muestra tu código al asesor cuando dejes o retires tu vehículo. Él lo escanea y
              tus puntos se acreditan según el servicio y el monto.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
