/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Gate de la PWA del cliente. Todo lo que cuelgue de este grupo exige sesión.
 * /acceso y /politica-privacidad viven fuera a propósito.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { QrCode, Gift, Receipt, Home, User, Ticket } from "lucide-react";
import { getSesionCliente } from "@/actions/auth-cliente";

const NAVEGACION = [
  { href: "/", label: "Inicio", Icono: Home },
  { href: "/qr", label: "Mi código", Icono: QrCode },
  { href: "/premios", label: "Premios", Icono: Gift },
  { href: "/canjes", label: "Mis canjes", Icono: Ticket },
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
              className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground hover:text-foreground"
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
