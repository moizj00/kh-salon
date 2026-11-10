// Registers the offline service worker for the PWA shell (P1-09 Task 6)

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        // Check for updates
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (installing) {
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                console.log("Kiran DMS: New PWA version ready.");
              }
            });
          }
        });
      })
      .catch((error) => {
        console.warn("Kiran DMS: Service worker registration skipped:", error);
      });
  });
}
