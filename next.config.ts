/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

/**
 * IMPORTANTE — Turbopack vs. webpack (Next.js 16):
 *
 * `@ducanh2912/next-pwa` genera el service worker inyectando un plugin de
 * **webpack** en la config. Turbopack, que es el bundler por defecto desde
 * Next 16, no ejecuta plugins de webpack, así que `next build`/`next dev` sin
 * el flag `--webpack` fallan con un error claro.
 *
 * NO "arregles" esto añadiendo `turbopack: {}` a nextConfig: eso silenciaría
 * el error, pero Turbopack seguiría sin ejecutar el plugin, y el service
 * worker dejaría de generarse SIN avisar — peor que el fallo actual. Mientras
 * `@ducanh2912/next-pwa` no soporte Turbopack, este proyecto DEBE compilarse
 * con `--webpack` explícito.
 *
 * Los scripts de package.json (`dev`, `build`) ya lo incluyen. Si cambias el
 * comando de build en Vercel, asegúrate de que siga siendo `pnpm run build`.
 */

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: false,
  // El HTML de la raíz es la PWA del cliente y va autenticado: cachearlo
  // mostraría el saldo de la sesión anterior al siguiente que abra la app.
  cacheStartUrl: false,
  dynamicStartUrl: false,
  workboxOptions: {
    clientsClaim: true,
    skipWaiting: true,
    // Navegación sin red → página que explica que el QR SÍ funciona offline
    // (el caso de uso crítico) y que el saldo mostrado puede estar viejo.
    navigateFallback: "/offline",
    navigateFallbackDenylist: [/^\/interno/, /^\/api/],
    runtimeCaching: [
      // 0. El panel interno NUNCA se cachea: el personal no debe ver saldos
      //    ni colas de canje obsoletos mientras atiende a un cliente.
      {
        urlPattern: /^https?:\/\/[^/]+\/interno(\/.*)?$/i,
        handler: "NetworkOnly",
      },
      // 1. Chunks y hojas de estilo estáticas (assets inmutables)
      {
        urlPattern: /\/_next\/static.+\.(?:js|css)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "next-static-assets",
          expiration: {
            maxEntries: 128,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 días
          },
        },
      },
      // 2. Imágenes locales y vectores. Las fotos de premios entran aquí bajo
      //    demanda: NO se precachean, la cuota de Cache Storage de iOS es
      //    ajustada y el catálogo con fotos se la comería.
      {
        urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "static-image-assets",
          expiration: {
            maxEntries: 64,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 días
          },
        },
      },
      // 3. Tipografías
      {
        urlPattern: /\.(?:woff|woff2|eot|ttf|otf)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-font-assets",
          expiration: {
            maxEntries: 16,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 días
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "*.private.blob.vercel-storage.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // camera=(self) es obligatorio: el asesor escanea el QR del
            // cliente con getUserMedia desde /interno/escanear.
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default process.env.NODE_ENV === "production"
  ? withPWA(nextConfig)
  : nextConfig;
