"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      // iOS Safari
      // @ts-ignore
      window.navigator?.standalone === true;

    setIsStandalone(!!standalone);

    const handler = (e: Event) => {
      // Si ya está instalada, no hacemos nada
      if (
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        // @ts-ignore
        window.navigator?.standalone === true
      ) {
        return;
      }

      // Evita el mini-infobar de Chrome y nos deja disparar el prompt con un botón
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Si ya está instalada, oculto
  if (isStandalone) return null;

  // Si el navegador no disparó beforeinstallprompt (iOS / no cumple requisitos), oculto
  if (!deferredPrompt) return null;

  return (
    <button
      className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-extrabold shadow-sm transition hover:shadow hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
      onClick={async () => {
        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        // El prompt se consume: ocultamos el botón
        setDeferredPrompt(null);
      }}
      title="Instalar la app en tu celular"
    >
      Instalar app
    </button>
  );
}