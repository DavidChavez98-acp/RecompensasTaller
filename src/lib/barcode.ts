/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Lectura del código QR desde la cámara del asesor.
 *
 * ── Dos caminos, y el pesado se carga solo si hace falta ──
 * Chrome en Android trae `BarcodeDetector` nativo: cero bytes de JavaScript
 * adicional y decodificación en código nativo. Safari en iOS no lo trae, así
 * que ahí (y solo ahí) se importa `qr-scanner` de forma dinámica: ~20 KB gzip
 * con su propio worker.
 *
 * Descartados: `@zxing/browser` y `html5-qrcode` (>300 KB cada uno) y el
 * ponyfill de Sec-ant, que arrastra ZXing en WASM (~1 MB).
 *
 * Consecuencia práctica para el taller: si van a comprar tabletas para el
 * mostrador, Android escanea más rápido que iPad.
 */

export type LectorQr = {
  detener: () => void;
  /** Qué implementación acabó usándose. Útil para diagnosticar en el mostrador. */
  motor: "nativo" | "respaldo";
};

type DetectorNativo = {
  detect: (fuente: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

type ConstructorDetector = {
  new (opciones: { formats: string[] }): DetectorNativo;
  getSupportedFormats: () => Promise<string[]>;
};

function getConstructorNativo(): ConstructorDetector | null {
  const global = globalThis as unknown as { BarcodeDetector?: ConstructorDetector };
  return global.BarcodeDetector ?? null;
}

export async function soportaBarcodeDetectorNativo(): Promise<boolean> {
  const Detector = getConstructorNativo();
  if (!Detector) return false;
  try {
    const formatos = await Detector.getSupportedFormats();
    return formatos.includes("qr_code");
  } catch {
    return false;
  }
}

/**
 * Restricciones de cámara pensadas para el mostrador: cámara trasera, y
 * resolución suficiente para leer un QR desde una pantalla de teléfono a ~30cm.
 */
export const RESTRICCIONES_CAMARA: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

/**
 * Arranca la lectura sobre un <video> ya reproduciendo.
 *
 * IMPORTANTE: quien llame debe invocar `detener()` al desmontar. En iOS solo
 * puede haber un <video> con cámara activo a la vez; si no se liberan los
 * tracks, la cámara queda bloqueada para la siguiente pantalla y el asesor
 * tiene que cerrar la app entera.
 */
export async function crearLectorQr(
  video: HTMLVideoElement,
  onResultado: (texto: string) => void
): Promise<LectorQr> {
  if (await soportaBarcodeDetectorNativo()) {
    return lectorNativo(video, onResultado);
  }
  return lectorRespaldo(video, onResultado);
}

function lectorNativo(
  video: HTMLVideoElement,
  onResultado: (texto: string) => void
): LectorQr {
  const Detector = getConstructorNativo();
  if (!Detector) throw new Error("BarcodeDetector no disponible");

  const detector = new Detector({ formats: ["qr_code"] });
  let activo = true;
  let animacion = 0;
  let ultimoIntento = 0;

  // ~10 fps. A 60 fps se calienta el teléfono sin leer más rápido: el cuello
  // de botella es que el asesor apunte bien, no la frecuencia de muestreo.
  const INTERVALO_MS = 100;

  const bucle = async (ahora: number) => {
    if (!activo) return;

    if (ahora - ultimoIntento >= INTERVALO_MS && video.readyState >= 2) {
      ultimoIntento = ahora;
      try {
        const codigos = await detector.detect(video);
        const primero = codigos[0];
        if (primero?.rawValue) {
          onResultado(primero.rawValue);
        }
      } catch {
        // Un frame ilegible no es un error: se sigue intentando.
      }
    }

    if (activo) animacion = requestAnimationFrame(bucle);
  };

  animacion = requestAnimationFrame(bucle);

  return {
    motor: "nativo",
    detener: () => {
      activo = false;
      cancelAnimationFrame(animacion);
    },
  };
}

async function lectorRespaldo(
  video: HTMLVideoElement,
  onResultado: (texto: string) => void
): Promise<LectorQr> {
  // Import dinámico: en Chrome Android este módulo NUNCA se descarga.
  const { default: QrScanner } = await import("qr-scanner");

  const escaner = new QrScanner(
    video,
    (resultado) => onResultado(resultado.data),
    {
      preferredCamera: "environment",
      maxScansPerSecond: 10,
      // El componente EscanerQr ya dibuja su propio indicador de zona de
      // escaneo. Los overlays del library añaden nodos al DOM que además
      // pueden interferir con la captura de frames en iOS Safari.
      highlightScanRegion: false,
      highlightCodeOutline: false,
      returnDetailedScanResult: true,
    }
  );

  await escaner.start();

  return {
    motor: "respaldo",
    detener: () => {
      escaner.stop();
      // destroy() libera el worker además de los tracks. Sin esto, cambiar de
      // pantalla varias veces deja workers huérfanos.
      escaner.destroy();
    },
  };
}

/** Mensaje accionable según por qué falló el permiso de cámara. */
export function explicarErrorCamara(error: unknown): string {
  const nombre = (error as { name?: string })?.name ?? "";

  switch (nombre) {
    case "NotAllowedError":
      return "Diste 'No permitir' a la cámara. Habilítala en los ajustes del navegador para este sitio.";
    case "NotFoundError":
      return "Este dispositivo no tiene cámara disponible.";
    case "NotReadableError":
      return "Otra aplicación está usando la cámara. Ciérrala e inténtalo de nuevo.";
    case "OverconstrainedError":
      return "No encontramos una cámara trasera. Prueba con otro dispositivo.";
    case "SecurityError":
      return "La cámara solo funciona sobre HTTPS.";
    default:
      return "No pudimos abrir la cámara. Usa el código tecleado.";
  }
}
