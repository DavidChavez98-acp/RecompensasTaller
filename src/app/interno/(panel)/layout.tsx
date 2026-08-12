/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Gate del panel interno. Todo lo que cuelgue de /interno exige sesión, salvo
 * /interno/login que tiene su propio layout aislado.
 */

import { redirect } from "next/navigation";
import { after } from "next/server";
import Image from "next/image";
import Link from "next/link";
import { getSesionInterna, logout } from "@/actions/auth-interno";
import { ejecutarMantenimiento } from "@/lib/log-retention";
import {
  puedeAcreditarPuntos,
  puedeAprobarCanje,
  puedeEntregarCanje,
  puedeGestionarInventario,
  puedeGestionarPremios,
  puedeGestionarReglas,
  puedeGestionarUsuarios,
  puedeRegistrarSalidaInventario,
  puedeVerReportes,
} from "@/lib/authz";
import { Button } from "@/components/ui/button";

export default async function InternoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sesion = await getSesionInterna();
  if (!sesion) redirect("/interno/login");

  /*
   * Mantenimiento diario sin cron: `after()` lo ejecuta DESPUÉS de responder,
   * así que no añade un milisegundo a lo que espera el asesor. El throttle
   * global (una fila en `settings`) hace que corra una vez cada 20 horas por
   * más veces que alguien abra el panel.
   */
  after(async () => {
    try {
      await ejecutarMantenimiento();
    } catch (error) {
      console.error("[MANTENIMIENTO] no pudo ejecutarse:", (error as Error)?.message);
    }
  });

  /*
   * Taller y marketing son dominios que no se cruzan (ver AGENTS.md): un
   * Jefe de Marketing no tiene NINGUNO de los predicados de taller, así que
   * antes de este chequeo el menú le mostraba "Escanear", "Clientes" y
   * "Canjes" — tres enlaces a pantallas donde no puede hacer nada.
   */
  const puedeTaller = puedeAcreditarPuntos(sesion) || puedeAprobarCanje(sesion) || puedeEntregarCanje(sesion);

  const enlaces = [
    { href: "/interno", label: "Inicio", visible: true },
    { href: "/interno/escanear", label: "Escanear", visible: puedeAcreditarPuntos(sesion) },
    { href: "/interno/clientes", label: "Clientes", visible: puedeTaller },
    { href: "/interno/canjes", label: "Canjes", visible: puedeAprobarCanje(sesion) || puedeEntregarCanje(sesion) },
    { href: "/interno/premios", label: "Premios", visible: puedeGestionarPremios(sesion) },
    {
      href: "/interno/inventario",
      label: "Inventario",
      visible: puedeGestionarInventario(sesion) || puedeRegistrarSalidaInventario(sesion),
    },
    { href: "/interno/reglas", label: "Reglas", visible: puedeGestionarReglas(sesion) },
    { href: "/interno/reportes", label: "Reportes", visible: puedeVerReportes(sesion) },
    { href: "/interno/usuarios", label: "Usuarios", visible: puedeGestionarUsuarios(sesion) },
  ].filter((e) => e.visible);

  async function cerrarSesion() {
    "use server";
    await logout();
    redirect("/interno/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Regla institucional: la única presencia constante de la marca, sin un
          píxel de relleno rojo, sin gradiente y sin sombra. */}
      <header className="regla-marca bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        {/*
          Dos filas por debajo de `lg`, una sola a partir de ahí.

          En una sola fila con la marca a la izquierda y el usuario a la
          derecha, la navegación se queda con lo que sobra: a 310px eran 18
          píxeles visibles para 612 de enlaces. Bajar la navegación a su propia
          fila le da el ancho completo, y ahí el scroll horizontal sí sirve.
        */}
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <Link href="/interno" className="flex items-center gap-3 shrink-0">
              {/*
                Variante blanca del logotipo que CONSERVA el rojo del logotipo
                "GRUPO". Antes se resolvía con `brightness-0 invert` sobre el
                SVG normal, que deja la marca en blanco puro: el panel interno
                no tenía ni un píxel de color institucional.

                Tampoco lleva ya `hidden sm:block`: en una tableta en vertical
                (<640px), que es exactamente el equipo del mostrador, el panel
                se quedaba sin logo.
              */}
              <Image
                src="/logo-gp-horizontal-blanco.svg"
                alt="Grupo Palacios"
                width={120}
                height={12}
                className="h-4 w-auto"
              />
              {/* El logo ya identifica la empresa; por debajo de `sm` este
                  rótulo solo compite por espacio con la navegación y el botón
                  de salir, y se solapaba con ellos en tableta vertical. */}
              <span className="font-semibold whitespace-nowrap hidden sm:inline">
                Recompensas <span className="text-sidebar-primary">Taller</span>
              </span>
            </Link>
            <nav className="hidden lg:flex items-center gap-1 min-w-0 overflow-x-auto">
              {enlaces.map((enlace) => (
                <Link
                  key={enlace.href}
                  href={enlace.href}
                  className="px-3 py-1.5 text-sm rounded-sm hover:bg-sidebar-accent whitespace-nowrap"
                >
                  {enlace.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-sm leading-tight">{sesion.nombre}</p>
              <p className="text-xs text-sidebar-foreground/60 leading-tight">{sesion.role}</p>
            </div>
            <form action={cerrarSesion}>
              <Button type="submit" variant="ghost" size="sm">
                Salir
              </Button>
            </form>
          </div>
        </div>

        {/* Segunda fila: la navegación a ancho completo mientras no quepa arriba. */}
        <nav className="lg:hidden mx-auto max-w-7xl px-2 pb-2 flex items-center gap-1 overflow-x-auto">
          {enlaces.map((enlace) => (
            <Link
              key={enlace.href}
              href={enlace.href}
              className="px-3 py-1.5 text-sm rounded-sm hover:bg-sidebar-accent whitespace-nowrap"
            >
              {enlace.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
