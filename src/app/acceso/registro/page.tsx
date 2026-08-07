/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSesionCliente } from "@/actions/auth-cliente";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegistroForm } from "./RegistroForm";

export const metadata = {
  title: "Crear cuenta | Recompensas Taller",
};

export default async function RegistroPage() {
  const sesion = await getSesionCliente();
  if (sesion) redirect("/");

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Crea tu cuenta</CardTitle>
          <CardDescription>
            Todavía no estás en el programa. Son cuatro datos y ya empiezas a acumular.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RegistroForm />
          <Link
            href="/acceso"
            className="block text-center text-xs text-muted-foreground underline underline-offset-4"
          >
            Volver
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
