"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, Share, X, PlusSquare } from "lucide-react";

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
      <div className="bg-card text-card-foreground border border-border rounded-xl shadow-xl p-4 relative overflow-hidden bg-white dark:bg-zinc-950">
        {/* Top/Side Crimson accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-red-600 dark:bg-rose-500" />
        
        <button 
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex gap-3 items-start mt-1">
          <div className="p-2 bg-red-50 dark:bg-red-950/30 rounded-lg text-red-600 dark:text-rose-500 shrink-0">
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
              <span>Presiona el botón compartir <Share className="inline h-3.5 w-3.5 mx-0.5 text-blue-500" /> en Safari.</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-foreground font-semibold">2</span>
              <span>Selecciona <span className="font-medium text-foreground">&ldquo;Añadir a la pantalla de inicio&rdquo;</span> <PlusSquare className="inline h-3.5 w-3.5 mx-0.5" />.</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex gap-2 justify-end">
            <button
              onClick={handleDismiss}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium cursor-pointer"
            >
              Quizás luego
            </button>
            <button
              onClick={handleInstallClick}
              className="text-xs bg-red-600 hover:bg-red-700 dark:bg-rose-600 dark:hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium shadow-sm hover:shadow cursor-pointer"
            >
              Instalar ahora
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
