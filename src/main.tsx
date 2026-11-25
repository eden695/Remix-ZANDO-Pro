import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

function fetchWithTimeout(url: string, timeoutMs = 2500): Promise<Response> {
  if (typeof AbortController === 'undefined') {
    return fetch(url);
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {signal: controller.signal}).finally(() => {
    window.clearTimeout(timer);
  });
}

let warmStarted = false;
async function warmOfflineShellCache(): Promise<void> {
  if (warmStarted) return;
  if (typeof window === 'undefined' || !('caches' in window)) return;
  if (navigator.onLine === false) return;
  const proto = window.location.protocol.toLowerCase();
  if (proto !== 'https:' && proto !== 'http:') return;

  warmStarted = true;
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
        const res = await fetchWithTimeout(u, 2500);
        if (res.ok) await cache.put(u, res);
      }),
    );
  } catch {
    // Ignoré si le WebView restreint CacheStorage
  }
}

function scheduleWarmOfflineShellCache(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    warmOfflineShellCache().catch(() => {});
  }, 2500);
}

// Récupération sûre en cas d'ancien fichier JS en cache HTTP WebView (uniquement en ligne, sans boucle infinie hors ligne)
if (typeof window !== 'undefined') {
  try {
    window.sessionStorage.removeItem('zando_chunk_recover_v1');
  } catch {
    // Ignore
  }

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    if (navigator.onLine === false) return;
    try {
      if (window.sessionStorage.getItem('zando_chunk_recover_v1') === '1') return;
      window.sessionStorage.setItem('zando_chunk_recover_v1', '1');
    } catch {
      return;
    }
    window.location.reload();
  });
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
        scheduleWarmOfflineShellCache();
      },
      onNeedRefresh() {
        // Ne jamais interrompre le démarrage hors ligne par un rechargement brutal
      },
      onNeedReload() {
        // CRITIQUE : empêcher autoUpdate d'appeler window.location.reload() au lancement dans WebView
      },
      onOfflineReady() {
        try {
          if (navigator.storage?.persist) {
            navigator.storage.persist().catch(() => {});
          }
          scheduleWarmOfflineShellCache();
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

