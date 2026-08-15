/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Vive fuera del grupo (panel) a propósito, igual que /interno/login: si
 * heredara el layout con el gate de sesión, alguien definiendo su contraseña
 * por primera vez —sin cookie todavía— quedaría en un bucle de redirecciones.
 *
 * El token se verifica AQUÍ, en el servidor, antes de decidir qué pintar: un
 * token vencido o forjado nunca llega a mostrar el formulario.
 */

import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSesionInterna } from "@/actions/auth-interno";
import { verifyPasswordSetupToken } from "@/lib/password-setup.server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DefinirPasswordForm } from "./DefinirPasswordForm";

export const metadata = { title: "Configura tu contraseña | Recompensas Taller" };

export default async function DefinirPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  // Con sesión ya activa este flujo no aplica — evita reutilizar por error un
  // enlace de invitación mientras hay otra cuenta abierta en el navegador.
  const sesion = await getSesionInterna();
  if (sesion) redirect("/interno");

  const { token } = await searchParams;

  let nombre: string | null = null;
  if (token) {
    const payload = await verifyPasswordSetupToken(token);
    if (payload) {
      const [usuario] = await db
        .select({ nombre: users.nombre, activo: users.activo })
        .from(users)
        .where(eq(users.id, payload.userId))
        .limit(1);
      // Una cuenta desactivada entre la invitación y el clic no debe poder
      // completar el alta: el token por sí solo no basta, el usuario tiene
      // que seguir activo.
      if (usuario && usuario.activo) nombre = usuario.nombre;
    }
  }

  const valido = token && nombre !== null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <Image
          src="/logo-gp-horizontal.svg"
          alt="Grupo Palacios"
          width={170}
          height={16}
          className="h-6 w-auto mx-auto"
          priority
        />
        <Card>
          <CardHeader>
            <CardTitle>Configura tu contraseña</CardTitle>
            <CardDescription>
              {valido
                ? `Hola ${nombre}, elige la contraseña con la que vas a entrar al panel del taller.`
                : "Panel interno · Grupo Palacios"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {valido && token ? (
              <DefinirPasswordForm token={token} />
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Este enlace venció o no es válido. Los enlaces de invitación duran 48 horas y solo
                  sirven una vez. No hay autoservicio para esto: pide al administrador que te
                  reenvíe la invitación desde el panel.
                </p>
                <Button
                  render={<Link href="/interno/login" />}
                  nativeButton={false}
                  variant="outline"
                  className="w-full"
                >
                  Ir al acceso
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
