import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

async function warmOfflineShellCache(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  if (navigator.onLine === false) return;
  const proto = window.location.protocol.toLowerCase();
  if (proto !== 'https:' && proto !== 'http:') return;

  try {
    const cache = await caches.open('zando-pro-offline-resources-v1');
    const urls = new Set<string>([
      './',
      './index.html',
      './manifest.webmanifest',
      './icon.svg',
      './apple-touch-icon.png',
      './pwa-192x192.png',
      './pwa-512x512.png',
      './pwa-maskable-512x512.png',
    ]);
    document.querySelectorAll('link[rel="stylesheet"][href]').forEach((el) => {
      const href = el.getAttribute('href');
      if (href && !href.startsWith('data:')) urls.add(href);
    });
    document.querySelectorAll('script[src]').forEach((el) => {
      const src = el.getAttribute('src');
      if (src && !src.startsWith('data:')) urls.add(src);
    });
    await Promise.allSettled(
      Array.from(urls).map(async (u) => {
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res);
      }),
    );
  } catch {
    // Ignoré si le WebView restreint CacheStorage
  }
}

// Enregistrement sûr du Service Worker (actif en HTTPS ou localhost, ignoré sans erreur en file:// APK WebView)
if (
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  (window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1')
) {
  try {
    registerSW({
      immediate: true,
      onRegisteredSW() {
        warmOfflineShellCache().catch(() => {});
      },
      onNeedRefresh() {
        // Ne jamais forcer un rechargement hors ligne qui pourrait afficher une erreur réseau
      },
      onOfflineReady() {
        try {
          if (navigator.storage?.persist) {
            navigator.storage.persist().catch(() => {});
          }
          warmOfflineShellCache().catch(() => {});
          window.dispatchEvent(new CustomEvent('zando-offline-ready'));
        } catch {
          // Ignoré si WebView restrictif
        }
      },
      onRegisterError() {
        // Ignoré proprement si le WebView Android gère son propre cache local
      },
    });
  } catch {
    // WebView restrictif : l'app continue de fonctionner localement via IndexedDB
  }
}

createRoot(document.getElementById('root')!).render(<App />);
