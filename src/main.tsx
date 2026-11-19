import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { isNativeAndroid } from './utils/platform';

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  if (isNativeAndroid()) {
    // Native Capacitor bundles local assets inside the APK/AAB; remove any legacy SW cache
    void navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    if (typeof caches !== 'undefined') {
      void caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k.startsWith('workbox-')).map((k) => caches.delete(k))),
        )
        .catch(() => {});
    }
  } else if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
