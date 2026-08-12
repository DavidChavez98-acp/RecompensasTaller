/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * El panel del día.
 *
 * Durante los hitos 1-6 esta pantalla fueron tres tarjetas de texto fijo, con
 * un comentario que decía que "las métricas llegan con el ledger y los
 * reportes". Los dos hitos se terminaron y nadie volvió aquí: el resultado era
 * un menú disfrazado de panel, y es lo primero que ve cualquiera al entrar.
 *
 * Lo que se muestra depende del rol, y NO por cosmética: `getResumenGeneral()`
 * comprueba `puedeVerReportes` por su cuenta y devuelve null si el rol no
 * alcanza.
 *
 * ── Taller y marketing son dominios que no se cruzan ──
 * Antes de este archivo distinguir por dominio, un Jefe de Marketing veía "Tu
 * jornada" con acreditaciones y puntos —cero de eso es suyo— y el subtítulo le
 * decía "puedes acreditar puntos", que es falso para su rol. Admin ve los dos
 * dominios porque administra los dos sistemas; el resto ve solo el suyo.
 */

import Link from "next/link";
import { getSesionInterna } from "@/actions/auth-interno";
import {
  puedeAcreditarPuntos,
  puedeAprobarCanje,
  puedeGestionarInventario,
  puedeGestionarPremios,
  puedeRegistrarSalidaInventario,
  puedeVerReportes,
} from "@/lib/authz";
import { getResumenGeneral } from "@/actions/reportes";
import { getAcreditacionesRecientes, getResumenDelDia } from "@/actions/puntos";
import { Card, CardContent } from "@/components/ui/card";
import { Dato } from "@/components/ui/dato";
import { formatearMonto, formatearPuntos } from "@/lib/utils";

export const metadata = {
  title: "Inicio | Recompensas Taller",
};

export default async function PanelInicio() {
  // El layout ya garantiza que existe; se relee aquí para el saludo y las
  // capacidades (React `cache()` lo deduplica, no hay consulta extra).
  const sesion = await getSesionInterna();
  if (!sesion) return null;

  const esMando = puedeVerReportes(sesion);
  const esTaller = puedeAcreditarPuntos(sesion) || puedeAprobarCanje(sesion);

  // Una sola tanda: nunca una consulta por tarjeta. Las de taller se piden
  // igual para Admin (ve los dos dominios), pero se saltan para marketing puro.
  const [resumen, delDia, recientes] = await Promise.all([
    esMando ? getResumenGeneral() : Promise.resolve(null),
    esTaller ? getResumenDelDia() : Promise.resolve({ acreditaciones: 0, puntos: 0 }),
    esTaller ? getAcreditacionesRecientes(5) : Promise.resolve([]),
  ]);

  const subtitulo = puedeAprobarCanje(sesion)
    ? "Tienes permiso para aprobar y rechazar canjes."
    : puedeAcreditarPuntos(sesion)
      ? "Puedes acreditar puntos y entregar los canjes ya aprobados."
      : puedeGestionarPremios(sesion)
        ? "Gestionas el catálogo de premios y el inventario de marketing."
        : puedeRegistrarSalidaInventario(sesion)
          ? "Puedes registrar salidas de inventario."
          : "";

  const accesos = [
    { href: "/interno/escanear", titulo: "Escanear cliente", visible: puedeAcreditarPuntos(sesion) },
    { href: "/interno/canjes", titulo: "Canjes", visible: puedeAprobarCanje(sesion) },
    { href: "/interno/clientes", titulo: "Clientes", visible: esTaller },
    { href: "/interno/reportes", titulo: "Reportes", visible: esMando },
    { href: "/interno/premios", titulo: "Premios", visible: puedeGestionarPremios(sesion) },
    {
      href: "/interno/inventario",
      titulo: "Inventario",
      visible: puedeGestionarInventario(sesion) || puedeRegistrarSalidaInventario(sesion),
    },
  ].filter((a) => a.visible);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="t-titulo">Hola, {sesion.nombre.split(" ")[0]}</h1>
        {subtitulo && <p className="text-sm text-muted-foreground">{subtitulo}</p>}
      </div>

      {/* ── Tu jornada: solo taller (Admin la ve porque administra los dos dominios) ── */}
      {esTaller && (
        <section className="space-y-3">
          <h2 className="t-seccion text-muted-foreground">Tu jornada</h2>
          <Card>
            <CardContent className="py-5 grid grid-cols-2 gap-6 sm:grid-cols-3">
              <Dato
                etiqueta="Acreditaciones hoy"
                valor={delDia.acreditaciones}
                protagonista
              />
              <Dato
                etiqueta="Puntos que diste"
                valor={formatearPuntos(delDia.puntos)}
                unidad="pts"
              />
              {resumen && (
                <Dato etiqueta="Canjes por atender" valor={resumen.canjesPendientes} />
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Estado del programa: solo Admin y Jefe de Taller ── */}
      {resumen && (
        <section className="space-y-3">
          <h2 className="t-seccion text-muted-foreground">Estado del programa</h2>
          <Card>
            <CardContent className="py-5 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Dato
                etiqueta="Pasivo en puntos"
                valor={formatearPuntos(resumen.pasivoPuntos)}
                unidad="pts"
                nota="Lo que el programa debe a los clientes"
              />
              <Dato
                etiqueta="Clientes activos"
                valor={resumen.clientesActivos}
                nota={
                  resumen.clientesSinVerificar > 0
                    ? `${resumen.clientesSinVerificar} sin verificar`
                    : "Todos verificados"
                }
              />
              <Dato
                etiqueta="Emitidos este mes"
                valor={formatearPuntos(resumen.puntosEmitidosMes)}
                unidad="pts"
              />
              <Dato
                etiqueta="Por entregar"
                valor={resumen.canjesPorEntregar}
                nota="Aprobados, esperando al cliente"
              />
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Lo último que hiciste: cierra el bucle de "¿se guardó?" ── */}
      {esTaller && recientes.length > 0 && (
        <section className="space-y-3">
          <h2 className="t-seccion text-muted-foreground">Tus últimas acreditaciones</h2>
          <Card>
            <CardContent className="py-1 divide-y divide-border">
              {recientes.map((mov) => (
                <div key={mov.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{mov.clienteNombre}</p>
                    <p className="t-micro text-muted-foreground">
                      {mov.servicio ?? "—"}
                      {mov.monto ? ` · ${formatearMonto(mov.monto)}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular-nums shrink-0 text-success">
                    +{formatearPuntos(mov.puntos)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {accesos.length > 0 && (
        <section className="space-y-3">
          <h2 className="t-seccion text-muted-foreground">Ir a</h2>
          <div className="flex flex-wrap gap-2">
            {accesos.map((acceso) => (
              <Link
                key={acceso.href}
                href={acceso.href}
                className="border border-border bg-card px-4 py-2.5 text-sm hover:border-primary"
              >
                {acceso.titulo}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
