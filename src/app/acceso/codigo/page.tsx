/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getFlujoAcceso, getSesionCliente } from "@/actions/auth-cliente";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodigoOtpForm } from "./CodigoOtpForm";

export const metadata = {
  title: "Código de acceso | Recompensas Taller",
};

export default async function CodigoPage() {
  const sesion = await getSesionCliente();
  if (sesion) redirect("/");

  // Sin cookie de flujo no hay código pendiente: llegar aquí de frente no
  // debe mostrar un formulario que nunca podría validar nada.
  const flujo = await getFlujoAcceso();
  if (!flujo) redirect("/acceso");

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Revisa tu correo</CardTitle>
          <CardDescription>
            Enviamos un código a <span className="font-medium text-foreground">{flujo.destinoMasked}</span>.
            Vence en 10 minutos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodigoOtpForm />
          <Link
            href="/acceso"
            className="block text-center text-xs text-muted-foreground underline underline-offset-4"
          >
            Usar otra cédula
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
