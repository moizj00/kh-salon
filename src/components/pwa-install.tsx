import React, { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export const PWAInstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  useEffect(() => {
    // Detect standalone display mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(ua);
    setIsIOS(isIOSDevice);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
  };

  if (isInstalled) return null;

  return (
    <>
      {deferredPrompt && (
        <button
          type="button"
          onClick={handleInstallClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold shadow-xs hover:opacity-90 transition-opacity"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install PWA</span>
        </button>
      )}

      {!deferredPrompt && isIOS && (
        <button
          type="button"
          onClick={() => setShowIOSModal(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#e6dfdb] text-xs font-medium text-[#1d1a19] hover:bg-black/5"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install on iOS</span>
        </button>
      )}

      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330]">
            <h3 className="text-base font-bold text-[#1d1a19] dark:text-[#f2eeec] mb-2 flex items-center gap-2">
              <Share className="w-4 h-4 text-[#7a2e4a]" />
              <span>Install Kiran DMS on iPhone</span>
            </h3>
            <p className="text-sm text-[#6b625e] dark:text-[#a59b96] space-y-2">
              <span>1. Tap the <strong>Share</strong> button in Safari's bottom toolbar.</span>
              <br />
              <span>2. Scroll down and tap <strong>Add to Home Screen</strong>.</span>
              <br />
              <span>3. Launch the app from your home screen for full offline support.</span>
            </p>
            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="mt-4 w-full py-2.5 rounded-xl bg-[#7a2e4a] text-white text-sm font-semibold"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
