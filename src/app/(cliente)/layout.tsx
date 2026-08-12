/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Gate de la PWA del cliente. Todo lo que cuelgue de este grupo exige sesión.
 * /acceso y /politica-privacidad viven fuera a propósito.
 */

import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { QrCode, Gift, Receipt, Home, User, Ticket } from "lucide-react";
import { getSesionCliente } from "@/actions/auth-cliente";

// Etiquetas cortas a propósito: en un iPhone SE (375px) 6 columnas dejan
// ~62px cada una, y una etiqueta de 9-10 caracteres a 11px se parte en dos
// líneas desiguales frente a las cortas.
const NAVEGACION = [
  { href: "/", label: "Inicio", Icono: Home },
  { href: "/qr", label: "Código", Icono: QrCode },
  { href: "/premios", label: "Premios", Icono: Gift },
  { href: "/canjes", label: "Canjes", Icono: Ticket },
  { href: "/movimientos", label: "Puntos", Icono: Receipt },
  { href: "/cuenta", label: "Cuenta", Icono: User },
];

export default async function ClienteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sesion = await getSesionCliente();
  if (!sesion) redirect("/acceso");

  return (
    <div className="min-h-screen flex flex-col">
      {/*
        La app del cliente antes no mostraba marca en ninguna parte propia
        (solo la barra inferior). Esta franja delgada es lo único que confirma
        "esto es de Grupo Palacios" mientras el cliente navega.
      */}
      <header className="regla-marca border-b border-border bg-card">
        <div className="mx-auto max-w-md px-4 py-2.5 flex items-center">
          {/* h-5, no h-3.5: a 14px de alto el instrumento del logo medía 14px
              y se convertía en una mancha subpíxel. */}
          <Image
            src="/logo-gp-horizontal.svg"
            alt="Grupo Palacios"
            width={110}
            height={11}
            className="h-5 w-auto"
            priority
          />
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-md px-4 py-6 pb-24">{children}</main>

      {/*
        Barra inferior fija: el cliente usa esto de pie en el mostrador, con una
        mano. `pb-[env(safe-area-inset-bottom)]` evita que el indicador de inicio
        del iPhone tape los botones cuando corre instalada en modo standalone.
      */}
      <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-md grid grid-cols-6">
          {NAVEGACION.map(({ href, label, Icono }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-1 py-2.5 text-[11px] whitespace-nowrap text-muted-foreground hover:text-foreground"
            >
              <Icono className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
