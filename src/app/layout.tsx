/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Recompensas Taller | Grupo Palacios",
  description:
    "Acumula puntos por el mantenimiento de tu vehículo en el taller de Grupo Palacios y canjéalos por premios.",
  /*
   * El manifest NO se declara aquí. Lo genera `src/app/manifest.ts` y Next
   * inyecta él mismo el <link rel="manifest" href="/manifest.webmanifest">.
   * La cadena "/manifest.json" que había antes apuntaba a un archivo que nunca
   * existió: daba 404 y con eso Chrome no consideraba instalable la PWA.
   */
  // iOS ignora casi todo el manifest: sin estas metas, "Añadir a pantalla de
  // inicio" produce un marcador de Safari en vez de una app en modo standalone.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Recompensas GP",
  },
  icons: {
    /*
     * El ISOTIPO solo, no el lockup. `logo-gp-vertical.svg` lleva el logotipo
     * "GRUPO PALACIOS" bajo el instrumento, y a 16–32px —el tamaño real de una
     * pestaña— ese texto es una mancha ilegible. El instrumento aguanta
     * cualquier tamaño porque es una forma, no palabras.
     *
     * El apple-touch-icon 180×180 PNG sin canal alfa llega en el hito 7 (PWA):
     * usar la marca con transparencia se vería con fondo negro en el home de
     * iOS, así que se deja pendiente en vez de improvisar uno malo.
     */
    icon: "/logo-gp-isotipo.svg",
  },
  // El programa de recompensas no se indexa: es para clientes, no para buscadores.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#C81E1E",
  width: "device-width",
  initialScale: 1,
  // Sin maximumScale: 1 a propósito. Bloquear el pinch-to-zoom incumple WCAG
  // 1.4.4 y va en contra del público del programa — muchos clientes de un
  // taller son adultos mayores que necesitan agrandar el saldo o el código QR.
  // Sin viewport-fit=cover, iOS no expone env(safe-area-inset-*) y la barra
  // inferior del cliente queda tapada por el indicador de inicio en standalone.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="top-center" richColors />
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
