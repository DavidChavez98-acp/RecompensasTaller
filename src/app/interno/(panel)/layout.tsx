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
import Link from "next/link";
import { getSesionInterna, logout } from "@/actions/auth-interno";
import { ejecutarMantenimiento } from "@/lib/log-retention";
import { puedeGestionarPremios, puedeGestionarReglas, puedeGestionarUsuarios, puedeVerReportes } from "@/lib/authz";
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

  const enlaces = [
    { href: "/interno", label: "Inicio", visible: true },
    { href: "/interno/escanear", label: "Escanear", visible: true },
    { href: "/interno/clientes", label: "Clientes", visible: true },
    { href: "/interno/canjes", label: "Canjes", visible: true },
    { href: "/interno/premios", label: "Premios", visible: puedeGestionarPremios(sesion) },
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
      <header className="bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <span className="font-semibold whitespace-nowrap">
              Recompensas <span className="text-sidebar-primary">Taller</span>
            </span>
            <nav className="flex items-center gap-1 overflow-x-auto">
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
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
