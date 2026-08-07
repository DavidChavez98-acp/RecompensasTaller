/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { crearLectorQr, explicarErrorCamara, RESTRICCIONES_CAMARA, soportaBarcodeDetectorNativo, type LectorQr } from "@/lib/barcode";
import { Button } from "@/components/ui/button";

type Props = {
  onDetectado: (texto: string) => void;
  /**
   * Verdadero mientras el servidor procesa el código recién leído. La cámara ya
   * se apagó sola al detectar; esto solo impide que el asesor la vuelva a
   * encender y dispare un segundo escaneo encima del que está en curso.
   */
  pausado?: boolean;
};

export function EscanerQr({ onDetectado, pausado = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lectorRef = useRef<LectorQr | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Sin esto, un QR bien enfocado dispara la Server Action diez veces por
  // segundo mientras la cámara siga apuntándolo.
  const yaDetectadoRef = useRef(false);

  const [encendida, setEncendida] = useState(false);
  const [arrancando, setArrancando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motor, setMotor] = useState<"nativo" | "respaldo" | null>(null);

  function apagar() {
    lectorRef.current?.detener();
    lectorRef.current = null;

    // Liberar los tracks es obligatorio, no una cortesía: en iOS solo puede
    // haber una cámara activa a la vez, y si no se sueltan, la siguiente
    // pantalla que la pida falla hasta cerrar la app.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;
    setEncendida(false);
    setMotor(null);
  }

  async function encender() {
    setError(null);
    setArrancando(true);
    yaDetectadoRef.current = false;

    try {
      const video = videoRef.current;
      if (!video) throw new Error("video no montado");

      const usaNativo = await soportaBarcodeDetectorNativo();

      if (usaNativo) {
        // Camino nativo (Chrome Android): nosotros gestionamos la cámara, el
        // BarcodeDetector solo lee frames del <video>.
        const stream = await navigator.mediaDevices.getUserMedia(RESTRICCIONES_CAMARA);
        streamRef.current = stream;
        video.srcObject = stream;
        // `playsInline` va en el JSX; sin él iOS abre el reproductor a pantalla
        // completa y tapa la interfaz del asesor.
        await video.play();
      }
      // Camino de respaldo (iOS / navegadores sin BarcodeDetector): `qr-scanner`
      // adquiere su propia cámara al llamar `start()`. Pedir un segundo stream
      // aquí conflictuaría en iOS, donde solo puede haber un stream de cámara
      // activo a la vez — el segundo mata al primero y la detección no funciona.

      const lector = await crearLectorQr(video, (texto) => {
        if (yaDetectadoRef.current) return;
        yaDetectadoRef.current = true;
        // Apagar aquí, dentro del callback de detección, y no en un efecto que
        // reaccione a una prop: leído el código ya no hay nada que escanear, y
        // así se libera la cámara de inmediato sin un setState dentro de un
        // efecto (que React desaconseja por los renders en cascada).
        apagar();
        onDetectado(texto);
      });

      lectorRef.current = lector;
      setMotor(lector.motor);
      setEncendida(true);
    } catch (e) {
      setError(explicarErrorCamara(e));
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    } finally {
      setArrancando(false);
    }
  }

  useEffect(() => {
    return () => {
      lectorRef.current?.detener();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] bg-black overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          autoPlay
        />

        {!encendida && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70">
            <CameraOff className="h-8 w-8" />
            <p className="text-sm">Cámara apagada</p>
          </div>
        )}

        {encendida && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-2/3 aspect-square border-2 border-white/70" />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        {/*
          El arranque va SIEMPRE detrás de un gesto del usuario: iOS no concede
          getUserMedia fuera de un gesto, y pedir la cámara al montar produce un
          rechazo silencioso.
        */}
        {encendida ? (
          <Button variant="outline" onClick={apagar} className="flex-1">
            Apagar cámara
          </Button>
        ) : (
          <Button onClick={encender} disabled={arrancando || pausado} className="flex-1">
            <Camera className="h-4 w-4" />
            {arrancando ? "Abriendo…" : "Escanear código"}
          </Button>
        )}

        {motor === "respaldo" && (
          <span className="text-[11px] text-muted-foreground shrink-0">lector compatible</span>
        )}
      </div>
    </div>
  );
}
