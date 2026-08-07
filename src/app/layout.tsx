/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

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
  manifest: "/manifest.json",
  // iOS ignora casi todo el manifest: sin estas metas, "Añadir a pantalla de
  // inicio" produce un marcador de Safari en vez de una app en modo standalone.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Recompensas GP",
  },
  icons: {
    apple: "/apple-touch-icon-180.png",
  },
  // El programa de recompensas no se indexa: es para clientes, no para buscadores.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#C81E1E",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
      </body>
    </html>
  );
}
