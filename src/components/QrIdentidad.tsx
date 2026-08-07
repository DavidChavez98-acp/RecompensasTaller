/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * El código que el cliente muestra al asesor.
 *
 * Se genera ENTERO en el dispositivo: una vez aprovisionado el secreto, esta
 * pantalla funciona en modo avión. Es el caso de uso crítico — el taller es un
 * galpón y la señal ahí dentro es mala.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import encodeQR from "qr";
import { aprovisionarDispositivo } from "@/actions/dispositivos";
import {
  guardarDispositivoLocal,
  leerDispositivoLocal,
  type DispositivoLocal,
} from "@/lib/qr-device.client";
import { base64UrlABytes, construirToken, msHastaSiguientePaso } from "@/lib/qr-token";
import { QR_PASO_SEGUNDOS } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Estado =
  | { fase: "cargando" }
  | { fase: "listo"; svg: string; codigoRespaldo: string }
  | { fase: "error"; mensaje: string };

export function QrIdentidad({ clienteId }: { clienteId: string }) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [segundosRestantes, setSegundosRestantes] = useState(QR_PASO_SEGUNDOS);
  const [dispositivo, setDispositivo] = useState<DispositivoLocal | null>(null);

  // ── 1. Conseguir el secreto: del almacenamiento local, o pidiendo uno nuevo ──
  useEffect(() => {
    let cancelado = false;

    async function preparar() {
      const local = leerDispositivoLocal(clienteId);
      if (local) {
        if (!cancelado) setDispositivo(local);
        return;
      }

      // Único momento del flujo que necesita red.
      const resultado = await aprovisionarDispositivo();
      if (cancelado) return;

      if (!resultado.success) {
        setEstado({ fase: "error", mensaje: resultado.error });
        return;
      }

      const nuevo: DispositivoLocal = {
        clienteId,
        dispositivoId: resultado.dispositivo.dispositivoId,
        secreto: resultado.dispositivo.secreto,
        algoritmo: resultado.dispositivo.algoritmo,
      };
      guardarDispositivoLocal(nuevo);
      setDispositivo(nuevo);
    }

    preparar().catch(() => {
      if (!cancelado) {
        setEstado({
          fase: "error",
          mensaje: "No pudimos preparar tu código. Revisa tu conexión e inténtalo de nuevo.",
        });
      }
    });

    return () => {
      cancelado = true;
    };
  }, [clienteId]);

  // ── 2. Generar el token del paso actual y repintar cuando cambie ──
  const regenerar = useCallback(async (actual: DispositivoLocal) => {
    const { token, codigoRespaldo } = await construirToken(
      actual.dispositivoId,
      base64UrlABytes(actual.secreto)
    );

    // El SVG lo produce nuestro propio código a partir de nuestro propio token:
    // no hay entrada de terceros que pudiera inyectar marcado.
    const svg = encodeQR(token, "svg", { ecc: "medium", border: 1 });
    setEstado({ fase: "listo", svg, codigoRespaldo });
  }, []);

  useEffect(() => {
    if (!dispositivo) return;
    let cancelado = false;
    let temporizador: ReturnType<typeof setTimeout>;

    async function ciclo() {
      if (cancelado || !dispositivo) return;
      await regenerar(dispositivo);
      if (cancelado) return;

      const restanteMs = msHastaSiguientePaso();
      setSegundosRestantes(Math.ceil(restanteMs / 1000));
      // Se reprograma justo en el cambio de paso, no cada segundo: menos
      // trabajo y el código nunca se queda obsoleto en pantalla.
      temporizador = setTimeout(ciclo, restanteMs + 50);
    }

    ciclo().catch(() => {
      if (!cancelado) {
        setEstado({ fase: "error", mensaje: "No pudimos generar tu código." });
      }
    });

    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [dispositivo, regenerar]);

  // Cuenta atrás visible. Va aparte del ciclo de regeneración para que el
  // número baje suave sin recalcular el HMAC cada segundo.
  useEffect(() => {
    if (estado.fase !== "listo") return;
    const intervalo = setInterval(() => {
      setSegundosRestantes(Math.ceil(msHastaSiguientePaso() / 1000));
    }, 1000);
    return () => clearInterval(intervalo);
  }, [estado.fase]);

  if (estado.fase === "error") {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-4">
          <p className="text-sm text-muted-foreground">{estado.mensaje}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (estado.fase === "cargando") {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Preparando tu código…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-6 space-y-4">
          {/*
            Fondo blanco puro y módulos negros puros SIEMPRE, también en modo
            oscuro: cualquier atenuación baja el contraste y el escaneo falla
            con una pantalla sucia bajo luz fluorescente.
          */}
          <div
            className="qr-lienzo mx-auto w-full max-w-[260px] aspect-square p-3 [&>svg]:w-full [&>svg]:h-full"
            dangerouslySetInnerHTML={{ __html: estado.svg }}
          />

          <div className="text-center space-y-1">
            <p className="text-xs text-muted-foreground">
              Se renueva en {segundosRestantes}s
            </p>
            <div
              className="h-1 bg-secondary overflow-hidden"
              role="progressbar"
              aria-valuenow={segundosRestantes}
              aria-valuemin={0}
              aria-valuemax={QR_PASO_SEGUNDOS}
              aria-label="Tiempo restante del código"
            >
              <div
                className="h-full bg-primary transition-[width] duration-1000 ease-linear"
                style={{ width: `${(segundosRestantes / QR_PASO_SEGUNDOS) * 100}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 text-center space-y-1">
          <p className="text-xs text-muted-foreground">Si la cámara no lo lee, dicta este código</p>
          <p className="font-mono text-xl tracking-[0.3em]">{estado.codigoRespaldo}</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Este código no contiene tus datos personales y cambia cada minuto. Funciona sin internet.
      </p>
    </div>
  );
}
