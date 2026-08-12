"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Share, X, PlusSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>;
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function PwaInstallPrompt() {
  const pathname = usePathname();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // Ocultar pantalla de carga cuando React esté listo
    const splash = document.getElementById("pwa-splash-screen");
    if (splash) {
      splash.style.opacity = "0";
      const timer = setTimeout(() => {
        splash.style.display = "none";
      }, 400); // Duración de transición de 400ms
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    // Solo en la app del cliente. El personal del taller entra desde una
    // computadora del mostrador y no necesita instalar nada.
    if (pathname.startsWith("/interno")) return;

    // Ya está instalada en modo standalone.
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (isStandalone) return;

    // Ya la rechazó antes.
    const isDismissed = localStorage.getItem("pwa-install-prompt-dismissed") === "true";
    if (isDismissed) return;

    const userAgent = window.navigator.userAgent;
    const detectIos =
      /iPad|iPhone|iPod/.test(userAgent) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);

    if (detectIos) {
      // iOS NUNCA dispara `beforeinstallprompt`: la única vía es Compartir →
      // "Añadir a la pantalla de inicio", y solo desde Safari. Por eso aquí se
      // muestran las instrucciones a mano en vez de un botón de instalar.
      // El setState va dentro del callback, no en el cuerpo del efecto.
      const timer = setTimeout(() => {
        setIsIos(true);
        setShowPrompt(true);
      }, 3000);
      return () => clearTimeout(timer);
    }

    // Capturar evento beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Mostrar indicador después de un retraso corto
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
      return () => clearTimeout(timer);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, [pathname]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    
    // Mostrar prompt al usuario
    await deferredPrompt.prompt();
    
    // Esperar selección del usuario
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === "accepted") {
      setShowPrompt(false);
      localStorage.setItem("pwa-install-prompt-dismissed", "true");
    }
    
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // No mostrar de nuevo por 7 días
    localStorage.setItem("pwa-install-prompt-dismissed", "true");
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-50 animate-in fade-in slide-in-from-bottom-5 duration-300">
      {/*
        Sin sombras decorativas ni colores sueltos de Tailwind: solo tokens del
        sistema (bg-card, text-primary, border-border), igual que el resto de
        la app. Este era el único componente que no los respetaba — heredado
        del proyecto hermano sin adaptar.
      */}
      <div className="bg-card text-card-foreground border border-border rounded-xl p-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDismiss}
          className="absolute top-3 right-3 rounded-full"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="flex gap-3 items-start mt-1">
          <div className="p-2 bg-primary/10 rounded-lg text-primary shrink-0">
            <Download className="h-5 w-5" />
          </div>

          <div className="space-y-1">
            <h3 className="font-semibold text-sm leading-none tracking-tight">Instalar Aplicación</h3>
            <p className="text-xs text-muted-foreground leading-normal">
              Accede de forma rápida y segura desde tu pantalla de inicio con nuestra versión optimizada.
            </p>
          </div>
        </div>

        {isIos ? (
          <div className="mt-4 pt-3 border-t border-border/60 text-[11px] text-muted-foreground space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-foreground font-semibold">1</span>
              <span>Presiona el botón compartir <Share className="inline h-3.5 w-3.5 mx-0.5" /> en Safari.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-foreground font-semibold">2</span>
              <span>Selecciona <span className="font-medium text-foreground">&ldquo;Añadir a la pantalla de inicio&rdquo;</span> <PlusSquare className="inline h-3.5 w-3.5 mx-0.5" />.</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={handleDismiss}>
              Quizás luego
            </Button>
            <Button size="sm" onClick={handleInstallClick}>
              Instalar ahora
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
