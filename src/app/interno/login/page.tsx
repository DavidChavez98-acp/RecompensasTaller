/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Vive fuera del grupo (panel) a propósito: si heredara el layout con el gate
 * de sesión, entrar sin cookie redirigiría aquí en bucle infinito.
 */

import Image from "next/image";
import { redirect } from "next/navigation";
import { getSesionInterna } from "@/actions/auth-interno";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Acceso al panel | Recompensas Taller",
};

export default async function LoginPage() {
  const sesion = await getSesionInterna();
  if (sesion) redirect("/interno");

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
            <CardTitle>Panel del taller</CardTitle>
            <CardDescription>Acceso solo para personal de Grupo Palacios.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
