/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * `layout.tsx` declaraba `manifest: "/manifest.json"` desde el día 1 y ese
 * archivo NUNCA existió: la referencia daba 404, así que Chrome no cumplía uno
 * de sus cuatro criterios y la PWA no era instalable en Android. El aviso de
 * instalación estaba escrito y montado, pero `beforeinstallprompt` no se
 * disparaba nunca.
 *
 * Se genera desde `manifest.ts` y no como archivo estático para que la ruta y
 * los iconos los resuelva Next, no una cadena escrita a mano que puede quedar
 * desincronizada del contenido de `public/`.
 */

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Recompensas Taller | Grupo Palacios",
    short_name: "Recompensas GP",
    description:
      "Acumula puntos por el mantenimiento de tu vehículo en el taller de Grupo Palacios y canjéalos por premios.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F4F5F7",
    theme_color: "#C81E1E",
    lang: "es-EC",
    dir: "ltr",
    categories: ["lifestyle", "productivity"],
    icons: [
      /*
       * `any` y `maskable` van en ENTRADAS SEPARADAS, no en un
       * `purpose: "any maskable"` compartido. Es una de las divergencias
       * deliberadas frente al proyecto hermano documentadas en AGENTS.md:
       * Android aplica su máscara al icono compartido y lo recorta, así que la
       * marca sale mordida en el cajón de aplicaciones.
       *
       * Hoy los dos apuntan al mismo PNG porque todavía no existe una versión
       * con la zona segura del 20% que exige `maskable`. Eso llega con el resto
       * del hito 7; declarar los propósitos por separado desde ahora hace que
       * sustituir el archivo sea cambiar una ruta.
       */
      { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
