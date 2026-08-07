/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * ⚠️ BORRADOR TÉCNICO — PENDIENTE DE REVISIÓN LEGAL
 *
 * Este texto describe con exactitud lo que el sistema hace hoy (qué datos
 * guarda, cómo los cifra, cuánto los retiene), pero NO ha sido redactado ni
 * revisado por el estudio jurídico de Grupo Palacios.
 *
 * En "solicitud credito" el texto legal lo redactó el estudio y la regla es no
 * cambiarle ni una línea. Aquí todavía no hay texto entregado, así que esto es
 * un borrador para no bloquear el desarrollo. ANTES DE SALIR A PRODUCCIÓN hay
 * que reemplazarlo por la versión del estudio y subir POLITICA_VERSION en
 * src/lib/constants.ts — el consentimiento de cada cliente guarda esa versión,
 * así que cambiar el texto sin subir la versión rompe la trazabilidad.
 */

import Link from "next/link";
import { POLITICA_VERSION } from "@/lib/constants";

export const metadata = {
  title: "Política de tratamiento de datos | Recompensas Taller",
};

export default function PoliticaPrivacidadPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Política de tratamiento de datos personales</h1>
        <p className="text-sm text-muted-foreground">
          Programa Recompensas Taller · Grupo Palacios · Versión {POLITICA_VERSION}
        </p>
      </div>

      <div className="border border-warning/40 bg-warning/5 p-4 text-sm">
        <p className="font-medium">Borrador pendiente de revisión legal</p>
        <p className="text-muted-foreground">
          Este texto describe el funcionamiento real del sistema, pero aún no ha sido
          revisado por el área legal. No debe publicarse así.
        </p>
      </div>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold">Responsable del tratamiento</h2>
        <p className="text-muted-foreground">
          Grupo Palacios, con domicilio en Ambato, Ecuador, es responsable del tratamiento
          de los datos que recoge este programa de recompensas.
        </p>

        <h2 className="text-base font-semibold pt-2">Qué datos recogemos</h2>
        <ul className="list-disc pl-5 text-muted-foreground space-y-1">
          <li>Cédula o RUC, nombres y apellidos.</li>
          <li>Correo electrónico y, si lo entregas, número de celular.</li>
          <li>Historial de servicios realizados en el taller, con su monto y sus puntos.</li>
          <li>Canjes solicitados y entregados.</li>
          <li>Fecha, dirección IP y navegador desde el que aceptaste esta política.</li>
        </ul>

        <h2 className="text-base font-semibold pt-2">Para qué los usamos</h2>
        <p className="text-muted-foreground">
          Únicamente para administrar el programa: identificarte en el mostrador, calcular
          y acreditar tus puntos, procesar tus canjes y responder reclamos sobre tu saldo.
          No vendemos ni cedemos tus datos a terceros.
        </p>

        <h2 className="text-base font-semibold pt-2">Cómo los protegemos</h2>
        <p className="text-muted-foreground">
          Tu cédula, correo y teléfono se guardan cifrados (AES-256-GCM). El código que
          recibes para entrar se guarda como huella criptográfica, nunca en texto legible,
          y vence a los 10 minutos. El código QR que muestras en el taller no contiene
          ningún dato personal: una foto de tu pantalla no revela tu cédula, tu nombre ni
          tu saldo.
        </p>

        <h2 className="text-base font-semibold pt-2">Cuánto tiempo los guardamos</h2>
        <p className="text-muted-foreground">
          Mientras tu cuenta esté activa. Si pides la eliminación, borramos tus datos
          identificativos, pero conservamos el historial de puntos de forma anónima porque
          constituye un registro contable del programa.
        </p>

        <h2 className="text-base font-semibold pt-2">Tus derechos</h2>
        <p className="text-muted-foreground">
          Puedes acceder a tus datos, rectificarlos, pedir su eliminación y retirar tu
          consentimiento en cualquier momento, desde la sección Mi cuenta de la aplicación
          o acercándote al taller.
        </p>
      </section>

      <Link href="/acceso" className="inline-block text-sm text-primary underline underline-offset-4">
        Volver
      </Link>
    </div>
  );
}
