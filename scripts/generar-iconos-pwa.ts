/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Genera, a partir del isotipo vectorial (`public/logo-gp-isotipo.svg`), los
 * dos rasters que faltaban para el hito 8 (PWA):
 *
 *   - `public/pwa-maskable-512x512.png`: entrada `purpose: "maskable"` del
 *     manifest. El isotipo es tinta negra (#010101) + sector rojo (#cd151b)
 *     sobre fondo TRANSPARENTE — no lleva zócalo de color propio (el
 *     "zócalo de tablero" que describe AGENTS.md es la forma negra del
 *     velocímetro, no un fondo). Sobre negro esa tinta se volvería invisible,
 *     así que el fondo elegido es blanco sólido: es el que da mejor
 *     contraste simultáneo a la tinta negra Y al rojo institucional.
 *     El isotipo ocupa el 80% central (10% de margen por lado = 20% de zona
 *     segura alrededor), el estándar para que Android no muerda la marca al
 *     aplicar máscaras no circulares/cuadradas.
 *
 *   - `src/app/apple-icon.png`: convención de archivo especial de Next.js
 *     (App Router la detecta sola y genera el <link rel="apple-touch-icon">,
 *     no hace falta declararlo en `layout.tsx`). 180×180, mismo fondo blanco,
 *     aplanado SIN canal alfa: iOS no aplica máscara pero si el PNG lleva
 *     transparencia la rellena con negro en la pantalla de inicio.
 *
 * Uso: npx tsx scripts/generar-iconos-pwa.ts
 *
 * Script de un solo uso — no se ejecuta en `build` ni en ningún flujo de
 * producción. `sharp` es devDependency exclusivamente para este script.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const RAIZ = resolve(__dirname, "..");
const SVG_ISOTIPO = resolve(RAIZ, "public/logo-gp-isotipo.svg");

// Fondo sólido: blanco. La tinta del isotipo es negra + rojo sobre
// transparente; blanco es el único de los dos candidatos (blanco/negro) que
// no hace desaparecer la tinta negra del velocímetro.
const FONDO = "#FFFFFF";

async function generarMaskable() {
  const destino = resolve(RAIZ, "public/pwa-maskable-512x512.png");
  const lienzo = 512;
  const margenPorLado = 0.1; // 10% por lado = 20% de zona segura alrededor
  const contenido = Math.round(lienzo * (1 - margenPorLado * 2)); // 410px

  const isotipo = await sharp(readFileSync(SVG_ISOTIPO))
    .resize(contenido, contenido, { fit: "contain" })
    .png()
    .toBuffer();

  const offset = Math.round((lienzo - contenido) / 2);

  await sharp({
    create: {
      width: lienzo,
      height: lienzo,
      channels: 4,
      background: FONDO,
    },
  })
    .composite([{ input: isotipo, left: offset, top: offset }])
    .flatten({ background: FONDO }) // fuerza opacidad total, nunca transparente
    .removeAlpha() // `flatten` deja el alfa en 255 pero conserva el canal; lo quitamos del todo
    .png()
    .toFile(destino);

  console.log(`✓ ${destino} (${lienzo}x${lienzo}, contenido ${contenido}px, fondo ${FONDO})`);
}

async function generarAppleIcon() {
  const destino = resolve(RAIZ, "src/app/apple-icon.png");
  const lienzo = 180;
  const margenPorLado = 0.1; // mismo criterio visual que el maskable
  const contenido = Math.round(lienzo * (1 - margenPorLado * 2)); // 144px

  const isotipo = await sharp(readFileSync(SVG_ISOTIPO))
    .resize(contenido, contenido, { fit: "contain" })
    .png()
    .toBuffer();

  const offset = Math.round((lienzo - contenido) / 2);

  await sharp({
    create: {
      width: lienzo,
      height: lienzo,
      channels: 4,
      background: FONDO,
    },
  })
    .composite([{ input: isotipo, left: offset, top: offset }])
    .flatten({ background: FONDO })
    .removeAlpha() // iOS pinta negro donde haya transparencia; el PNG no debe llevar canal alfa
    .png()
    .toFile(destino);

  console.log(`✓ ${destino} (${lienzo}x${lienzo}, contenido ${contenido}px, fondo ${FONDO}, sin alfa)`);
}

async function main() {
  await generarMaskable();
  await generarAppleIcon();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
