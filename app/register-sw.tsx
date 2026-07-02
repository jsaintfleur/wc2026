/* ------------------------------------------------------------------
 * RegisterSW — registers the service worker on mount.
 * Client component, renders nothing visible.
 * ---------------------------------------------------------------- */
"use client";

import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then((registration) => {
          registration.update().catch(() => {
            /* SW update check failed — non-critical, app still works */
          });
        })
        .catch(() => {
          /* SW registration failed — non-critical, app still works */
        });
    }
  }, []);
  return null;
}
